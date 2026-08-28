import {
  INTENT_SCRIPT_SCHEMA_VERSION,
  IntentInput,
  IntentRecordingDraft,
  IntentScript,
  IntentStep,
  IntentStepKind,
  IntentTarget,
  IntentTargetHints,
  IntentTargetRole,
  IntentValue,
  IntentVerify,
} from "./intent-script";
import { INTENT_RECORDER_GLOBAL, INTENT_RECORDER_HOOK } from "./recorder-hook";

export interface CdpClient {
  send<TResult = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<TResult>;
}

export interface RawRecordedEvent {
  kind: Extract<IntentStepKind, "fill" | "select" | "click" | "check">;
  value?: string;
  sensitiveValue: boolean;
  role: IntentTargetRole;
  accessibleName: string;
  group: string;
  hints: IntentTargetHints;
}

export interface IntentRecordingOptions {
  id: string;
  name: string;
  origin: string;
  startUrl: string;
  outcome: IntentScript["outcome"];
  inputs?: IntentInput[];
  inputBindings?: Record<string, string>;
  recordedAt?: string;
  now?: () => Date;
}

interface CdpRuntimeEvaluateResult {
  result?: {
    value?: unknown;
  };
  exceptionDetails?: unknown;
}

export async function installIntentRecorder(cdp: CdpClient): Promise<void> {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: INTENT_RECORDER_HOOK,
  });
  await cdp.send("Runtime.evaluate", {
    expression: INTENT_RECORDER_HOOK,
    awaitPromise: false,
  });
}

