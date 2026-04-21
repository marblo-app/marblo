import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import type { LLMProvider } from './types.js';

// ── LLM Provider Implementation ─────────────────────────────
// Routes to Anthropic, Google Gemini, or OpenAI SDK based on model ID prefix.

interface LLMProviderOptions {
  anthropicApiKey?: string;
  googleApiKey?: string;
  openaiApiKey?: string;
}

export function createLLMProvider(options: LLMProviderOptions = {}): LLMProvider {
  const anthropicKey = options.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  const googleKey = options.googleApiKey || process.env.GOOGLE_AI_API_KEY;
  const openaiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;

  let anthropic: Anthropic | null = null;
  let gemini: GoogleGenerativeAI | null = null;
  let openai: OpenAI | null = null;

  function getAnthropic(): Anthropic {
    if (!anthropic) {
      if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured');
      anthropic = new Anthropic({ apiKey: anthropicKey });
    }
    return anthropic;
  }

  function getGemini(): GoogleGenerativeAI {
    if (!gemini) {
      if (!googleKey) throw new Error('GOOGLE_AI_API_KEY not configured');
      gemini = new GoogleGenerativeAI(googleKey);
    }
    return gemini;
  }

  function getOpenAI(): OpenAI {
    if (!openai) {
      if (!openaiKey) throw new Error('OPENAI_API_KEY not configured');
      openai = new OpenAI({ apiKey: openaiKey });
    }
    return openai;
  }

  return {
    async chat(
      messages: Array<{ role: string; content: string }>,
      model?: string,
    ): Promise<string> {
      const modelId = model || 'claude-sonnet-4-6';

      if (modelId.startsWith('claude-') || modelId.startsWith('anthropic')) {
        return chatAnthropic(getAnthropic(), messages, modelId);
      }

      if (modelId.startsWith('gemini-')) {
        return chatGemini(getGemini(), messages, modelId);
      }

      if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4')) {
        return chatOpenAI(getOpenAI(), messages, modelId);
      }

      // Fallback: try available providers in order
      if (anthropicKey) {
        return chatAnthropic(getAnthropic(), messages, modelId);
      }
      if (googleKey) {
        return chatGemini(getGemini(), messages, modelId);
      }
      if (openaiKey) {
        return chatOpenAI(getOpenAI(), messages, modelId);
      }

      throw new Error(`No API key configured for model: ${modelId}`);
    },
  };
}

async function chatAnthropic(
  client: Anthropic,
  messages: Array<{ role: string; content: string }>,
  model: string,
): Promise<string> {
  // Separate system message from user/assistant messages
  const systemMessages = messages.filter((m) => m.role === 'system');
  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  // Ensure at least one user message
  if (chatMessages.length === 0) {
    chatMessages.push({ role: 'user', content: '(empty prompt)' });
  }

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    ...(systemMessages.length > 0 ? { system: systemMessages.map((m) => m.content).join('\n') } : {}),
    messages: chatMessages,
  });

  // Extract text from response content blocks
  const textBlocks = response.content.filter((b) => b.type === 'text');
  return textBlocks.map((b) => b.text).join('');
}

async function chatOpenAI(
  client: OpenAI,
  messages: Array<{ role: string; content: string }>,
  model: string,
): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    })),
  });

  return response.choices[0]?.message?.content || '';
}

async function chatGemini(
  client: GoogleGenerativeAI,
  messages: Array<{ role: string; content: string }>,
  model: string,
): Promise<string> {
  // Separate system messages from conversation messages
  const systemMessages = messages.filter((m) => m.role === 'system');
  const chatMessages = messages.filter((m) => m.role !== 'system');

  // Build the generative model with optional system instruction
  const generativeModel = client.getGenerativeModel({
    model,
    ...(systemMessages.length > 0
      ? { systemInstruction: systemMessages.map((m) => m.content).join('\n') }
      : {}),
  });

  // Convert messages to Gemini Content format
  // Gemini uses 'user' and 'model' roles (not 'assistant')
  const contents = chatMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // Ensure at least one user message
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: '(empty prompt)' }] });
  }

  // Use startChat + sendMessage for multi-turn, generateContent for single-turn
  if (contents.length === 1) {
    const response = await generativeModel.generateContent({
      contents,
    });
    return response.response.text();
  }

  // Multi-turn: pass history (all but last) and send the last message
  const history = contents.slice(0, -1);
  const lastMessage = contents[contents.length - 1];

  const chat = generativeModel.startChat({ history });
  const response = await chat.sendMessage(lastMessage.parts);
  return response.response.text();
}
