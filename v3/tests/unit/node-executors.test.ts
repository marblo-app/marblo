import { describe, it, expect, vi } from 'vitest';
import { createExecutors, getExecutor } from '../../electron/flow-engine/node-executors';
import { makeNodeContext, mockLLMProvider } from '../setup';

describe('InputExecutor', () => {
  it('passes through config and inputs', async () => {
    const executor = getExecutor('input');
    const result = await executor(
      makeNodeContext({
        nodeType: 'input',
        config: { name: 'test-input' },
        inputs: { data: 'hello' },
      }),
    );
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ name: 'test-input', data: 'hello' });
  });
});

describe('LLMExecutor', () => {
  it('calls LLM provider and returns response', async () => {
    const llm = mockLLMProvider('LLM says hello');
    const executors = createExecutors(llm);
    const result = await executors.llm(
      makeNodeContext({
        nodeType: 'llm',
        config: { prompt: 'Say hello' },
      }),
    );
    expect(result.status).toBe('success');
    expect((result.output as { response: string }).response).toBe('LLM says hello');
  });

  it('replaces {{variable}} placeholders in prompt', async () => {
    const chatSpy = vi.fn(async () => 'response');
    const llm = { chat: chatSpy };
    const executors = createExecutors(llm);
    await executors.llm(
      makeNodeContext({
        nodeType: 'llm',
        config: { prompt: 'Hello {{name}}, you are {{role}}' },
        inputs: { name: 'Alice', role: 'admin' },
      }),
    );
    const calledMessages = chatSpy.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(calledMessages[0].content).toBe('Hello Alice, you are admin');
  });

  it('includes system prompt when configured', async () => {
    const chatSpy = vi.fn(async () => 'ok');
    const llm = { chat: chatSpy };
    const executors = createExecutors(llm);
    await executors.llm(
      makeNodeContext({
        nodeType: 'llm',
        config: { prompt: 'Question', systemPrompt: 'You are helpful' },
      }),
    );
    const messages = chatSpy.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toBe('You are helpful');
  });

  it('returns error when no LLM provider', async () => {
    const executor = getExecutor('llm'); // no provider
    const result = await executor(makeNodeContext({ nodeType: 'llm', config: { prompt: 'test' } }));
    expect(result.status).toBe('error');
    expect(result.error).toContain('No LLM provider');
  });
});

describe('AgentExecutor', () => {
  it('returns delegation info', async () => {
    const executor = getExecutor('agent');
    const result = await executor(
      makeNodeContext({
        nodeType: 'agent',
        config: { agentName: 'backend-bot', task: 'Fix bug in {{module}}' },
        inputs: { module: 'auth' },
      }),
    );
    expect(result.status).toBe('success');
    const output = result.output as { agentName: string; task: string; delegated: boolean };
    expect(output.agentName).toBe('backend-bot');
    expect(output.task).toBe('Fix bug in auth');
    expect(output.delegated).toBe(true);
  });
});

describe('APIExecutor', () => {
  it('makes a fetch call and returns data', async () => {
    const mockResponse = { ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ result: 42 }) };
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse));

    const executor = getExecutor('api');
    const result = await executor(
      makeNodeContext({
        nodeType: 'api',
        config: { method: 'GET', url: 'https://api.test/data' },
      }),
    );
    expect(result.status).toBe('success');
    expect((result.output as { data: { result: number } }).data.result).toBe(42);

    vi.unstubAllGlobals();
  });

  it('replaces template variables in URL', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'text/plain' }), text: async () => 'ok' }));
    vi.stubGlobal('fetch', fetchSpy);

    const executor = getExecutor('api');
    await executor(
      makeNodeContext({
        nodeType: 'api',
        config: { method: 'GET', url: 'https://api.test/{{resource}}/{{id}}' },
        inputs: { resource: 'users', id: '123' },
      }),
    );
    expect(fetchSpy).toHaveBeenCalledWith('https://api.test/users/123', expect.anything());

    vi.unstubAllGlobals();
  });

  it('returns error on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found', headers: new Headers({ 'content-type': 'text/plain' }), text: async () => 'not found' })));

    const executor = getExecutor('api');
    const result = await executor(
      makeNodeContext({ nodeType: 'api', config: { url: 'https://api.test/missing' } }),
    );
    expect(result.status).toBe('error');
    expect(result.error).toContain('404');

    vi.unstubAllGlobals();
  });
});

describe('HumanExecutor', () => {
  it('returns pending human approval output', async () => {
    const executor = getExecutor('human');
    const result = await executor(
      makeNodeContext({
        nodeType: 'human',
        config: { prompt: 'Please approve', description: 'Review this' },
      }),
    );
    expect(result.status).toBe('success');
    const output = result.output as { _humanPending: boolean; prompt: string };
    expect(output._humanPending).toBe(true);
    expect(output.prompt).toBe('Please approve');
  });
});

describe('BranchExecutor', () => {
  it('evaluates truthy condition', async () => {
    const executor = getExecutor('branch');
    const result = await executor(
      makeNodeContext({
        nodeType: 'branch',
        config: { condition: 'truthy', field: 'active' },
        inputs: { active: true },
      }),
    );
    expect(result.status).toBe('success');
    expect((result.output as { branch: string }).branch).toBe('true');
  });

  it('evaluates falsy condition', async () => {
    const executor = getExecutor('branch');
    const result = await executor(
      makeNodeContext({
        nodeType: 'branch',
        config: { condition: 'truthy', field: 'active' },
        inputs: { active: false },
      }),
    );
    expect((result.output as { branch: string }).branch).toBe('false');
  });

  it('evaluates equals condition', async () => {
    const executor = getExecutor('branch');
    const result = await executor(
      makeNodeContext({
        nodeType: 'branch',
        config: { condition: 'equals', field: 'status', value: 'approved' },
        inputs: { status: 'approved' },
      }),
    );
    expect((result.output as { branch: string }).branch).toBe('true');
  });

  it('evaluates gt condition', async () => {
    const executor = getExecutor('branch');
    const result = await executor(
      makeNodeContext({
        nodeType: 'branch',
        config: { condition: 'gt', field: 'count', value: 5 },
        inputs: { count: 10 },
      }),
    );
    expect((result.output as { branch: string }).branch).toBe('true');
  });

  it('evaluates contains condition', async () => {
    const executor = getExecutor('branch');
    const result = await executor(
      makeNodeContext({
        nodeType: 'branch',
        config: { condition: 'contains', field: 'text', value: 'error' },
        inputs: { text: 'no error found' },
      }),
    );
    expect((result.output as { branch: string }).branch).toBe('true');
  });

  it('defaults to false when field is missing', async () => {
    const executor = getExecutor('branch');
    const result = await executor(
      makeNodeContext({
        nodeType: 'branch',
        config: { condition: 'truthy', field: 'missing' },
        inputs: {},
      }),
    );
    expect((result.output as { branch: string }).branch).toBe('false');
  });
});

describe('OutputExecutor', () => {
  it('returns raw inputs by default', async () => {
    const executor = getExecutor('output');
    const result = await executor(
      makeNodeContext({
        nodeType: 'output',
        config: {},
        inputs: { a: 1, b: 'hello' },
      }),
    );
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ a: 1, b: 'hello' });
  });

  it('formats as text when configured', async () => {
    const executor = getExecutor('output');
    const result = await executor(
      makeNodeContext({
        nodeType: 'output',
        config: { format: 'text' },
        inputs: { msg: 'hello', other: 'world' },
      }),
    );
    expect(result.output).toBe('hello\nworld');
  });
});
