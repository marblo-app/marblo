import { describe, it, expect, beforeEach } from 'vitest';
import { DAGGenerator, type DecomposedTask } from '../../electron/orchestrator/dag-generator';
import { AutoRouter, type Agent } from '../../electron/orchestrator/auto-router';
import { makeTask, makeAgent } from '../setup';

describe('Orchestrator Integration', () => {
  describe('decompose → DAG → topological sort pipeline', () => {
    let dagGen: DAGGenerator;

    beforeEach(() => {
      dagGen = new DAGGenerator();
    });

    it('builds DAG from tasks and produces valid execution layers', () => {
      const tasks: DecomposedTask[] = [
        makeTask({ title: 'Setup DB', role: 'backend', depends_on: [] }),
        makeTask({ title: 'Create API', role: 'backend', depends_on: ['TASK-001'] }),
        makeTask({ title: 'Build UI', role: 'frontend', depends_on: ['TASK-002'] }),
        makeTask({ title: 'Write Tests', role: 'test', depends_on: ['TASK-002'] }),
      ];

      const dag = dagGen.buildDAG(tasks);

      // Verify DAG structure
      expect(dag.nodes).toEqual(['TASK-001', 'TASK-002', 'TASK-003', 'TASK-004']);
      expect(dag.edges).toContainEqual(['TASK-001', 'TASK-002']);
      expect(dag.edges).toContainEqual(['TASK-002', 'TASK-003']);
      expect(dag.edges).toContainEqual(['TASK-002', 'TASK-004']);
      expect(dag.labels['TASK-001']).toBe('Setup DB');

      // Verify topological sort
      const layers = dagGen.topologicalSort(dag);
      expect(layers[0]).toEqual(['TASK-001']); // DB first
      expect(layers[1]).toEqual(['TASK-002']); // API depends on DB
      expect(layers[2]).toHaveLength(2); // UI and Tests in parallel
      expect(layers[2]).toContain('TASK-003');
      expect(layers[2]).toContain('TASK-004');
    });

    it('detects cycles in the task DAG', () => {
      const tasks: DecomposedTask[] = [
        makeTask({ title: 'A', depends_on: ['TASK-003'] }),
        makeTask({ title: 'B', depends_on: ['TASK-001'] }),
        makeTask({ title: 'C', depends_on: ['TASK-002'] }),
      ];

      const dag = dagGen.buildDAG(tasks);
      const cycles = dagGen.detectCycles(dag);
      expect(cycles).not.toBeNull();
      expect(cycles!.length).toBeGreaterThan(0);
    });

    it('throws on topological sort with cycles', () => {
      const tasks: DecomposedTask[] = [
        makeTask({ title: 'A', depends_on: ['TASK-002'] }),
        makeTask({ title: 'B', depends_on: ['TASK-001'] }),
      ];

      const dag = dagGen.buildDAG(tasks);
      expect(() => dagGen.topologicalSort(dag)).toThrow(/cycles/i);
    });

    it('returns null for acyclic DAG cycle detection', () => {
      const tasks: DecomposedTask[] = [
        makeTask({ title: 'A', depends_on: [] }),
        makeTask({ title: 'B', depends_on: ['TASK-001'] }),
      ];

      const dag = dagGen.buildDAG(tasks);
      expect(dagGen.detectCycles(dag)).toBeNull();
    });

    it('handles tasks with no dependencies as single layer', () => {
      const tasks: DecomposedTask[] = [
        makeTask({ title: 'A', depends_on: [] }),
        makeTask({ title: 'B', depends_on: [] }),
        makeTask({ title: 'C', depends_on: [] }),
      ];

      const dag = dagGen.buildDAG(tasks);
      const layers = dagGen.topologicalSort(dag);
      expect(layers).toHaveLength(1);
      expect(layers[0]).toHaveLength(3);
    });

    it('generates React Flow graph from DAG', () => {
      const tasks: DecomposedTask[] = [
        makeTask({ title: 'A', depends_on: [] }),
        makeTask({ title: 'B', depends_on: ['TASK-001'] }),
        makeTask({ title: 'C', depends_on: ['TASK-001'] }),
      ];

      const dag = dagGen.buildDAG(tasks);
      const { nodes, edges } = dagGen.toReactFlowGraph(dag);

      expect(nodes).toHaveLength(3);
      expect(edges).toHaveLength(2);

      // Verify layout: node A at layer 0, B and C at layer 1
      const nodeA = nodes.find(n => n.id === 'TASK-001')!;
      const nodeB = nodes.find(n => n.id === 'TASK-002')!;
      expect(nodeA.position.x).toBeLessThan(nodeB.position.x);

      // Verify edges are animated
      expect(edges.every(e => e.animated)).toBe(true);
    });
  });

  describe('DAG → routing pipeline', () => {
    let dagGen: DAGGenerator;
    let router: AutoRouter;

    beforeEach(() => {
      dagGen = new DAGGenerator();
      router = new AutoRouter();
    });

    it('routes tasks from DAG layers to matching agents', () => {
      const tasks: DecomposedTask[] = [
        makeTask({ title: 'Setup DB', role: 'backend', priority: 5, depends_on: [] }),
        makeTask({ title: 'Build UI', role: 'frontend', priority: 3, depends_on: [] }),
        makeTask({ title: 'Write Tests', role: 'test', priority: 3, depends_on: ['TASK-001', 'TASK-002'] }),
      ];

      const agents: Agent[] = [
        makeAgent({ id: 'be1', role: 'backend', status: 'idle' }),
        makeAgent({ id: 'fe1', role: 'frontend', status: 'idle' }),
        makeAgent({ id: 'te1', role: 'test', status: 'idle' }),
      ];

      // Build DAG and get execution layers
      const dag = dagGen.buildDAG(tasks);
      const layers = dagGen.topologicalSort(dag);

      // Layer 0: backend + frontend (parallel)
      expect(layers[0]).toHaveLength(2);
      // Layer 1: test (depends on both)
      expect(layers[1]).toEqual(['TASK-003']);

      // Route all tasks
      const routing = router.routeBatch(tasks, agents);

      // Each task should be routed to its matching role
      expect(routing.get(tasks[0])!.agent.role).toBe('backend');
      expect(routing.get(tasks[1])!.agent.role).toBe('frontend');
      expect(routing.get(tasks[2])!.agent.role).toBe('test');
    });

    it('handles tasks that cannot be routed', () => {
      const tasks: DecomposedTask[] = [
        makeTask({ title: 'Backend task', role: 'backend' }),
        makeTask({ title: 'DevOps task', role: 'devops' }),
      ];

      const agents: Agent[] = [
        makeAgent({ id: 'be1', role: 'backend', status: 'idle' }),
      ];

      const routing = router.routeBatch(tasks, agents);
      expect(routing.get(tasks[0])).not.toBeNull();
      expect(routing.get(tasks[1])).toBeNull(); // No devops agent
    });

    it('distributes load evenly across agents of same role', () => {
      const tasks: DecomposedTask[] = [
        makeTask({ title: 'T1', role: 'backend', priority: 5 }),
        makeTask({ title: 'T2', role: 'backend', priority: 4 }),
        makeTask({ title: 'T3', role: 'backend', priority: 3 }),
        makeTask({ title: 'T4', role: 'backend', priority: 2 }),
      ];

      const agents: Agent[] = [
        makeAgent({ id: 'a1', role: 'backend', status: 'idle', maxConcurrentTasks: 3 }),
        makeAgent({ id: 'a2', role: 'backend', status: 'idle', maxConcurrentTasks: 3 }),
      ];

      const routing = router.routeBatch(tasks, agents);

      // Count assignments per agent
      const counts = new Map<string, number>();
      for (const [, result] of routing) {
        if (result) {
          const id = result.agent.id;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }

      // Both agents should have tasks (load balanced)
      expect(counts.get('a1')).toBeGreaterThan(0);
      expect(counts.get('a2')).toBeGreaterThan(0);
      // All tasks should be routed
      const total = (counts.get('a1') ?? 0) + (counts.get('a2') ?? 0);
      expect(total).toBe(4);
    });
  });

  describe('full pipeline: tasks → DAG → layers → routing', () => {
    it('completes end-to-end orchestration with complex dependency graph', () => {
      const dagGen = new DAGGenerator();
      const router = new AutoRouter();

      // Simulate a real project decomposition
      const tasks: DecomposedTask[] = [
        makeTask({ title: 'Design schema', role: 'backend', priority: 5, depends_on: [], scope: ['prisma/schema.prisma'] }),
        makeTask({ title: 'Setup auth', role: 'backend', priority: 5, depends_on: [], scope: ['src/auth/'] }),
        makeTask({ title: 'Build API endpoints', role: 'backend', priority: 4, depends_on: ['TASK-001'], scope: ['src/api/'] }),
        makeTask({ title: 'Build dashboard UI', role: 'frontend', priority: 3, depends_on: ['TASK-003'], scope: ['src/components/'] }),
        makeTask({ title: 'Integrate auth UI', role: 'frontend', priority: 3, depends_on: ['TASK-002', 'TASK-004'], scope: ['src/pages/login.tsx'] }),
        makeTask({ title: 'Write E2E tests', role: 'test', priority: 2, depends_on: ['TASK-004', 'TASK-005'], scope: ['tests/e2e/'] }),
        makeTask({ title: 'Deploy pipeline', role: 'devops', priority: 1, depends_on: ['TASK-006'], scope: ['Dockerfile', '.github/workflows/'] }),
      ];

      // Step 1: Build DAG
      const dag = dagGen.buildDAG(tasks);
      expect(dag.nodes).toHaveLength(7);

      // Step 2: Verify no cycles
      expect(dagGen.detectCycles(dag)).toBeNull();

      // Step 3: Get execution layers
      const layers = dagGen.topologicalSort(dag);
      expect(layers.length).toBeGreaterThanOrEqual(4); // At least 4 layers deep

      // Layer 0: Schema + Auth (no deps)
      expect(layers[0]).toContain('TASK-001');
      expect(layers[0]).toContain('TASK-002');

      // Last layer: Deploy
      expect(layers[layers.length - 1]).toContain('TASK-007');

      // Step 4: Route tasks
      const agents: Agent[] = [
        makeAgent({ id: 'be1', role: 'backend', status: 'idle', tags: ['typescript', 'database'] }),
        makeAgent({ id: 'be2', role: 'backend', status: 'idle', tags: ['typescript', 'auth'] }),
        makeAgent({ id: 'fe1', role: 'frontend', status: 'idle', tags: ['typescript', 'ui'] }),
        makeAgent({ id: 'te1', role: 'test', status: 'idle', tags: ['testing'] }),
        makeAgent({ id: 'ops1', role: 'devops', status: 'idle', tags: ['docker', 'ci-cd'] }),
      ];

      const routing = router.routeBatch(tasks, agents);

      // All tasks should be routed
      for (const [task, result] of routing) {
        expect(result).not.toBeNull();
        expect(result!.agent.role).toBe(task.role);
      }

      // Step 5: Generate React Flow visualization
      const { nodes, edges } = dagGen.toReactFlowGraph(dag);
      expect(nodes).toHaveLength(7);
      expect(edges).toHaveLength(dag.edges.length);
    });
  });

  describe('edge cases', () => {
    it('handles single task with no dependencies', () => {
      const dagGen = new DAGGenerator();
      const tasks: DecomposedTask[] = [
        makeTask({ title: 'Solo task', depends_on: [] }),
      ];

      const dag = dagGen.buildDAG(tasks);
      expect(dag.nodes).toEqual(['TASK-001']);
      expect(dag.edges).toEqual([]);

      const layers = dagGen.topologicalSort(dag);
      expect(layers).toEqual([['TASK-001']]);
    });

    it('handles empty task list', () => {
      const dagGen = new DAGGenerator();
      const dag = dagGen.buildDAG([]);
      expect(dag.nodes).toEqual([]);
      expect(dag.edges).toEqual([]);

      const layers = dagGen.topologicalSort(dag);
      expect(layers).toEqual([]);
    });

    it('handles long linear dependency chain', () => {
      const dagGen = new DAGGenerator();
      const tasks: DecomposedTask[] = [];
      for (let i = 0; i < 10; i++) {
        tasks.push(
          makeTask({
            title: `Task ${i + 1}`,
            depends_on: i > 0 ? [`TASK-${String(i).padStart(3, '0')}`] : [],
          }),
        );
      }

      const dag = dagGen.buildDAG(tasks);
      const layers = dagGen.topologicalSort(dag);
      expect(layers).toHaveLength(10);
      layers.forEach(layer => expect(layer).toHaveLength(1));
    });

    it('handles wide parallel graph (all tasks independent)', () => {
      const dagGen = new DAGGenerator();
      const router = new AutoRouter();

      const tasks: DecomposedTask[] = Array.from({ length: 5 }, (_, i) =>
        makeTask({ title: `Task ${i + 1}`, role: 'backend', depends_on: [] }),
      );

      const dag = dagGen.buildDAG(tasks);
      const layers = dagGen.topologicalSort(dag);
      expect(layers).toHaveLength(1);
      expect(layers[0]).toHaveLength(5);

      // Route to 2 agents with capacity 3 each
      const agents: Agent[] = [
        makeAgent({ id: 'a1', role: 'backend', status: 'idle', maxConcurrentTasks: 3 }),
        makeAgent({ id: 'a2', role: 'backend', status: 'idle', maxConcurrentTasks: 3 }),
      ];

      const routing = router.routeBatch(tasks, agents);
      let routed = 0;
      for (const [, result] of routing) {
        if (result) routed++;
      }
      expect(routed).toBe(5);
    });
  });
});
