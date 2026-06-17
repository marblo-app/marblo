export type BulkTaskInput = Record<string, unknown>;

export interface NormalizeBulkTasksInput {
  tasks_json?: string;
  tasks?: unknown;
}

export interface NormalizeBulkTasksResult {
  tasks?: BulkTaskInput[];
  error?: string;
}

export const BULK_TASK_INSERT_CHUNK_SIZE = 25;

function parseJsonArrayPayload(
  fieldName: "tasks" | "tasks_json",
  value: string,
): NormalizeBulkTasksResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Error: Invalid ${fieldName} JSON: ${message}` };
  }

  if (!Array.isArray(parsed)) {
    return { error: `Error: ${fieldName} must be a JSON array.` };
  }

  return validateTaskArray(fieldName, parsed);
}

function validateTaskArray(
  fieldName: "tasks" | "tasks_json",
  value: unknown[],
): NormalizeBulkTasksResult {
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return {
        error: `Error: ${fieldName}[${i}] must be a task object.`,
      };
    }
  }

  return { tasks: value as BulkTaskInput[] };
}

export function normalizeBulkTasksPayload(
  input: NormalizeBulkTasksInput,
): NormalizeBulkTasksResult {
  if (input.tasks !== undefined && input.tasks !== null) {
    if (typeof input.tasks === "string") {
      return parseJsonArrayPayload("tasks", input.tasks);
    }

    if (Array.isArray(input.tasks)) {
      return validateTaskArray("tasks", input.tasks);
    }

    return {
      error:
        "Error: tasks must be an array of task objects or a JSON array string.",
    };
  }

  if (input.tasks_json !== undefined && input.tasks_json !== null) {
    return parseJsonArrayPayload("tasks_json", input.tasks_json);
  }

  return {
    error:
      "Error: Either tasks_json (string) or tasks (array or JSON array string) is required.",
  };
}

export function chunkBulkTasks<T>(
  tasks: T[],
  chunkSize = BULK_TASK_INSERT_CHUNK_SIZE,
): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }

  const chunks: T[][] = [];
  for (let i = 0; i < tasks.length; i += chunkSize) {
    chunks.push(tasks.slice(i, i + chunkSize));
  }
  return chunks;
}
