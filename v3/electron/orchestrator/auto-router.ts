import type { DecomposedTask } from './dag-generator.js';

// ── Types ────────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'busy' | 'offline';

export interface Agent {
  id: string;
  role: string;
  tags: string[];
  status: AgentStatus;
  currentTaskCount: number;
  maxConcurrentTasks: number;
}

export interface RoutingRule {
  role: string;
  tags: string[];
  preferredAgentId?: string;
}

export interface RoutingResult {
  agent: Agent;
  score: number;
  reason: string;
}

// ── AutoRouter ───────────────────────────────────────────────

export class AutoRouter {
  private rules: RoutingRule[] = [];

  /**
   * Set custom routing rules.
   */
  setRules(rules: RoutingRule[]): void {
    this.rules = rules;
  }

  /**
   * Route a task to the best available agent.
   * Returns null if no suitable agent is found.
   */
  route(task: DecomposedTask, availableAgents: Agent[]): Agent | null {
    const candidates = availableAgents.filter(
      a => a.status !== 'offline' && a.currentTaskCount < a.maxConcurrentTasks,
    );

    if (candidates.length === 0) return null;

    // Score each candidate
    const scored = candidates
      .map(agent => ({
        agent,
        score: this.calculateScore(task, agent),
      }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.length > 0 ? scored[0].agent : null;
  }

  /**
   * Calculate a matching score for a task-agent pair.
   * Higher score = better fit.
   */
  calculateScore(task: DecomposedTask, agent: Agent): number {
    let score = 0;

    // Role match (primary criterion)
    if (agent.role === task.role) {
      score += 100;
    } else {
      // No role match = not eligible
      return 0;
    }

    // Tag matching (scope overlap)
    const taskTags = this.extractTags(task);
    const matchingTags = taskTags.filter(t => agent.tags.includes(t));
    score += matchingTags.length * 10;

    // Preferred agent bonus from routing rules
    const rule = this.rules.find(r => r.role === task.role);
    if (rule?.preferredAgentId === agent.id) {
      score += 50;
    }

    // Rule tag matching
    if (rule) {
      const ruleTagMatches = rule.tags.filter(t => agent.tags.includes(t));
      score += ruleTagMatches.length * 5;
    }

    // Priority boost: high-priority tasks prefer idle agents
    if (task.priority >= 4 && agent.status === 'idle') {
      score += 30;
    }

    // Load penalty: more current tasks = lower score
    score -= agent.currentTaskCount * 15;

    // Idle bonus
    if (agent.status === 'idle') {
      score += 20;
    }

    return Math.max(0, score);
  }

  /**
   * Pick the least loaded agent from a list of candidates.
   */
  getLoadBalancedAgent(candidates: Agent[]): Agent {
    if (candidates.length === 0) {
      throw new Error('No candidates provided for load balancing');
    }

    // Prefer idle agents, then lowest task count, then first in list
    return candidates.sort((a, b) => {
      // Idle first
      if (a.status === 'idle' && b.status !== 'idle') return -1;
      if (b.status === 'idle' && a.status !== 'idle') return 1;
      // Then by load (lower is better)
      const loadA = a.currentTaskCount / a.maxConcurrentTasks;
      const loadB = b.currentTaskCount / b.maxConcurrentTasks;
      return loadA - loadB;
    })[0];
  }

  /**
   * Route multiple tasks at once, distributing across agents.
   */
  routeBatch(
    tasks: DecomposedTask[],
    availableAgents: Agent[],
  ): Map<DecomposedTask, RoutingResult | null> {
    const results = new Map<DecomposedTask, RoutingResult | null>();

    // Track running load during batch assignment
    const loadTracker = new Map<string, number>();
    for (const agent of availableAgents) {
      loadTracker.set(agent.id, agent.currentTaskCount);
    }

    // Sort tasks by priority (high first)
    const sorted = [...tasks].sort((a, b) => b.priority - a.priority);

    for (const task of sorted) {
      // Build virtual agent list with updated loads
      const virtualAgents = availableAgents.map(a => ({
        ...a,
        currentTaskCount: loadTracker.get(a.id) ?? a.currentTaskCount,
      }));

      const agent = this.route(task, virtualAgents);
      if (agent) {
        const score = this.calculateScore(task, agent);
        results.set(task, {
          agent,
          score,
          reason: `Role match: ${agent.role}, score: ${score}`,
        });
        // Update virtual load
        loadTracker.set(agent.id, (loadTracker.get(agent.id) ?? 0) + 1);
      } else {
        results.set(task, null);
      }
    }

    return results;
  }

  // ── Helpers ──────────────────────────────────────────────────

  /**
   * Extract searchable tags from a task's scope and description.
   */
  private extractTags(task: DecomposedTask): string[] {
    const tags: string[] = [task.role];

    // Extract technology hints from scope paths
    for (const s of task.scope) {
      if (s.endsWith('.ts') || s.endsWith('.tsx')) tags.push('typescript');
      if (s.endsWith('.py')) tags.push('python');
      if (s.endsWith('.go')) tags.push('go');
      if (s.includes('test') || s.includes('spec')) tags.push('testing');
      if (s.includes('docker') || s.includes('Dockerfile')) tags.push('docker');
      if (s.includes('api') || s.includes('route')) tags.push('api');
      if (s.includes('component') || s.includes('page')) tags.push('ui');
    }

    // Extract from description keywords
    const desc = task.description.toLowerCase();
    if (desc.includes('database') || desc.includes('migration')) tags.push('database');
    if (desc.includes('auth')) tags.push('auth');
    if (desc.includes('ci') || desc.includes('deploy')) tags.push('ci-cd');

    return [...new Set(tags)];
  }
}
