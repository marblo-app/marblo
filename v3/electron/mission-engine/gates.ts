import type { Mission, MissionStep } from "./types";

export interface StepGateDeps {
  getTaskStatuses: (taskIds: string[]) => Promise<Record<string, string>>;
  mission: Mission;
}

export interface StepGateResult {
  pass: boolean;
  reason?: string;
}

const SHIP_PR_URL_RE = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+\b/;
const REVIEW_FAIL_MARKER_RE =
  /\b(REVIEW_FAIL|REVIEW_FAILED|REJECT|REJECTED|REQUEST_CHANGES|CHANGES_REQUESTED)\b/i;

export async function verifyStepGate(
  step: MissionStep,
  deps: StepGateDeps,
): Promise<StepGateResult> {
  if (isReviewStep(step)) {
    return verifyReviewGate(step);
  }

  if (step.type === "gstack") {
    return verifyGstackGate(step);
  }

  if (step.type === "dispatch" || step.type === "wait") {
    return verifyTaskCompletionGate(deps);
  }

  return { pass: true };
}

function verifyGstackGate(step: MissionStep): StepGateResult {
  const output = stringOutput(step.output);

  if (isShipStep(step)) {
    return SHIP_PR_URL_RE.test(output)
      ? { pass: true }
      : { pass: false, reason: "no PR url" };
  }

  return output.trim().length > 0
    ? { pass: true }
    : { pass: false, reason: "no output yet" };
}

async function verifyTaskCompletionGate(
  deps: StepGateDeps,
): Promise<StepGateResult> {
  const taskIds = deps.mission.taskIds;
  const statuses = await deps.getTaskStatuses(taskIds);
  const pending = taskIds.filter((taskId) => statuses[taskId] !== "DONE");

  return pending.length === 0
    ? { pass: true }
    : { pass: false, reason: `${pending.length} tasks pending` };
}

function verifyReviewGate(step: MissionStep): StepGateResult {
  const output = stringOutput(step.output);

  return REVIEW_FAIL_MARKER_RE.test(output)
    ? { pass: false, reason: "review failed" }
    : { pass: true };
}

function isShipStep(step: MissionStep): boolean {
  return step.skill === "/ship" || step.skill?.startsWith("/ship ") === true;
}

function isReviewStep(step: MissionStep): boolean {
  return (
    stepType(step) === "review" ||
    (step.type === "gstack" && step.skill === "/review")
  );
}

function stringOutput(output: unknown): string {
  return typeof output === "string" ? output : "";
}

function stepType(step: MissionStep): string {
  return step.type;
}
