/**
 * Cost tracker — two strategies:
 *   1. Claude sessions: parse JSONL session files for message.usage (accurate)
 *   2. Other CLIs: parse PTY output for token/cost patterns (best-effort)
 * Read-only observer: does not affect PTY data flow.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

export interface CostEntry {
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  timestamp: number;
  // Delta (incremental) values for this poll interval
  deltaInputTokens: number;
  deltaOutputTokens: number;
  deltaCost: number;
}

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude 4.x family
  'claude-opus-4-7': { inputPer1M: 15, outputPer1M: 75 },
  'claude-opus-4-6': { inputPer1M: 15, outputPer1M: 75 },
  'claude-opus-4-0': { inputPer1M: 15, outputPer1M: 75 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-sonnet-4-0': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-4-5': { inputPer1M: 0.8, outputPer1M: 4 },
  // Claude 3.x family (legacy)
  'claude-3-5-sonnet': { inputPer1M: 3, outputPer1M: 15 },
  'claude-3-5-haiku': { inputPer1M: 0.8, outputPer1M: 4 },
  'claude-3-opus': { inputPer1M: 15, outputPer1M: 75 },
  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4.1-nano': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'o3': { inputPer1M: 10, outputPer1M: 40 },
  'o3-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
  'o4-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
  // Gemini
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10 },
  'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },
  // Fallback
  'default': { inputPer1M: 3, outputPer1M: 15 },
};

// Regex patterns for PTY output parsing (non-Claude CLIs)
const COST_PATTERN = /(?:Total cost|Cost|Session cost)[:\s]*\$([0-9]+\.?[0-9]*)/i;
const INPUT_TOKENS_PATTERN = /(?:input)[\s]*(?:tokens)?[:\s]*([0-9,]+)/i;
const OUTPUT_TOKENS_PATTERN = /(?:output)[\s]*(?:tokens)?[:\s]*([0-9,]+)/i;

const MAX_BUFFER_SIZE = 2048;
const SESSION_POLL_INTERVAL_MS = 15_000; // poll JSONL every 15s

interface SessionTracker {
  agentId: string;
  filePath: string;
  model: string;
  lastLineCount: number;
  accumulated: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  timer: ReturnType<typeof setInterval>;
}

export class CostTracker {
  private buffers: Map<string, string> = new Map();
  private sessions: Map<string, SessionTracker> = new Map();
  private onCostDetected?: (agentId: string, cost: CostEntry) => void;

  constructor(onCostDetected?: (agentId: string, cost: CostEntry) => void) {
    this.onCostDetected = onCostDetected;
  }

  /** Match model name by prefix — handles versioned IDs like 'claude-opus-4-6-20250414' */
  private findPricing(model: string): ModelPricing {
    if (MODEL_PRICING[model]) return MODEL_PRICING[model];
    // Try prefix matching (longest match first)
    const keys = Object.keys(MODEL_PRICING).filter(k => k !== 'default').sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (model.startsWith(key)) return MODEL_PRICING[key];
    }
    return MODEL_PRICING['default'];
  }

  // ── Strategy 1: Claude JSONL Session File Tracking ──────────

  /**
   * Start tracking a Claude session JSONL file for token usage.
   * If sessionId is provided, tracks that specific file.
   * If sessionId is null/undefined, finds the most recent JSONL in the project dir.
   */
  trackSession(agentId: string, rootPath: string, sessionId: string | null | undefined, model: string): void {
    // Don't double-track
    if (this.sessions.has(agentId)) {
      this.stopSession(agentId);
    }

    const encodedPath = rootPath.replace(/\//g, '-');
    const projectDir = path.join(os.homedir(), '.claude', 'projects', encodedPath);

    let filePath: string;
    if (sessionId) {
      filePath = path.join(projectDir, `${sessionId}.jsonl`);
    } else {
      // Find the most recently modified JSONL file
      try {
        const files = fs.readdirSync(projectDir)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => ({ name: f, mtime: fs.statSync(path.join(projectDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length === 0) {
          console.warn(`[CostTracker] No JSONL files found in ${projectDir}`);
          return;
        }
        filePath = path.join(projectDir, files[0].name);
        console.log(`[CostTracker] No sessionId — using most recent: ${files[0].name}`);
      } catch {
        console.warn(`[CostTracker] Cannot read project dir: ${projectDir}`);
        return;
      }
    }

    if (!fs.existsSync(filePath)) {
      console.warn(`[CostTracker] Session file not found: ${filePath}`);
      return;
    }

    const tracker: SessionTracker = {
      agentId,
      filePath,
      model,
      lastLineCount: 0,
      accumulated: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      timer: setInterval(() => this.pollSessionFile(agentId), SESSION_POLL_INTERVAL_MS),
    };

    this.sessions.set(agentId, tracker);
    console.log(`[CostTracker] Tracking session file for agent=${agentId}: ${filePath}`);

    // Do an initial scan right away
    this.pollSessionFile(agentId);
  }

  stopSession(agentId: string): void {
    const tracker = this.sessions.get(agentId);
    if (tracker) {
      clearInterval(tracker.timer);
      this.sessions.delete(agentId);
    }
  }

  private async pollSessionFile(agentId: string): Promise<void> {
    const tracker = this.sessions.get(agentId);
    if (!tracker) return;

    try {
      const { filePath, lastLineCount } = tracker;
      if (!fs.existsSync(filePath)) return;

      // Read file line by line
      const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      let lineNum = 0;
      let newInput = 0;
      let newOutput = 0;
      let newCacheRead = 0;
      let newCacheWrite = 0;
      let detectedModel = tracker.model;

      for await (const line of rl) {
        lineNum++;
        // Skip already-processed lines
        if (lineNum <= lastLineCount) continue;

        try {
          const entry = JSON.parse(line);
          if (entry.type === 'assistant' && entry.message?.usage) {
            const u = entry.message.usage;
            newInput += u.input_tokens || 0;
            newOutput += u.output_tokens || 0;
            newCacheRead += u.cache_read_input_tokens || 0;
            newCacheWrite += u.cache_creation_input_tokens || 0;

            // Detect model from the message
            if (entry.message.model) {
              detectedModel = entry.message.model;
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      tracker.lastLineCount = lineNum;
      tracker.model = detectedModel;

      // Only fire callback if new tokens detected
      if (newInput > 0 || newOutput > 0 || newCacheRead > 0 || newCacheWrite > 0) {
        tracker.accumulated.inputTokens += newInput;
        tracker.accumulated.outputTokens += newOutput;
        tracker.accumulated.cacheReadTokens += newCacheRead;
        tracker.accumulated.cacheWriteTokens += newCacheWrite;

        const acc = tracker.accumulated;

        const pricing = this.findPricing(detectedModel);
        const totalCost = (acc.inputTokens * pricing.inputPer1M + acc.outputTokens * pricing.outputPer1M) / 1_000_000;
        const deltaCost = (newInput * pricing.inputPer1M + newOutput * pricing.outputPer1M) / 1_000_000;

        this.onCostDetected?.(agentId, {
          totalCost,
          inputTokens: acc.inputTokens,
          outputTokens: acc.outputTokens,
          cacheReadTokens: acc.cacheReadTokens,
          cacheWriteTokens: acc.cacheWriteTokens,
          model: detectedModel,
          timestamp: Date.now(),
          deltaInputTokens: newInput,
          deltaOutputTokens: newOutput,
          deltaCost,
        });

        console.log(
          `[CostTracker] Agent=${agentId} model=${detectedModel} ` +
          `in=${acc.inputTokens.toLocaleString()} out=${acc.outputTokens.toLocaleString()} ` +
          `cache_read=${acc.cacheReadTokens.toLocaleString()} cache_write=${acc.cacheWriteTokens.toLocaleString()}`,
        );
      }
    } catch (err) {
      console.error(`[CostTracker] Error polling session file for agent=${agentId}:`, err);
    }
  }

  // ── Strategy 2: PTY Output Parsing (non-Claude CLIs) ───────

  processOutput(agentId: string, data: string): void {
    // Skip if we're tracking this agent via session file
    if (this.sessions.has(agentId)) return;

    let buffer = (this.buffers.get(agentId) || '') + data;
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer = buffer.slice(-MAX_BUFFER_SIZE);
    }
    this.buffers.set(agentId, buffer);

    this.tryParse(agentId, data);
  }

  private tryParse(agentId: string, data: string): void {
    const costMatch = COST_PATTERN.exec(data);
    if (costMatch) {
      const totalCost = parseFloat(costMatch[1]);
      if (totalCost > 0) {
        this.onCostDetected?.(agentId, {
          totalCost,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: 'unknown',
          timestamp: Date.now(),
          deltaInputTokens: 0,
          deltaOutputTokens: 0,
          deltaCost: totalCost,
        });
      }
      return;
    }

    const inputMatch = INPUT_TOKENS_PATTERN.exec(data);
    const outputMatch = OUTPUT_TOKENS_PATTERN.exec(data);
    if (inputMatch || outputMatch) {
      const inputTokens = inputMatch ? parseInt(inputMatch[1].replace(/,/g, ''), 10) : 0;
      const outputTokens = outputMatch ? parseInt(outputMatch[1].replace(/,/g, ''), 10) : 0;

      if (inputTokens > 0 || outputTokens > 0) {
        const pricing = MODEL_PRICING['default'];
        const cost = (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;

        this.onCostDetected?.(agentId, {
          totalCost: cost,
          inputTokens,
          outputTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: 'unknown',
          timestamp: Date.now(),
          deltaInputTokens: inputTokens,
          deltaOutputTokens: outputTokens,
          deltaCost: cost,
        });
      }
    }
  }

  clearBuffer(agentId: string): void {
    this.buffers.delete(agentId);
  }

  clearAll(): void {
    this.buffers.clear();
    for (const tracker of this.sessions.values()) {
      clearInterval(tracker.timer);
    }
    this.sessions.clear();
  }
}
