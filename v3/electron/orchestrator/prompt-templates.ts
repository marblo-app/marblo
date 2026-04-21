import type { ChatMessage } from './llm-client.js';
import type { FlowNode, FlowEdge } from './dag-generator.js';

// ── Decomposition Prompt ─────────────────────────────────────

const DECOMPOSE_SYSTEM = `You are a senior software architect who breaks down project requirements into actionable development tasks.

Rules:
- Each task should be 1-2 hours of focused work
- Assign roles: backend, frontend, test, devops
- Use TASK-NNN format (1-based) for depends_on references within the batch
- Priority: 1 (low) to 5 (critical)
- scope: list specific file paths the task will modify
- estimatedHours: realistic estimate (0.5 to 4)
- Ensure no circular dependencies
- Order tasks so dependencies come before dependents

Output format (strict JSON, no markdown):
{
  "projectName": "string",
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "role": "backend" | "frontend" | "test" | "devops",
      "priority": 1-5,
      "depends_on": ["TASK-NNN"],
      "scope": ["path/to/file.ts"],
      "estimatedHours": 1.5
    }
  ]
}`;

export function buildDecomposePrompt(
  naturalLanguage: string,
  context?: string,
): ChatMessage[] {
  let userContent = `Break down the following requirement into development tasks:\n\n${naturalLanguage}`;
  if (context) {
    userContent += `\n\nAdditional context:\n${context}`;
  }
  return [
    { role: 'system', content: DECOMPOSE_SYSTEM },
    { role: 'user', content: userContent },
  ];
}

// ── Add Tasks Prompt ─────────────────────────────────────────

const ADD_TASKS_SYSTEM = `You are a software architect adding new tasks to an existing project.

Rules:
- Review existing tasks to avoid duplication
- New tasks can depend on existing tasks (use their TASK-NNN IDs)
- New task numbering continues from where existing tasks end
- Same rules as decomposition: role, priority, scope, estimatedHours
- Ensure no circular dependencies with existing tasks

Output format (strict JSON, no markdown):
{
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "role": "backend" | "frontend" | "test" | "devops",
      "priority": 1-5,
      "depends_on": ["TASK-NNN"],
      "scope": ["path/to/file.ts"],
      "estimatedHours": 1.5
    }
  ]
}`;

export function buildAddTasksPrompt(
  existingTasks: string,
  newRequirement: string,
): ChatMessage[] {
  return [
    { role: 'system', content: ADD_TASKS_SYSTEM },
    {
      role: 'user',
      content: [
        'Existing tasks:',
        existingTasks,
        '',
        'New requirement to add:',
        newRequirement,
      ].join('\n'),
    },
  ];
}

// ── DAG Generation Prompt ────────────────────────────────────

const DAG_SYSTEM = `You are a dependency analysis expert. Given a list of tasks, verify and optimize the dependency graph.

Rules:
- Detect any circular dependencies and report them
- Suggest missing dependencies where task order matters
- Identify tasks that can be parallelized

Output format (strict JSON, no markdown):
{
  "valid": true/false,
  "cycles": [["TASK-001", "TASK-002"]] or null,
  "suggestedEdges": [["TASK-001", "TASK-003"]],
  "parallelGroups": [["TASK-001", "TASK-002"], ["TASK-003"]]
}`;

export function buildDAGValidationPrompt(
  tasks: Array<{ title: string; depends_on: string[] }>,
): ChatMessage[] {
  const taskSummary = tasks
    .map((t, i) => `TASK-${String(i + 1).padStart(3, '0')}: ${t.title} (depends_on: ${t.depends_on.join(', ') || 'none'})`)
    .join('\n');

  return [
    { role: 'system', content: DAG_SYSTEM },
    { role: 'user', content: `Analyze the dependency graph:\n\n${taskSummary}` },
  ];
}

// ── Role Classification Prompt ───────────────────────────────

const ROLE_SYSTEM = `You are a task classifier. Given a task description, determine the most appropriate developer role.

Roles:
- backend: API, database, server logic, data processing
- frontend: UI, components, styling, client-side logic
- test: testing, QA, test automation
- devops: CI/CD, deployment, infrastructure, Docker, monitoring

Output format (strict JSON, no markdown):
{ "role": "backend" | "frontend" | "test" | "devops", "confidence": 0.0-1.0 }`;

export function buildRoleClassificationPrompt(
  taskTitle: string,
  taskDescription: string,
): ChatMessage[] {
  return [
    { role: 'system', content: ROLE_SYSTEM },
    { role: 'user', content: `Title: ${taskTitle}\nDescription: ${taskDescription}` },
  ];
}

// ── Flow Generation Prompt ───────────────────────────────────

const FLOW_GENERATION_SYSTEM = `You are a workflow designer. Given a natural language description of a pipeline or workflow, generate a React Flow compatible graph.

Rules:
- Each step becomes a node with a unique id (e.g. "node-1", "node-2")
- Connections between steps become edges
- Node types: "default" (generic), "input" (entry point), "output" (final result), "group" (container)
- Each node has a data object with at minimum: { label: "string" }
- Additional data fields allowed: role, status, description, nodeType (for custom rendering)
- Edges connect source → target following the pipeline flow
- Ensure the graph is a valid DAG (no cycles)

Output format (strict JSON, no markdown):
{
  "nodes": [
    {
      "id": "node-1",
      "type": "input",
      "data": { "label": "Step name", "description": "What this step does", "nodeType": "trigger" }
    }
  ],
  "edges": [
    {
      "source": "node-1",
      "target": "node-2",
      "label": "optional edge label",
      "animated": true
    }
  ]
}`;

export function buildFlowGenerationPrompt(
  description: string,
  context?: string,
): ChatMessage[] {
  let userContent = `Design a workflow graph for the following pipeline:\n\n${description}`;
  if (context) {
    userContent += `\n\nAdditional context:\n${context}`;
  }
  return [
    { role: 'system', content: FLOW_GENERATION_SYSTEM },
    { role: 'user', content: userContent },
  ];
}

// ── Flow Extension Prompt ────────────────────────────────────

const FLOW_EXTENSION_SYSTEM = `You are a workflow designer extending an existing React Flow graph.

Rules:
- Review the existing nodes and edges
- Add NEW nodes and edges to satisfy the new requirement
- Do NOT duplicate existing nodes — reuse their IDs for connections
- New node IDs must not conflict with existing ones
- Maintain DAG structure (no cycles)
- Return ONLY the new nodes and edges to add (not the full graph)

Output format (strict JSON, no markdown):
{
  "nodes": [ { "id": "new-node-1", "type": "default", "data": { "label": "..." } } ],
  "edges": [ { "source": "existing-node-id", "target": "new-node-1" } ]
}`;

export function buildFlowExtensionPrompt(
  existingFlow: { nodes: FlowNode[]; edges: FlowEdge[] },
  requirement: string,
): ChatMessage[] {
  const summary = [
    'Existing nodes:',
    ...existingFlow.nodes.map(n => `  - ${n.id}: ${n.data.label} (type=${n.type})`),
    '',
    'Existing edges:',
    ...existingFlow.edges.map(e => `  - ${e.source} → ${e.target}`),
  ].join('\n');

  return [
    { role: 'system', content: FLOW_EXTENSION_SYSTEM },
    {
      role: 'user',
      content: `${summary}\n\nNew requirement:\n${requirement}`,
    },
  ];
}
