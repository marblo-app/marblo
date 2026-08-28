export const INTENT_SCRIPT_SCHEMA_VERSION = "1.0" as const;

export type IntentScriptSchemaVersion = typeof INTENT_SCRIPT_SCHEMA_VERSION;

export type IntentInputType = "string" | "number" | "date";

export interface IntentInput {
  name: string;
  type: IntentInputType;
  example: string;
  required: boolean;
}

export type IntentStepKind =
  | "goto"
  | "fill"
  | "select"
  | "click"
  | "check"
  | "waitFor"
  | "assert"
  | "handoff"
  | "extract";

export type IntentTargetRole =
  | "textbox"
  | "combobox"
  | "button"
  | "link"
  | "checkbox"
  | "radio";

export interface IntentTargetHints {
  css: string;
  xpath: string;
  attrs: {
    name: string;
    placeholder: string;
    type: string;
  };
  text: string;
  nearbyText: string[];
}

export interface IntentTarget {
  description: string;
  role: IntentTargetRole;
  name: string;
  hints: IntentTargetHints;
}

export type IntentValue =
  | { from: "input"; ref: string }
  | { from: "literal"; text: string };

export type IntentVerify =
  | { kind: "valueEquals"; expect: string }
  | { kind: "textContains"; expect: string };

export interface IntentStep {
  id: string;
  kind: IntentStepKind;
  intent: string;
  target?: IntentTarget;
  value?: IntentValue;
  verify?: IntentVerify;
  onResolveFail: "escalate" | "skip" | "abort";
}

export type IntentOutcomeKind = "textContains" | "urlMatches";

export interface IntentOutcome {
  kind: IntentOutcomeKind;
  description: string;
  hints: Partial<IntentTargetHints>;
  expect: string;
}

export interface IntentScript {
  schemaVersion: IntentScriptSchemaVersion;
  id: string;
  name: string;
  recordedAt: string;
  origin: string;
  startUrl: string;
  inputs: IntentInput[];
  steps: IntentStep[];
  outcome: IntentOutcome;
}

export interface HumanReviewRequirement {
  required: true;
  reason: string;
  fields: Array<{
    stepId: string;
    paths: ["intent", "target.description"];
  }>;
}

export interface IntentRecordingDraft {
  script: IntentScript;
  humanReview: HumanReviewRequirement;
}

export function intentScriptTopLevelKeys(): Array<keyof IntentScript> {
  return [
    "schemaVersion",
    "id",
    "name",
    "recordedAt",
    "origin",
    "startUrl",
    "inputs",
    "steps",
    "outcome",
  ];
}
