import type {
  MissionStep,
  MissionStepFailurePolicy,
  MissionStepType,
  MissionTemplateId,
} from "./types";

// 5 개 자동화 미션 템플릿 — 각각 다른 gstack 슬래시 명령 시퀀스.
// 명세: v3/docs/MISSIONS-SPEC.md §5.

type StepSpec = {
  type: MissionStepType;
  skill?: string;
  args?: string;
  onFailure?: MissionStepFailurePolicy;
};

export interface MissionTemplate {
  id: MissionTemplateId;
  label: string;
  emoji: string;
  weight: "light" | "medium" | "heavy";
  description: string;
  steps: StepSpec[];
}

// 정책 default:
// - 검증 단계 (review/qa/design-review) → retry — 자동화 우선 (D10)
// - 의사결정 단계 (plan-*/office-hours) → 명시 없음 = retry (default)
// - terminal 단계 (ship) → escalate — 실패 시 사용자 보고 필요
// - 조사 단계 (investigate) → escalate — 결과 없이 fix 진행 불가
export const MISSION_TEMPLATES: Record<MissionTemplateId, MissionTemplate> = {
  "quick-fix": {
    id: "quick-fix",
    label: "Quick Fix",
    emoji: "⚡",
    weight: "light",
    description: "버그 / 소수정 / 핫픽스",
    steps: [
      { type: "gstack", skill: "/investigate", onFailure: "escalate" },
      { type: "fix" },
      { type: "gstack", skill: "/review", onFailure: "retry" },
      { type: "gstack", skill: "/ship", onFailure: "escalate" },
    ],
  },
  polish: {
    id: "polish",
    label: "Polish",
    emoji: "💅",
    weight: "light",
    description: "기존 UI 다듬기 · 시각 QA",
    steps: [
      { type: "gstack", skill: "/design-review", onFailure: "retry" },
      { type: "gstack", skill: "/review", onFailure: "retry" },
      { type: "gstack", skill: "/ship", onFailure: "escalate" },
    ],
  },
  feature: {
    id: "feature",
    label: "Feature",
    emoji: "🛠️",
    weight: "medium",
    description: "이미 기획된 작업 구현",
    steps: [
      { type: "gstack", skill: "/plan-eng-review" },
      { type: "dispatch" },
      { type: "wait" },
      { type: "gstack", skill: "/review", onFailure: "retry" },
      { type: "gstack", skill: "/qa", onFailure: "retry" },
      { type: "gstack", skill: "/ship", onFailure: "escalate" },
    ],
  },
  "full-feature": {
    id: "full-feature",
    label: "Full Feature",
    emoji: "🏛️",
    weight: "heavy",
    description: "제대로 된 신기능 (강의 데모 60초 hook)",
    steps: [
      { type: "gstack", skill: "/office-hours" },
      { type: "gstack", skill: "/plan-ceo-review" },
      { type: "gstack", skill: "/plan-eng-review" },
      { type: "gstack", skill: "/plan-design-review" },
      { type: "dispatch" },
      { type: "wait" },
      { type: "gstack", skill: "/review", onFailure: "retry" },
      { type: "gstack", skill: "/qa", onFailure: "retry" },
      { type: "gstack", skill: "/design-review", onFailure: "retry" },
      { type: "gstack", skill: "/ship", onFailure: "escalate" },
    ],
  },
  research: {
    id: "research",
    label: "Research only",
    emoji: "🔬",
    weight: "heavy",
    description: "구현 없이 의사결정만 (디자인 docs 생성)",
    steps: [
      { type: "gstack", skill: "/office-hours" },
      { type: "gstack", skill: "/plan-ceo-review" },
    ],
  },
};

export function getTemplate(id: MissionTemplateId): MissionTemplate {
  const t = MISSION_TEMPLATES[id];
  if (!t) throw new Error(`Unknown mission template: ${id}`);
  return t;
}

export function instantiateSteps(id: MissionTemplateId): MissionStep[] {
  return getTemplate(id).steps.map((spec, index) => ({
    type: spec.type,
    skill: spec.skill,
    args: spec.args,
    onFailure: spec.onFailure,
    index,
    status: "pending" as const,
    retryCount: 0,
  }));
}

export function listTemplates(): MissionTemplate[] {
  return Object.values(MISSION_TEMPLATES);
}
