import { describe, it, expect, beforeEach } from 'vitest';
import { AutoRouter } from '../../electron/orchestrator/auto-router';
import { makeTask, makeAgent } from '../setup';

describe('AutoRouter', () => {
  let router: AutoRouter;

  beforeEach(() => {
    router = new AutoRouter();
  });

  describe('route', () => {
    it('routes to an agent with matching role', () => {
      const task = makeTask({ role: 'backend' });
      const agents = [makeAgent({ id: 'a1', role: 'backend' })];
      const result = router.route(task, agents);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('a1');
    });

    it('returns null when no agents match role', () => {
      const task = makeTask({ role: 'backend' });
      const agents = [makeAgent({ id: 'a1', role: 'frontend' })];
      expect(router.route(task, agents)).toBeNull();
    });

    it('returns null when all agents are offline', () => {
      const task = makeTask({ role: 'backend' });
      const agents = [makeAgent({ id: 'a1', role: 'backend', status: 'offline' })];
      expect(router.route(task, agents)).toBeNull();
    });

    it('returns null when all agents are at max capacity', () => {
      const task = makeTask({ role: 'backend' });
      const agents = [makeAgent({ id: 'a1', role: 'backend', currentTaskCount: 3, maxConcurrentTasks: 3 })];
      expect(router.route(task, agents)).toBeNull();
    });

    it('returns null when no agents provided', () => {
      const task = makeTask({ role: 'backend' });
      expect(router.route(task, [])).toBeNull();
    });

    it('prefers idle agent over busy one', () => {
      const task = makeTask({ role: 'backend' });
      const agents = [
        makeAgent({ id: 'busy', role: 'backend', status: 'busy', currentTaskCount: 1 }),
        makeAgent({ id: 'idle', role: 'backend', status: 'idle', currentTaskCount: 0 }),
      ];
      const result = router.route(task, agents);
      expect(result!.id).toBe('idle');
    });

    it('prefers agent with fewer tasks (lower load)', () => {
      const task = makeTask({ role: 'backend' });
      const agents = [
        makeAgent({ id: 'loaded', role: 'backend', status: 'idle', currentTaskCount: 2 }),
        makeAgent({ id: 'light', role: 'backend', status: 'idle', currentTaskCount: 0 }),
      ];
      const result = router.route(task, agents);
      expect(result!.id).toBe('light');
    });
  });

  describe('calculateScore', () => {
    it('gives 0 score when role does not match', () => {
      const task = makeTask({ role: 'backend' });
      const agent = makeAgent({ role: 'frontend' });
      expect(router.calculateScore(task, agent)).toBe(0);
    });

    it('gives base score of 100 for role match', () => {
      const task = makeTask({ role: 'backend', scope: [], description: 'Simple task' });
      const agent = makeAgent({ role: 'backend', tags: [], status: 'busy', currentTaskCount: 0 });
      expect(router.calculateScore(task, agent)).toBe(100);
    });

    it('adds idle bonus of 20', () => {
      const task = makeTask({ role: 'backend', scope: [], description: 'Simple task' });
      const agent = makeAgent({ role: 'backend', tags: [], status: 'idle', currentTaskCount: 0 });
      expect(router.calculateScore(task, agent)).toBe(120);
    });

    it('adds tag matching bonus of 10 per tag', () => {
      const task = makeTask({ role: 'backend', scope: ['src/api.ts', 'src/test.ts'], description: 'Simple' });
      const agent = makeAgent({ role: 'backend', tags: ['typescript', 'testing'], status: 'busy' });
      const score = router.calculateScore(task, agent);
      expect(score).toBeGreaterThanOrEqual(120);
    });

    it('subtracts load penalty of 15 per current task', () => {
      const task = makeTask({ role: 'backend', scope: [], description: 'Simple task' });
      const agent = makeAgent({ role: 'backend', tags: [], status: 'busy', currentTaskCount: 2 });
      expect(router.calculateScore(task, agent)).toBe(70);
    });

    it('adds priority boost of 30 for high-priority tasks on idle agents', () => {
      const task = makeTask({ role: 'backend', priority: 4, scope: [], description: 'Simple' });
      const agent = makeAgent({ role: 'backend', tags: [], status: 'idle' });
      expect(router.calculateScore(task, agent)).toBe(150);
    });

    it('no priority boost for priority < 4', () => {
      const task = makeTask({ role: 'backend', priority: 3, scope: [], description: 'Simple' });
      const agent = makeAgent({ role: 'backend', tags: [], status: 'idle' });
      expect(router.calculateScore(task, agent)).toBe(120);
    });

    it('score never goes below 0', () => {
      const task = makeTask({ role: 'backend', scope: [], description: 'Simple' });
      const agent = makeAgent({ role: 'backend', tags: [], status: 'busy', currentTaskCount: 10 });
      expect(router.calculateScore(task, agent)).toBe(0);
    });

    it('penalizes agents with more tasks', () => {
      const task = makeTask({ role: 'backend' });
      const agent0 = makeAgent({ role: 'backend', currentTaskCount: 0, status: 'busy' });
      const agent2 = makeAgent({ role: 'backend', currentTaskCount: 2, status: 'busy' });
      expect(router.calculateScore(task, agent0)).toBeGreaterThan(router.calculateScore(task, agent2));
    });
  });

  describe('calculateScore with routing rules', () => {
    it('adds preferred agent bonus of 50', () => {
      router.setRules([{ role: 'backend', tags: [], preferredAgentId: 'a1' }]);
      const task = makeTask({ role: 'backend', scope: [], description: 'Simple' });
      const agent = makeAgent({ id: 'a1', role: 'backend', tags: [], status: 'busy' });
      expect(router.calculateScore(task, agent)).toBe(150);
    });

    it('adds rule tag matching bonus of 5 per tag', () => {
      router.setRules([{ role: 'backend', tags: ['typescript', 'api'] }]);
      const task = makeTask({ role: 'backend', scope: [], description: 'Simple' });
      const agent = makeAgent({ role: 'backend', tags: ['typescript', 'api'], status: 'busy' });
      expect(router.calculateScore(task, agent)).toBe(110);
    });

    it('applies preferred agent bonus — agent wins route', () => {
      router.setRules([{ role: 'backend', tags: [], preferredAgentId: 'preferred' }]);
      const task = makeTask({ role: 'backend' });
      const agents = [
        makeAgent({ id: 'preferred', role: 'backend', status: 'idle' }),
        makeAgent({ id: 'other', role: 'backend', status: 'idle' }),
      ];
      const result = router.route(task, agents);
      expect(result?.id).toBe('preferred');
    });
  });

  describe('getLoadBalancedAgent', () => {
    it('prefers idle agent', () => {
      const agents = [
        makeAgent({ id: 'busy', status: 'busy', currentTaskCount: 0, maxConcurrentTasks: 3 }),
        makeAgent({ id: 'idle', status: 'idle', currentTaskCount: 0, maxConcurrentTasks: 3 }),
      ];
      const result = router.getLoadBalancedAgent(agents);
      expect(result.id).toBe('idle');
    });

    it('prefers lower load ratio', () => {
      const agents = [
        makeAgent({ id: 'a', status: 'busy', currentTaskCount: 2, maxConcurrentTasks: 3 }),
        makeAgent({ id: 'b', status: 'busy', currentTaskCount: 1, maxConcurrentTasks: 3 }),
      ];
      const result = router.getLoadBalancedAgent(agents);
      expect(result.id).toBe('b');
    });

    it('throws on empty candidates', () => {
      expect(() => router.getLoadBalancedAgent([])).toThrow('No candidates');
    });
  });

  describe('routeBatch', () => {
    it('routes multiple tasks distributing load', () => {
      const tasks = [
        makeTask({ title: 'T1', role: 'backend', priority: 5 }),
        makeTask({ title: 'T2', role: 'backend', priority: 3 }),
        makeTask({ title: 'T3', role: 'frontend', priority: 4 }),
      ];
      const agents = [
        makeAgent({ id: 'be1', role: 'backend', status: 'idle' }),
        makeAgent({ id: 'be2', role: 'backend', status: 'idle' }),
        makeAgent({ id: 'fe1', role: 'frontend', status: 'idle' }),
      ];

      const results = router.routeBatch(tasks, agents);
      expect(results.size).toBe(3);

      const feTask = tasks.find(t => t.role === 'frontend')!;
      const feResult = results.get(feTask);
      expect(feResult).not.toBeNull();
      expect(feResult!.agent.role).toBe('frontend');
    });

    it('returns null for unroutable tasks', () => {
      const tasks = [makeTask({ title: 'T1', role: 'devops', priority: 3 })];
      const agents = [makeAgent({ id: 'be1', role: 'backend', status: 'idle' })];

      const results = router.routeBatch(tasks, agents);
      expect(results.get(tasks[0])).toBeNull();
    });

    it('processes higher priority tasks first', () => {
      const tasks = [
        makeTask({ title: 'Low', role: 'backend', priority: 1 }),
        makeTask({ title: 'High', role: 'backend', priority: 5 }),
      ];
      const agents = [makeAgent({ id: 'a1', role: 'backend', status: 'idle', maxConcurrentTasks: 1 })];

      const results = router.routeBatch(tasks, agents);
      const highTask = tasks.find(t => t.priority === 5)!;
      const lowTask = tasks.find(t => t.priority === 1)!;

      expect(results.get(highTask)).not.toBeNull();
      expect(results.get(lowTask)).toBeNull();
    });

    it('tracks load during batch assignment', () => {
      const tasks = [
        makeTask({ title: 'T1', role: 'backend', priority: 5 }),
        makeTask({ title: 'T2', role: 'backend', priority: 4 }),
        makeTask({ title: 'T3', role: 'backend', priority: 3 }),
      ];
      const agents = [
        makeAgent({ id: 'a1', role: 'backend', status: 'idle', maxConcurrentTasks: 2 }),
        makeAgent({ id: 'a2', role: 'backend', status: 'idle', maxConcurrentTasks: 2 }),
      ];

      const results = router.routeBatch(tasks, agents);
      let routed = 0;
      for (const [, result] of results) {
        if (result) routed++;
      }
      expect(routed).toBe(3);
    });

    it('distributes across agents, no duplicate ids', () => {
      const tasks = [
        makeTask({ title: 'T1', role: 'backend', priority: 3 }),
        makeTask({ title: 'T2', role: 'backend', priority: 2 }),
      ];
      const agents = [
        makeAgent({ id: 'be-1', role: 'backend', maxConcurrentTasks: 1 }),
        makeAgent({ id: 'be-2', role: 'backend', maxConcurrentTasks: 1 }),
      ];
      const results = router.routeBatch(tasks, agents);
      const assigned = [...results.values()].filter(r => r !== null);
      expect(assigned).toHaveLength(2);
      const agentIds = assigned.map(r => r!.agent.id);
      expect(new Set(agentIds).size).toBe(2);
    });
  });

  describe('tag extraction', () => {
    it('extracts typescript tag from .ts scope', () => {
      const task = makeTask({ role: 'backend', scope: ['src/index.ts'] });
      const agent = makeAgent({ role: 'backend', tags: ['typescript'], status: 'busy' });
      const score = router.calculateScore(task, agent);
      expect(score).toBeGreaterThanOrEqual(110);
    });

    it('extracts testing tag from test files', () => {
      const task = makeTask({ role: 'backend', scope: ['tests/unit.test.ts'] });
      const agent = makeAgent({ role: 'backend', tags: ['testing'], status: 'busy' });
      const score = router.calculateScore(task, agent);
      expect(score).toBeGreaterThanOrEqual(110);
    });

    it('extracts database tag from description', () => {
      const task = makeTask({ role: 'backend', description: 'Set up database migrations' });
      const agent = makeAgent({ role: 'backend', tags: ['database'], status: 'busy' });
      const score = router.calculateScore(task, agent);
      expect(score).toBeGreaterThanOrEqual(110);
    });

    it('extracts auth tag from description', () => {
      const task = makeTask({ role: 'backend', description: 'Implement auth flow' });
      const agent = makeAgent({ role: 'backend', tags: ['auth'], status: 'busy' });
      const score = router.calculateScore(task, agent);
      expect(score).toBeGreaterThanOrEqual(110);
    });

    it('extracts docker tag from scope', () => {
      const task = makeTask({ role: 'devops', scope: ['Dockerfile', 'docker-compose.yml'] });
      const agent = makeAgent({ role: 'devops', tags: ['docker'], status: 'busy' });
      const score = router.calculateScore(task, agent);
      expect(score).toBeGreaterThanOrEqual(110);
    });
  });
});