export async function clearIntentRecorderEvents(cdp: CdpClient): Promise<void> {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const recorder = window["${INTENT_RECORDER_GLOBAL}"];
      if (recorder && Array.isArray(recorder.events)) recorder.events = [];
    })();`,
    awaitPromise: false,
  });
}

export async function readIntentRecorderEvents(
  cdp: CdpClient,
): Promise<RawRecordedEvent[]> {
  const evaluated = await cdp.send<CdpRuntimeEvaluateResult>(
    "Runtime.evaluate",
    {
      expression: `window["${INTENT_RECORDER_GLOBAL}"] ? window["${INTENT_RECORDER_GLOBAL}"].events : []`,
      returnByValue: true,
    },
  );
  if (evaluated.exceptionDetails) {
    throw new Error("Failed to read intent recorder events from the page");
  }
  return parseRawRecordedEvents(evaluated.result?.value);
}

export async function recordIntentScriptDraftFromCdp(
  cdp: CdpClient,
  options: IntentRecordingOptions,
): Promise<IntentRecordingDraft> {
  const events = await readIntentRecorderEvents(cdp);
  return buildIntentRecordingDraft(events, options);
}

export function buildIntentRecordingDraft(
  events: RawRecordedEvent[],
  options: IntentRecordingOptions,
): IntentRecordingDraft {
  validateFlowId(options.id);

  const inputs = new Map<string, IntentInput>();
  for (const input of options.inputs ?? []) {
    inputs.set(input.name, input);
  }

  const steps = events.map((event, index) => {
    const step = toIntentStep(
      event,
      index,
      options.inputBindings ?? {},
      inputs,
    );
    return step;
  });

  const script: IntentScript = {
    schemaVersion: INTENT_SCRIPT_SCHEMA_VERSION,
    id: options.id,
    name: options.name,
    recordedAt:
      options.recordedAt ??
      (options.now ? options.now() : new Date()).toISOString(),
    origin: options.origin,
    startUrl: options.startUrl,
    inputs: Array.from(inputs.values()),
    steps,
    outcome: options.outcome,
  };

  return {
    script,
    humanReview: {
      required: true,
      reason:
        "intent and target.description are model/deterministic drafts and must be reviewed before replay use.",
      fields: steps
        .filter((step) => step.target)
        .map((step) => ({
          stepId: step.id,
          paths: ["intent", "target.description"],
        })),
    },
  };
}

export function parseRawRecordedEvents(value: unknown): RawRecordedEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item, index) => parseRawRecordedEvent(item, index));
}

function toIntentStep(
  event: RawRecordedEvent,
  index: number,
  inputBindings: Record<string, string>,
  inputs: Map<string, IntentInput>,
): IntentStep {
  const targetName =
    event.accessibleName ||
    event.hints.text ||
    event.hints.attrs.name ||
    event.role;
  const target: IntentTarget = {
    description: draftTargetDescription(event.kind, event.role, targetName),
    role: event.role,
    name: targetName,
    hints: event.hints,
  };

  const step: IntentStep = {
    id: `s${index + 1}`,
    kind: event.kind,
    intent: draftIntent(event.kind, targetName, event.group),
    target,
    onResolveFail: "escalate",
  };

  const value = valueForEvent(event, targetName, index, inputBindings, inputs);
  if (value) {
    step.value = value.value;
    step.verify = value.verify;
  }

  return step;
}

function valueForEvent(
  event: RawRecordedEvent,
  targetName: string,
  index: number,
  inputBindings: Record<string, string>,
  inputs: Map<string, IntentInput>,
): { value: IntentValue; verify: IntentVerify } | null {
  if (event.kind !== "fill" && event.kind !== "select") {
    return null;
  }

  const boundRef =
    inputBindings[targetName] ??
    inputBindings[event.hints.attrs.name] ??
    (event.sensitiveValue
      ? makeInputRef(targetName, event.hints.attrs.name, index)
      : undefined);
  if (!boundRef) {
    const text = event.value ?? "";
    return {
      value: { from: "literal", text },
      verify: { kind: "valueEquals", expect: text },
    };
  }

  if (!inputs.has(boundRef)) {
    inputs.set(boundRef, {
      name: boundRef,
      type: "string",
      example: event.sensitiveValue ? "" : (event.value ?? ""),
      required: true,
    });
  }

  return {
    value: { from: "input", ref: boundRef },
    verify: { kind: "valueEquals", expect: `{{${boundRef}}}` },
  };
}

function draftIntent(
  kind: RawRecordedEvent["kind"],
  targetName: string,
  group: string,
): string {
  const where = group ? `'${group}' 그룹의 ` : "";
  if (kind === "click") return `${where}'${targetName}' 버튼을 누른다`;
  if (kind === "select")
    return `${where}'${targetName}' 선택칸에서 값을 고른다`;
  if (kind === "check") return `${where}'${targetName}' 체크 상태를 바꾼다`;
  return `${where}'${targetName}' 입력칸에 값을 넣는다`;
}

function draftTargetDescription(
  kind: RawRecordedEvent["kind"],
  role: IntentTargetRole,
  targetName: string,
): string {
  if (kind === "click") {
    return role === "link"
      ? `'${targetName}' 라고 적힌 링크`
      : `'${targetName}' 라고 적힌 버튼`;
  }
  if (role === "combobox") return `'${targetName}' 라벨이 붙은 선택칸`;
  if (role === "checkbox") return `'${targetName}' 라벨이 붙은 체크박스`;
  if (role === "radio") return `'${targetName}' 라벨이 붙은 라디오 버튼`;
  return `'${targetName}' 라벨이 붙은 입력칸`;
}

function makeInputRef(
  targetName: string,
  attrName: string,
  index: number,
): string {
  const source = `${attrName} ${targetName}`.toLowerCase();
  if (/password|비밀번호/.test(source)) return "password";
  if (/card|credit|cc-number|카드/.test(source)) return "cardNumber";
  if (/cvc|cvv|security code|보안코드/.test(source)) return "cardSecurityCode";

  const ascii = attrName || targetName;
  const candidate = ascii
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+([a-zA-Z0-9])/g, (_match: string, chr: string) =>
      chr.toUpperCase(),
    )
    .replace(/^[A-Z]/, (chr) => chr.toLowerCase());
  return candidate || `input${index + 1}`;
}

function validateFlowId(id: string): void {
  if (!id.startsWith("flow_")) {
    throw new Error(`Intent script id must start with "flow_": ${id}`);
  }
}

function parseRawRecordedEvent(item: unknown, index: number): RawRecordedEvent {
  if (!isRecord(item)) {
    throw new Error(`Recorded event at index ${index} is not an object`);
  }
  return {
    kind: parseKind(item.kind, index),
    value: parseOptionalString(item.value, `events[${index}].value`),
    sensitiveValue: parseBoolean(
      item.sensitiveValue,
      `events[${index}].sensitiveValue`,
    ),
    role: parseRole(item.role, index),
    accessibleName: parseString(
      item.accessibleName,
      `events[${index}].accessibleName`,
    ),
    group: parseString(item.group, `events[${index}].group`),
    hints: parseHints(item.hints, index),
  };
}

function parseHints(value: unknown, index: number): IntentTargetHints {
  if (!isRecord(value)) {
    throw new Error(`events[${index}].hints is not an object`);
  }
  if (!isRecord(value.attrs)) {
    throw new Error(`events[${index}].hints.attrs is not an object`);
  }
  const nearbyText = value.nearbyText;
  if (!Array.isArray(nearbyText)) {
    throw new Error(`events[${index}].hints.nearbyText is not an array`);
  }
  return {
    css: parseString(value.css, `events[${index}].hints.css`),
    xpath: parseString(value.xpath, `events[${index}].hints.xpath`),
    attrs: {
      name: parseString(value.attrs.name, `events[${index}].hints.attrs.name`),
      placeholder: parseString(
        value.attrs.placeholder,
        `events[${index}].hints.attrs.placeholder`,
      ),
      type: parseString(value.attrs.type, `events[${index}].hints.attrs.type`),
    },
    text: parseString(value.text, `events[${index}].hints.text`),
    nearbyText: nearbyText.map((entry, nearbyIndex) =>
      parseString(entry, `events[${index}].hints.nearbyText[${nearbyIndex}]`),
    ),
  };
}

function parseKind(value: unknown, index: number): RawRecordedEvent["kind"] {
  if (
    value === "fill" ||
    value === "select" ||
    value === "click" ||
    value === "check"
  ) {
    return value;
  }
  throw new Error(`events[${index}].kind is not a supported recorder event`);
}

function parseRole(value: unknown, index: number): IntentTargetRole {
  if (
    value === "textbox" ||
    value === "combobox" ||
    value === "button" ||
    value === "link" ||
    value === "checkbox" ||
    value === "radio"
  ) {
    return value;
  }
  throw new Error(`events[${index}].role is not a supported target role`);
}

function parseString(value: unknown, path: string): string {
  if (typeof value === "string") return value;
  throw new Error(`${path} is not a string`);
}

function parseOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  throw new Error(`${path} is not a string`);
}

function parseBoolean(value: unknown, path: string): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(`${path} is not a boolean`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
