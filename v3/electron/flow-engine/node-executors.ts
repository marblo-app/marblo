import { spawn } from 'node:child_process';
import type { NodeContext, NodeExecutionResult, NodeType, LLMProvider } from './types.js';

// ── Executor Interface ───────────────────────────────────────

export type NodeExecutor = (ctx: NodeContext) => Promise<NodeExecutionResult>;

function makeResult(
  status: NodeExecutionResult['status'],
  output: unknown,
  startedAt: Date,
  error?: string,
): NodeExecutionResult {
  return { status, output, error, startedAt, completedAt: new Date() };
}

// ── Input Executor ───────────────────────────────────────────

const inputExecutor: NodeExecutor = async (ctx) => {
  const start = new Date();
  // Pass through config values and any runtime inputs
  const output = {
    ...ctx.config,
    ...ctx.inputs,
  };
  return makeResult('success', output, start);
};

// ── LLM Executor ─────────────────────────────────────────────

function createLLMExecutor(llmProvider?: LLMProvider): NodeExecutor {
  return async (ctx) => {
    const start = new Date();
    const llm = llmProvider;
    if (!llm) {
      return makeResult('error', null, start, 'No LLM provider configured. Pass an LLMProvider to createExecutors().');
    }

    try {
      // Build prompt from config template + upstream inputs
      let prompt = (ctx.config.prompt as string) || '';
      for (const [key, value] of Object.entries(ctx.inputs)) {
        prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
      }

      const systemPrompt = (ctx.config.systemPrompt as string) || '';
      const messages = [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt },
      ];

      const model = (ctx.config.model as string) || undefined;
      const response = await llm.chat(messages, model);
      return makeResult('success', { response, prompt }, start);
    } catch (e) {
      return makeResult('error', null, start, (e as Error).message);
    }
  };
}

// ── Agent Executor ───────────────────────────────────────────

const agentExecutor: NodeExecutor = async (ctx) => {
  const start = new Date();
  const agentName = (ctx.config.agentName as string) || 'default';
  const task = (ctx.config.task as string) || (ctx.config.taskDescription as string) || '';
  const connectionMode = (ctx.config.connectionMode as string) || 'auto';
  const model = (ctx.config.model as string) || 'claude';
  const role = (ctx.config.role as string) || 'backend';

  // Resolve template variables in task
  let resolvedTask = task;
  for (const [key, value] of Object.entries(ctx.inputs)) {
    resolvedTask = resolvedTask.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }

  // Return delegation info with actionable spawn/connection data.
  // - 'auto' mode: includes spawnConfig so the FlowRunner caller (main.ts) can spawn via bridge.
  // - 'existing' mode: includes existingAgentId so the caller can route to an active PTY session.
  //   TODO: For 'existing' mode, IPC integration with ipcMain is needed to send tasks
  //   to an already-running PTY session. Executors don't have direct access to ipcMain,
  //   so the FlowRunner caller must handle the IPC dispatch.
  return makeResult('success', {
    agentName,
    task: resolvedTask,
    inputs: ctx.inputs,
    delegated: true,
    connectionMode,
    spawnConfig: connectionMode === 'auto' ? { name: agentName, model, role } : undefined,
    existingAgentId: connectionMode === 'existing' ? (ctx.config.agentId as string) : undefined,
  }, start);
};

// ── API Executor ─────────────────────────────────────────────

const apiExecutor: NodeExecutor = async (ctx) => {
  const start = new Date();
  try {
    const method = ((ctx.config.method as string) || 'GET').toUpperCase();
    let url = (ctx.config.url as string) || '';
    const headers = (ctx.config.headers as Record<string, string>) || {};
    let body = ctx.config.body as string | undefined;

    // Template variable replacement in url and body
    for (const [key, value] of Object.entries(ctx.inputs)) {
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      url = url.replace(pattern, String(value));
      if (body) body = body.replace(pattern, String(value));
    }

    const fetchOptions: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = body;
    }

    const response = await fetch(url, fetchOptions);
    const contentType = response.headers.get('content-type') || '';

    let data: unknown;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      return makeResult('error', data, start, `HTTP ${response.status}: ${response.statusText}`);
    }

    return makeResult('success', { status: response.status, data }, start);
  } catch (e) {
    return makeResult('error', null, start, (e as Error).message);
  }
};

// ── Human Executor ───────────────────────────────────────────

/**
 * Human executor pauses the flow and waits for approval.
 * Returns a special 'pending' output that the FlowRunner interprets
 * as a pause signal. The FlowRunner will resume with humanInput.
 */
