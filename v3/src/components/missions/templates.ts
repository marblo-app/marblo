import type {
  MissionStep,
  MissionStepFailurePolicy,
  MissionStepType,
  MissionTemplateId,
} from "../../types/mission";

// frontend 측 mission 템플릿 메타데이터.
// `v3/electron/mission-engine/templates.ts` 와 의도적으로 미러링한다 —
// electron rootDir 제약으로 두 모듈이 직접 import 를 공유할 수 없다.
// 둘 다 같은 출처 (명세 §5) 이므로 PR 시 함께 갱신할 것.

type StepSpec = {
  type: MissionStepType;
  skill?: string;
  args?: string;
  onFailure?: MissionStepFailurePolicy;
};

export interface MissionTemplateMeta {
  id: MissionTemplateId;
  label: string;
  emoji: string;
  weight: "light" | "medium" | "heavy";
  description: string;
  steps: StepSpec[];
}

export const TEMPLATE_META: Record<MissionTemplateId, MissionTemplateMeta> = {
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

export function listTemplates(): MissionTemplateMeta[] {
  return Object.values(TEMPLATE_META);
}

export function instantiateTemplateSteps(id: MissionTemplateId): MissionStep[] {
  return TEMPLATE_META[id].steps.map((spec, index) => ({
    type: spec.type,
    skill: spec.skill,
    args: spec.args,
    onFailure: spec.onFailure,
    index,
    status: "pending" as const,
    retryCount: 0,
  }));
}
