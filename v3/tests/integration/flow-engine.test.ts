import { describe, it, expect, vi } from 'vitest';
import { FlowRunner } from '../../electron/flow-engine/flow-runner';
import { makeNode, makeEdge, makeFlow, mockLLMProvider } from '../setup';
import { getFirestore } from 'firebase/firestore';
import type { FlowEvent } from '../../electron/flow-engine/types';

const db = getFirestore();

describe('Flow Engine Integration', () => {
  describe('multi-step LLM pipeline', () => {
    it('chains input → LLM → output with data flowing through', async () => {
      const llm = mockLLMProvider('Generated summary');
      const runner = new FlowRunner(db, llm);

      const flow = makeFlow(
        [
          makeNode('input', 'input', { topic: 'TypeScript' }),
          makeNode('llm', 'llm', { prompt: 'Summarize {{topic}}', systemPrompt: 'Be concise' }),
          makeNode('output', 'output', { format: 'json' }),
        ],
        [makeEdge('input', 'llm'), makeEdge('llm', 'output')],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');

      // Verify data flow
      const inputResult = state.nodeResults['input'];
      expect(inputResult.status).toBe('success');
      expect((inputResult.output as { topic: string }).topic).toBe('TypeScript');

      const llmResult = state.nodeResults['llm'];
      expect(llmResult.status).toBe('success');
      expect((llmResult.output as { response: string }).response).toBe('Generated summary');

      const outputResult = state.nodeResults['output'];
      expect(outputResult.status).toBe('success');
    });
  });

  describe('branching pipeline', () => {
    it('executes conditional branch with downstream skipping', async () => {
      const llm = mockLLMProvider('positive result');
      const runner = new FlowRunner(db, llm);

      const flow = makeFlow(
        [
          makeNode('input', 'input', { score: 85 }),
          makeNode('check', 'branch', { condition: 'gt', field: 'score', value: 70 }),
          makeNode('pass-llm', 'llm', { prompt: 'Congratulations on score {{score}}!' }),
          makeNode('fail-out', 'output', { format: 'text' }),
          makeNode('pass-out', 'output', { format: 'json' }),
        ],
        [
          makeEdge('input', 'check'),
          makeEdge('check', 'pass-llm', 'true'),
          makeEdge('check', 'fail-out', 'false'),
          makeEdge('pass-llm', 'pass-out'),
        ],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');

      // Branch took the 'true' path
      expect(state.nodeResults['check'].status).toBe('success');
      expect((state.nodeResults['check'].output as { branch: string }).branch).toBe('true');

      // True path executed
      expect(state.nodeResults['pass-llm'].status).toBe('success');
      expect(state.nodeResults['pass-out'].status).toBe('success');

      // False path skipped
      expect(state.nodeResults['fail-out'].status).toBe('skipped');
    });
  });

  describe('agent delegation flow', () => {
    it('executes input → agent → output with delegation', async () => {
      const runner = new FlowRunner(db);

      const flow = makeFlow(
        [
          makeNode('input', 'input', { module: 'auth' }),
          makeNode('agent', 'agent', { agentName: 'backend-bot', task: 'Fix {{module}}' }),
          makeNode('output', 'output'),
        ],
        [makeEdge('input', 'agent'), makeEdge('agent', 'output')],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');

      const agentResult = state.nodeResults['agent'];
      expect(agentResult.status).toBe('success');
      const output = agentResult.output as { delegated: boolean; agentName: string; task: string };
      expect(output.delegated).toBe(true);
      expect(output.agentName).toBe('backend-bot');
      expect(output.task).toBe('Fix auth');
    });
  });

  describe('API call flow', () => {
    it('executes input → API → output with template variables', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ users: [{ id: 1, name: 'Alice' }] }),
      };
      vi.stubGlobal('fetch', vi.fn(async () => mockResponse));

      const runner = new FlowRunner(db);
      const flow = makeFlow(
        [
          makeNode('input', 'input', { endpoint: 'users' }),
          makeNode('api', 'api', { method: 'GET', url: 'https://api.test/{{endpoint}}' }),
          makeNode('output', 'output', { format: 'json' }),
        ],
        [makeEdge('input', 'api'), makeEdge('api', 'output')],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');

      const apiResult = state.nodeResults['api'];
      expect(apiResult.status).toBe('success');
      expect((apiResult.output as { data: { users: { name: string }[] } }).data.users[0].name).toBe('Alice');

      vi.unstubAllGlobals();
    });
  });

  describe('diamond dependency flow', () => {
    it('merges parallel branches at convergence point', async () => {
      const llm = {
        chat: vi.fn()
          .mockResolvedValueOnce('Result A')
          .mockResolvedValueOnce('Result B'),
      };
      const runner = new FlowRunner(db, llm);

      const flow = makeFlow(
        [
          makeNode('input', 'input', { data: 'start' }),
          makeNode('llm-a', 'llm', { prompt: 'Process A: {{data}}' }),
          makeNode('llm-b', 'llm', { prompt: 'Process B: {{data}}' }),
          makeNode('output', 'output', { format: 'json' }),
        ],
        [
          makeEdge('input', 'llm-a'),
          makeEdge('input', 'llm-b'),
          makeEdge('llm-a', 'output'),
          makeEdge('llm-b', 'output'),
        ],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');

      // Both LLM nodes executed in parallel
      expect(state.nodeResults['llm-a'].status).toBe('success');
      expect(state.nodeResults['llm-b'].status).toBe('success');

      // Output received merged inputs from both
      const outputResult = state.nodeResults['output'];
      expect(outputResult.status).toBe('success');
    });
  });

  describe('human-in-the-loop flow', () => {
    it('pauses at human node, resumes, and completes', async () => {
      const llm = mockLLMProvider('Draft response');
      const runner = new FlowRunner(db, llm);

      const flow = makeFlow(
        [
          makeNode('input', 'input', { query: 'Explain AI' }),
          makeNode('llm', 'llm', { prompt: 'Answer: {{query}}' }),
          makeNode('review', 'human', { prompt: 'Approve this response?', description: 'Review LLM output' }),
          makeNode('output', 'output', { format: 'json' }),
        ],
        [
          makeEdge('input', 'llm'),
          makeEdge('llm', 'review'),
          makeEdge('review', 'output'),
        ],
      );

      const events: FlowEvent[] = [];
      runner.on('event', (e: FlowEvent) => events.push(e));

      const runPromise = runner.run(flow);

      // Wait for pause at human node
      await new Promise<void>(resolve => {
        const check = () => {
          if (events.some(e => e.type === 'flow:paused')) resolve();
          else setTimeout(check, 10);
        };
        check();
      });

      // Verify LLM completed before human
      expect(events.some(e => e.type === 'node:complete' && e.nodeId === 'llm')).toBe(true);

      // Get pause event
      const pauseEvent = events.find(e => e.type === 'flow:paused') as Extract<FlowEvent, { type: 'flow:paused' }>;
      expect(pauseEvent.pendingNodeId).toBe('review');

      // Resume with approval
      await runner.resume(pauseEvent.runId, {
        nodeId: 'review',
        approved: true,
        data: { feedback: 'Approved' },
      });

      const state = await runPromise;
      expect(state.status).toBe('completed');
      expect(state.nodeResults['output'].status).toBe('success');
    });
  });

  describe('event tracking', () => {
    it('emits complete lifecycle events', async () => {
      const runner = new FlowRunner(db);
      const events: FlowEvent[] = [];
      runner.on('event', (e: FlowEvent) => events.push(e));

      const flow = makeFlow(
        [
          makeNode('in', 'input', { x: 1 }),
          makeNode('out', 'output'),
        ],
        [makeEdge('in', 'out')],
      );

      await runner.run(flow);

      // Should have: node:start(in), node:complete(in), node:start(out), node:complete(out), flow:completed
      const startEvents = events.filter(e => e.type === 'node:start');
      const completeEvents = events.filter(e => e.type === 'node:complete');
      const flowCompleted = events.filter(e => e.type === 'flow:completed');

      expect(startEvents).toHaveLength(2);
      expect(completeEvents).toHaveLength(2);
      expect(flowCompleted).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('fails gracefully when a node throws', async () => {
      const runner = new FlowRunner(db);

      // LLM node without provider will return error
      const flow = makeFlow(
        [
          makeNode('input', 'input', { data: 'test' }),
          makeNode('llm', 'llm', { prompt: 'test' }),
          makeNode('output', 'output'),
        ],
        [makeEdge('input', 'llm'), makeEdge('llm', 'output')],
      );

      const events: FlowEvent[] = [];
      runner.on('event', (e: FlowEvent) => events.push(e));

      const state = await runner.run(flow);
      expect(state.status).toBe('failed');
      expect(events.some(e => e.type === 'flow:failed')).toBe(true);
    });

    it('does not execute downstream nodes after failure', async () => {
      const runner = new FlowRunner(db);

      const flow = makeFlow(
        [
          makeNode('input', 'input'),
          makeNode('llm', 'llm', { prompt: 'test' }), // will fail (no provider)
          makeNode('output', 'output'),
        ],
        [makeEdge('input', 'llm'), makeEdge('llm', 'output')],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('failed');
      // Output node should not have been executed
      expect(state.nodeResults['output']).toBeUndefined();
    });
  });
});