const humanExecutor: NodeExecutor = async (ctx) => {
  const start = new Date();
  const prompt = (ctx.config.prompt as string) || 'Awaiting human approval';
  const description = (ctx.config.description as string) || '';

  return makeResult('success', {
    _humanPending: true,
    prompt,
    description,
    inputs: ctx.inputs,
  }, start);
};

// ── Branch Executor ──────────────────────────────────────────

const branchExecutor: NodeExecutor = async (ctx) => {
  const start = new Date();
  const condition = (ctx.config.condition as string) || '';
  const field = (ctx.config.field as string) || '';

  let result = false;

  if (field && ctx.inputs[field] !== undefined) {
    // Simple field-based evaluation
    const value = ctx.inputs[field];
    switch (condition) {
      case 'truthy':
        result = !!value;
        break;
      case 'falsy':
        result = !value;
        break;
      case 'equals':
        result = value === ctx.config.value;
        break;
      case 'not_equals':
        result = value !== ctx.config.value;
        break;
      case 'gt':
        result = Number(value) > Number(ctx.config.value);
        break;
      case 'lt':
        result = Number(value) < Number(ctx.config.value);
        break;
      case 'contains':
        result = String(value).includes(String(ctx.config.value));
        break;
      default:
        result = !!value;
    }
  } else if (condition === 'expression' && ctx.config.expression) {
    // Expression-based: check if a known key in inputs is truthy
    const expr = ctx.config.expression as string;
    result = !!ctx.inputs[expr];
  }

  return makeResult('success', {
    branch: result ? 'true' : 'false',
    condition,
    field,
    evaluatedValue: field ? ctx.inputs[field] : undefined,
  }, start);
};

// ── Output Executor ──────────────────────────────────────────

const outputExecutor: NodeExecutor = async (ctx) => {
  const start = new Date();
  const format = (ctx.config.format as string) || 'raw';

  let output: unknown;
  if (format === 'json') {
    output = ctx.inputs;
  } else if (format === 'text') {
    output = Object.values(ctx.inputs)
      .map(v => (typeof v === 'string' ? v : JSON.stringify(v)))
      .join('\n');
  } else {
    output = ctx.inputs;
  }

  return makeResult('success', output, start);
};

// ── Code Executor ───────────────────────────────────────────

