import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// ── Types ────────────────────────────────────────────────────

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'google';
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ── LLM Client ───────────────────────────────────────────────

export class LLMClient {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    if (!config.apiKey) {
      throw new Error(`API key is required for provider '${config.provider}'`);
    }
    this.config = config;
  }

  /**
   * Send chat messages and get a text response.
   */
  async chat(messages: ChatMessage[]): Promise<string> {
    switch (this.config.provider) {
      case 'anthropic':
        return this.chatAnthropic(messages);
      case 'openai':
        return this.chatOpenAI(messages);
      case 'google':
        return this.chatGoogle(messages);
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }

  /**
   * Send chat messages and parse the response as JSON.
   * Extracts JSON from markdown code blocks if present.
   */
  async chatJSON<T>(messages: ChatMessage[], _schema?: object): Promise<T> {
    // Append JSON instruction to the last user message
    const jsonMessages = messages.map((m, i) => {
      if (i === messages.length - 1 && m.role === 'user') {
        return {
          ...m,
          content: m.content + '\n\nIMPORTANT: Respond with valid JSON only. No markdown, no explanation, just the JSON object.',
        };
      }
      return m;
    });

    const raw = await this.chat(jsonMessages);
    return this.parseJSON<T>(raw);
  }

  // ── Provider Implementations ─────────────────────────────────

  private async chatAnthropic(messages: ChatMessage[]): Promise<string> {
    const client = new Anthropic({ apiKey: this.config.apiKey });

    // Separate system message from user/assistant messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 4096,
      system: systemMessages.map(m => m.content).join('\n\n') || undefined,
      messages: chatMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    const block = response.content[0];
    if (block.type === 'text') {
      return block.text;
    }
    throw new Error('Unexpected response type from Anthropic API');
  }

  private async chatOpenAI(messages: ChatMessage[]): Promise<string> {
    const client = new OpenAI({ apiKey: this.config.apiKey });

    const response = await client.chat.completions.create({
      model: this.config.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: this.config.maxTokens ?? 4096,
    });

    return response.choices[0]?.message?.content ?? '';
  }

  private async chatGoogle(messages: ChatMessage[]): Promise<string> {
    // Google Gemini REST API (no SDK dependency needed)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

    // Convert messages to Gemini format
    const systemInstruction = messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n');

    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: this.config.maxTokens ?? 4096,
      },
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google Gemini API error (${response.status}): ${errText}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  // ── Helpers ──────────────────────────────────────────────────

  private parseJSON<T>(raw: string): T {
    // Try direct parse first
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Extract from markdown code block
      const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (match) {
        return JSON.parse(match[1].trim()) as T;
      }
      throw new Error(`Failed to parse JSON from LLM response:\n${raw.slice(0, 500)}`);
    }
  }
}

// ── Factory ──────────────────────────────────────────────────

/**
 * Create an LLMClient from environment variables.
 * Checks ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY in order.
 */
export function createLLMClientFromEnv(overrides?: Partial<LLMConfig>): LLMClient {
  if (overrides?.apiKey && overrides?.provider && overrides?.model) {
    return new LLMClient(overrides as LLMConfig);
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return new LLMClient({
      provider: 'anthropic',
      apiKey: anthropicKey,
      model: overrides?.model ?? 'claude-sonnet-4-20250514',
      ...overrides,
    });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return new LLMClient({
      provider: 'openai',
      apiKey: openaiKey,
      model: overrides?.model ?? 'gpt-4o',
      ...overrides,
    });
  }

  const googleKey = process.env.GOOGLE_API_KEY;
  if (googleKey) {
    return new LLMClient({
      provider: 'google',
      apiKey: googleKey,
      model: overrides?.model ?? 'gemini-2.0-flash',
      ...overrides,
    });
  }

  throw new Error(
    'No LLM API key found. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY',
  );
}
