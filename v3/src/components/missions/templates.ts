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
    description: "버그 하나를 빠르게 — 원인 추적부터 수정·리뷰·배포까지",
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
    description: "이미 있는 화면을 더 깔끔하게 — 디자인 점검 후 배포",
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
    description: "기획이 끝난 기능 구현 — 설계 검토 후 만들고 QA·배포",
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
    description:
      "아이디어부터 배포까지 통째로 — 기획·설계·디자인 검토를 거쳐 끝까지",
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
    label: "Research",
    emoji: "🔬",
    weight: "heavy",
    description: "코드는 그대로, 방향만 — 요구사항을 파고들어 기획·전략 정리",
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
  // Firestore 는 undefined 필드를 거부하므로 명시적으로 set 된 키만 포함시킨다.
  return TEMPLATE_META[id].steps.map((spec, index) => {
    const step: MissionStep = {
      type: spec.type,
      index,
      status: "pending",
      retryCount: 0,
    };
    if (spec.skill !== undefined) step.skill = spec.skill;
    if (spec.args !== undefined) step.args = spec.args;
    if (spec.onFailure !== undefined) step.onFailure = spec.onFailure;
    return step;
  });
}
