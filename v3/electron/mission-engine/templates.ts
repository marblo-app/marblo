import type {
  MissionLaunchTemplateId,
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
  id: MissionLaunchTemplateId;
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
// ★런치 템플릿만 담는다(`MissionLaunchTemplateId`). 암묵적 미션의 "adhoc" 은
// 실행 계획이 없어 여기 없고, 그래서 listTemplates()/런치 다이얼로그에도 안 뜬다.
export const MISSION_TEMPLATES: Record<
  MissionLaunchTemplateId,
  MissionTemplate
> = {
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

export function getTemplate(id: MissionLaunchTemplateId): MissionTemplate {
  const t = MISSION_TEMPLATES[id];
  if (!t) throw new Error(`Unknown mission template: ${id}`);
  return t;
}

export function instantiateSteps(id: MissionLaunchTemplateId): MissionStep[] {
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

/**
 * 미션 문서의 templateId 로 템플릿 찾기 — 없으면 `undefined`.
 * 암묵적 미션("adhoc")처럼 런치 템플릿이 아닌 값이 들어와도 터지지 않는다.
 */
export function findTemplate(
  id: MissionTemplateId,
): MissionTemplate | undefined {
  return (
    MISSION_TEMPLATES as Partial<Record<MissionTemplateId, MissionTemplate>>
  )[id];
}

export function listTemplates(): MissionTemplate[] {
  return Object.values(MISSION_TEMPLATES);
}