const codeExecutor: NodeExecutor = async (ctx) => {
  const start = new Date();
  const language = (ctx.config.language as string) || 'node';
  const script = (ctx.config.script as string) || '';
  const cwd = (ctx.config.cwd as string) || process.cwd();
  const timeout = ((ctx.config.timeout as number) || 30) * 1000; // seconds → ms
  const envVars = (ctx.config.envVars as Record<string, string>) || {};

  if (!script.trim()) {
    return makeResult('error', null, start, 'No script provided');
  }

  const commandMap: Record<string, { cmd: string; args: string[] }> = {
    python: { cmd: 'python3', args: ['-c', script] },
    shell: { cmd: 'sh', args: ['-c', script] },
    node: { cmd: 'node', args: ['-e', script] },
    typescript: { cmd: 'npx', args: ['tsx', '-e', script] },
  };

  const entry = commandMap[language] || commandMap.node;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const child = spawn(entry.cmd, entry.args, {
      cwd,
      env: {
        ...process.env,
        ...envVars,
        FLOW_INPUT: JSON.stringify(ctx.inputs),
      },
      timeout,
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve(makeResult('error', { stdout, stderr }, start, `Process killed: timeout ${timeout / 1000}s exceeded`));
        return;
      }
      if (code !== 0) {
        resolve(makeResult('error', { stdout, stderr }, start, `Exit code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      // Try JSON parse, fall back to raw string
      let output: unknown;
      try {
        output = JSON.parse(stdout.trim());
      } catch {
        output = stdout.trim();
      }
      resolve(makeResult('success', output, start));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(makeResult('error', null, start, err.message));
    });
  });
};

// ── Integration Executor ────────────────────────────────────

const integrationExecutor: NodeExecutor = async (ctx) => {
  const start = new Date();
  const service = (ctx.config.service as string) || 'webhook';
  const action = (ctx.config.action as string) || 'send';

  // Template variable replacement helper
  function replaceVars(template: string): string {
    let result = template;
    for (const [key, value] of Object.entries(ctx.inputs)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
    }
    // Also replace {{input}} with all inputs as JSON
    result = result.replace(/\{\{input\}\}/g, JSON.stringify(ctx.inputs));
    return result;
  }

  try {
    let url = '';
    let method = 'POST';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: string | undefined;

    switch (service) {
      case 'slack': {
        url = (ctx.config.webhookUrl as string) || '';
        const channel = ctx.config.channel as string | undefined;
        const message = replaceVars((ctx.config.message as string) || '{{input}}');
        body = JSON.stringify({ text: message, ...(channel ? { channel } : {}) });
        break;
      }
      case 'discord': {
        url = (ctx.config.webhookUrl as string) || '';
        const message = replaceVars((ctx.config.message as string) || '{{input}}');
        body = JSON.stringify({ content: message });
        break;
      }
      case 'telegram': {
        const token = (ctx.config.token as string) || '';
        const chatId = (ctx.config.chatId as string) || '';
        url = `https://api.telegram.org/bot${token}/sendMessage`;
        const message = replaceVars((ctx.config.message as string) || '{{input}}');
        body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' });
        break;
      }
      case 'notion': {
        const token = (ctx.config.token as string) || '';
        const parentId = (ctx.config.parentId as string) || '';
        url = 'https://api.notion.com/v1/pages';
        headers['Authorization'] = `Bearer ${token}`;
        headers['Notion-Version'] = '2022-06-28';
        const title = replaceVars((ctx.config.title as string) || '{{input}}');
        body = JSON.stringify({
          parent: { database_id: parentId },
          properties: { title: { title: [{ text: { content: title } }] } },
        });
        break;
      }
      case 'github': {
        const token = (ctx.config.token as string) || '';
        const endpoint = replaceVars((ctx.config.endpoint as string) || '');
        url = endpoint.startsWith('https://') ? endpoint : `https://api.github.com${endpoint}`;
        method = ((ctx.config.method as string) || 'POST').toUpperCase();
        headers['Authorization'] = `Bearer ${token}`;
        headers['Accept'] = 'application/vnd.github.v3+json';
        if (ctx.config.body) body = replaceVars(JSON.stringify(ctx.config.body));
        break;
      }
      case 'sheets': {
        const token = (ctx.config.token as string) || '';
        const spreadsheetId = (ctx.config.spreadsheetId as string) || '';
        const range = (ctx.config.range as string) || 'Sheet1!A1';
        url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;
        headers['Authorization'] = `Bearer ${token}`;
        const values = ctx.config.values || [[replaceVars('{{input}}')]];
        body = JSON.stringify({ values });
        break;
      }
      case 'email':
      case 'webhook':
      default: {
        url = (ctx.config.webhookUrl as string) || (ctx.config.url as string) || '';
        method = ((ctx.config.method as string) || 'POST').toUpperCase();
        const customHeaders = (ctx.config.headers as Record<string, string>) || {};
        Object.assign(headers, customHeaders);
        if (ctx.config.body) {
          body = replaceVars(typeof ctx.config.body === 'string' ? ctx.config.body : JSON.stringify(ctx.config.body));
        } else {
          body = JSON.stringify(ctx.inputs);
        }
        break;
      }
    }

    if (!url) {
      return makeResult('error', null, start, `No URL/webhook configured for ${service}`);
    }

    const fetchOptions: RequestInit = { method, headers };
    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = body;
    }

    const response = await fetch(url, fetchOptions);
    const contentType = response.headers.get('content-type') || '';
    let data: unknown;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      return makeResult('error', data, start, `HTTP ${response.status}: ${response.statusText}`);
    }

    return makeResult('success', { service, action, status: response.status, data }, start);
  } catch (e) {
    return makeResult('error', null, start, (e as Error).message);
  }
};

// ── Registry ─────────────────────────────────────────────────

let cachedExecutors: Record<NodeType, NodeExecutor> | null = null;

/**
 * Create executor registry with optional LLM provider injection.
 */
export function createExecutors(llmProvider?: LLMProvider): Record<NodeType, NodeExecutor> {
  return {
    input: inputExecutor,
    llm: createLLMExecutor(llmProvider),
    agent: agentExecutor,
    api: apiExecutor,
    human: humanExecutor,
    branch: branchExecutor,
    output: outputExecutor,
    code: codeExecutor,
    integration: integrationExecutor,
  };
}

/**
 * Get a single executor by node type.
 * Uses a default registry (without LLM). For LLM support, use createExecutors().
 */
export function getExecutor(nodeType: NodeType, llmProvider?: LLMProvider): NodeExecutor {
  if (llmProvider) {
    const executors = createExecutors(llmProvider);
    return executors[nodeType];
  }
  if (!cachedExecutors) {
    cachedExecutors = createExecutors();
  }
  const executor = cachedExecutors[nodeType];
  if (!executor) {
    throw new Error(`No executor registered for node type: ${nodeType}`);
  }
  return executor;
}
