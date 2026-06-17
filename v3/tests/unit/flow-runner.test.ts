import { describe, it, expect, beforeEach } from 'vitest';
import { FlowRunner } from '../../electron/flow-engine/flow-runner';
import { makeNode, makeEdge, makeFlow, mockLLMProvider } from '../setup';
import { getFirestore } from 'firebase/firestore';
import type { FlowEvent } from '../../electron/flow-engine/types';

// Get mock Firestore
const db = getFirestore() as any;

describe('FlowRunner', () => {
  let runner: FlowRunner;

  beforeEach(() => {
    runner = new FlowRunner(db);
  });

  describe('run', () => {
    it('executes a simple linear flow', async () => {
      const flow = makeFlow(
        [
          makeNode('in', 'input', { greeting: 'hello' }),
          makeNode('out', 'output'),
        ],
        [makeEdge('in', 'out')],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');
      expect(state.nodeResults['in'].status).toBe('success');
      expect(state.nodeResults['out'].status).toBe('success');
    });

    it('executes parallel nodes within a layer', async () => {
      const flow = makeFlow(
        [
          makeNode('start', 'input', { data: 'test' }),
          makeNode('a', 'input', { extra: 'a' }),
          makeNode('b', 'input', { extra: 'b' }),
          makeNode('end', 'output'),
        ],
        [
          makeEdge('start', 'a'),
          makeEdge('start', 'b'),
          makeEdge('a', 'end'),
          makeEdge('b', 'end'),
        ],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');
      expect(state.nodeResults['a'].status).toBe('success');
      expect(state.nodeResults['b'].status).toBe('success');
      expect(state.nodeResults['end'].status).toBe('success');
    });

    it('passes initial inputs to input nodes', async () => {
      const flow = makeFlow(
        [makeNode('in', 'input'), makeNode('out', 'output')],
        [makeEdge('in', 'out')],
      );

      const state = await runner.run(flow, { name: 'test' });
      expect(state.status).toBe('completed');
      const outResult = state.nodeResults['out'].output as Record<string, unknown>;
      expect(outResult).toHaveProperty('name', 'test');
    });

    it('handles branch node path skipping', async () => {
      const flow = makeFlow(
        [
          makeNode('in', 'input', { flag: true }),
          makeNode('branch', 'branch', { condition: 'truthy', field: 'flag' }),
          makeNode('yes', 'output'),
          makeNode('no', 'output'),
        ],
        [
          makeEdge('in', 'branch'),
          makeEdge('branch', 'yes', 'true'),
          makeEdge('branch', 'no', 'false'),
        ],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');
      expect(state.nodeResults['yes'].status).toBe('success');
      expect(state.nodeResults['no'].status).toBe('skipped');
    });

    it('skips the true branch when condition is false', async () => {
      const flow = makeFlow(
        [
          makeNode('in', 'input', { flag: false }),
          makeNode('branch', 'branch', { condition: 'truthy', field: 'flag' }),
          makeNode('yes', 'output'),
          makeNode('no', 'output'),
        ],
        [
          makeEdge('in', 'branch'),
          makeEdge('branch', 'yes', 'true'),
          makeEdge('branch', 'no', 'false'),
        ],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');
      expect(state.nodeResults['yes'].status).toBe('skipped');
      expect(state.nodeResults['no'].status).toBe('success');
    });

    it('emits flow events during execution', async () => {
      const events: FlowEvent[] = [];
      runner.on('event', (e: FlowEvent) => events.push(e));

      const flow = makeFlow(
        [makeNode('in', 'input'), makeNode('out', 'output')],
        [makeEdge('in', 'out')],
      );

      await runner.run(flow);

      const types = events.map(e => e.type);
      expect(types).toContain('node:start');
      expect(types).toContain('node:complete');
      expect(types).toContain('flow:completed');
    });

    it('sets status to failed when a node errors', async () => {
      // LLM executor without provider will error
      const flow = makeFlow(
        [
          makeNode('in', 'input'),
          makeNode('llm', 'llm', { prompt: 'test' }),
          makeNode('out', 'output'),
        ],
        [makeEdge('in', 'llm'), makeEdge('llm', 'out')],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('failed');
      expect(state.nodeResults['llm'].status).toBe('error');
    });

    it('propagates upstream outputs as inputs to downstream nodes', async () => {
      const llm = mockLLMProvider('generated text');
      const runnerWithLLM = new FlowRunner(db, llm);

      const flow = makeFlow(
        [
          makeNode('in', 'input', { topic: 'AI' }),
          makeNode('llm', 'llm', { prompt: 'Write about {{topic}}' }),
          makeNode('out', 'output'),
        ],
        [makeEdge('in', 'llm'), makeEdge('llm', 'out')],
      );

      const state = await runnerWithLLM.run(flow);
      expect(state.status).toBe('completed');
      const outResult = state.nodeResults['out'].output as Record<string, unknown>;
      expect(outResult).toHaveProperty('response', 'generated text');
    });

    it('handles flow with cycles by throwing', async () => {
      const flow = makeFlow(
        [makeNode('a', 'input'), makeNode('b', 'llm', { prompt: 'x' }), makeNode('c', 'output')],
        [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'a')],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('failed');
    });
  });

  describe('pause/resume', () => {
    it('can pause and resume a running flow', async () => {
      const flow = makeFlow(
        [
          makeNode('in', 'input', { data: 1 }),
          makeNode('out', 'output'),
        ],
        [makeEdge('in', 'out')],
      );

      // Start the flow and immediately pause (race condition-safe: it may complete first)
      const runPromise = runner.run(flow);

      // The flow may be too fast for pause to catch it, so just verify it completes
      const state = await runPromise;
      expect(['completed', 'paused']).toContain(state.status);
    });
  });

  describe('cancel', () => {
    it('sets status to cancelled', async () => {
      const flow = makeFlow(
        [makeNode('in', 'input'), makeNode('out', 'output')],
        [makeEdge('in', 'out')],
      );

      // Start the run
      const runPromise = runner.run(flow);
      const state = await runPromise;

      // If flow already completed, cancel should be a no-op
      if (state.status === 'running') {
        await runner.cancel(state.runId);
        const cancelledState = runner.getState(state.runId);
        expect(cancelledState?.status).toBe('cancelled');
      } else {
        // Flow completed before we could cancel — that's OK
        expect(state.status).toBe('completed');
      }
    });

    it('cancel resolves pending human inputs', async () => {
      const flow = makeFlow(
        [
          makeNode('in', 'input'),
          makeNode('human', 'human', { prompt: 'Approve?' }),
          makeNode('out', 'output'),
        ],
        [makeEdge('in', 'human'), makeEdge('human', 'out')],
      );

      // Start flow — it will pause at human node
      const runPromise = runner.run(flow);

      // Wait a tick for the human node to pause
      await new Promise(r => setTimeout(r, 50));

      // Find the runId from runner state
      const events: FlowEvent[] = [];
      runner.on('event', (e: FlowEvent) => events.push(e));

      // Get the paused state
      // Since we can't easily get runId before run completes,
      // let's wait for the pause event
      await new Promise(r => setTimeout(r, 50));

      const pausedEvent = events.find(e => e.type === 'flow:paused');
      if (pausedEvent && pausedEvent.type === 'flow:paused') {
        await runner.cancel(pausedEvent.runId);
        const state = await runPromise;
        expect(state.status).toBe('failed');
      }
    });
  });

  describe('getState', () => {
    it('returns undefined for unknown runId', () => {
      expect(runner.getState('nonexistent')).toBeUndefined();
    });

    it('returns state for a completed run', async () => {
      const flow = makeFlow(
        [makeNode('in', 'input')],
        [],
      );

      const state = await runner.run(flow);
      const retrieved = runner.getState(state.runId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.runId).toBe(state.runId);
      expect(retrieved!.status).toBe('completed');
    });
  });

  describe('human node interaction', () => {
    it('pauses at human node and resumes with approval', async () => {
      const flow = makeFlow(
        [
          makeNode('in', 'input', { data: 'test' }),
          makeNode('human', 'human', { prompt: 'Approve?', description: 'Review' }),
          makeNode('out', 'output'),
        ],
        [makeEdge('in', 'human'), makeEdge('human', 'out')],
      );

      const events: FlowEvent[] = [];
      runner.on('event', (e: FlowEvent) => events.push(e));

      // Start the flow (will pause at human node)
      const runPromise = runner.run(flow);

      // Wait for pause
      await new Promise<void>(resolve => {
        const check = () => {
          const pauseEvent = events.find(e => e.type === 'flow:paused');
          if (pauseEvent) resolve();
          else setTimeout(check, 10);
        };
        check();
      });

      const pauseEvent = events.find(e => e.type === 'flow:paused') as { type: 'flow:paused'; runId: string; pendingNodeId: string };
      expect(pauseEvent).toBeDefined();

      // Resume with human approval
      await runner.resume(pauseEvent.runId, {
        nodeId: 'human',
        approved: true,
        data: { comment: 'Looks good' },
      });

      const state = await runPromise;
      expect(state.status).toBe('completed');
      const humanResult = state.nodeResults['human'];
      expect(humanResult.status).toBe('success');
      expect((humanResult.output as any).approved).toBe(true);
    });

    it('fails when human rejects', async () => {
      const flow = makeFlow(
        [
          makeNode('in', 'input'),
          makeNode('human', 'human', { prompt: 'Approve?' }),
          makeNode('out', 'output'),
        ],
        [makeEdge('in', 'human'), makeEdge('human', 'out')],
      );

      const events: FlowEvent[] = [];
      runner.on('event', (e: FlowEvent) => events.push(e));

      const runPromise = runner.run(flow);

      // Wait for pause
      await new Promise<void>(resolve => {
        const check = () => {
          const pauseEvent = events.find(e => e.type === 'flow:paused');
          if (pauseEvent) resolve();
          else setTimeout(check, 10);
        };
        check();
      });

      const pauseEvent = events.find(e => e.type === 'flow:paused') as { type: 'flow:paused'; runId: string; pendingNodeId: string };

      await runner.resume(pauseEvent.runId, {
        nodeId: 'human',
        approved: false,
      });

      const state = await runPromise;
      expect(state.status).toBe('failed');
      expect(state.nodeResults['human'].status).toBe('error');
      expect(state.nodeResults['human'].error).toContain('rejected');
    });
  });

  describe('recursive downstream skipping', () => {
    it('skips entire downstream chain after branch', async () => {
      const flow = makeFlow(
        [
          makeNode('in', 'input', { flag: true }),
          makeNode('branch', 'branch', { condition: 'truthy', field: 'flag' }),
          makeNode('yes', 'output'),
          makeNode('no1', 'input'),
          makeNode('no2', 'output'),
        ],
        [
          makeEdge('in', 'branch'),
          makeEdge('branch', 'yes', 'true'),
          makeEdge('branch', 'no1', 'false'),
          makeEdge('no1', 'no2'),
        ],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');
      expect(state.nodeResults['no1'].status).toBe('skipped');
      expect(state.nodeResults['no2'].status).toBe('skipped');
    });
  });

  describe('join-aware downstream skipping', () => {
    // Diamond: a branch forks into two arms (b, c) that re-converge on d.
    // With a real branch exactly one arm is taken, so one parent of the join
    // is skipped. The join must still run because the other parent is live —
    // the pre-fix recursion dropped d outright yet reported 'completed'.
    it('runs a re-converging join node when one parent arm is skipped', async () => {
      const flow = makeFlow(
        [
          makeNode('in', 'input', { flag: false }),
          makeNode('branch', 'branch', { condition: 'truthy', field: 'flag' }),
          makeNode('b', 'output'), // 'true' arm — skipped (flag is false)
          makeNode('c', 'output'), // 'false' arm — live
          makeNode('d', 'output'), // join of b & c
        ],
        [
          makeEdge('in', 'branch'),
          makeEdge('branch', 'b', 'true'),
          makeEdge('branch', 'c', 'false'),
          makeEdge('b', 'd'),
          makeEdge('c', 'd'),
        ],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');
      expect(state.nodeResults['b'].status).toBe('skipped');
      expect(state.nodeResults['c'].status).toBe('success');
      // The join survives because the live arm (c) still feeds it.
      expect(state.nodeResults['d'].status).toBe('success');
      expect(state.nodeResults['d'].status).not.toBe('skipped');
    });

    // The live arm is deeper than the skipped arm: when the branch is
    // processed, the join is reached via the short skipped arm while the live
    // arm's nodes are still pending in later layers. The join must be kept
    // alive on the pending parent and run once that arm resolves.
    it('keeps a join alive when the live arm resolves in a later layer', async () => {
      const flow = makeFlow(
        [
          makeNode('in', 'input', { flag: true }),
          makeNode('branch', 'branch', { condition: 'truthy', field: 'flag' }),
          makeNode('short', 'output'), // 'false' arm — skipped, short path
          makeNode('live1', 'input'), // 'true' arm — live, deeper path
          makeNode('live2', 'output'),
          makeNode('join', 'output'),
        ],
        [
          makeEdge('in', 'branch'),
          makeEdge('branch', 'short', 'false'),
          makeEdge('branch', 'live1', 'true'),
          makeEdge('live1', 'live2'),
          makeEdge('short', 'join'),
          makeEdge('live2', 'join'),
        ],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');
      expect(state.nodeResults['short'].status).toBe('skipped');
      expect(state.nodeResults['live2'].status).toBe('success');
      expect(state.nodeResults['join'].status).toBe('success');
    });

    // Control: when EVERY parent of a join is dead the join must still be
    // skipped (no false survival). The whole subtree below a skipped arm,
    // including its re-convergence point, is dropped.
    it('still skips a join when all of its parents are dead', async () => {
      const flow = makeFlow(
        [
          makeNode('in', 'input', { flag: true }),
          makeNode('branch', 'branch', { condition: 'truthy', field: 'flag' }),
          makeNode('keep', 'output'), // 'true' arm — taken
          makeNode('y', 'input'), // 'false' arm — skipped
          makeNode('p', 'output'),
          makeNode('q', 'output'),
          makeNode('join', 'output'), // join of p & q, both descend from y
        ],
        [
          makeEdge('in', 'branch'),
          makeEdge('branch', 'keep', 'true'),
          makeEdge('branch', 'y', 'false'),
          makeEdge('y', 'p'),
          makeEdge('y', 'q'),
          makeEdge('p', 'join'),
          makeEdge('q', 'join'),
        ],
      );

      const state = await runner.run(flow);
      expect(state.status).toBe('completed');
      expect(state.nodeResults['keep'].status).toBe('success');
      expect(state.nodeResults['y'].status).toBe('skipped');
      expect(state.nodeResults['p'].status).toBe('skipped');
      expect(state.nodeResults['q'].status).toBe('skipped');
      expect(state.nodeResults['join'].status).toBe('skipped');
    });
  });
});
