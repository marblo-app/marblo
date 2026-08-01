import type {
  MissionLaunchTemplateId,
  MissionStep,
  MissionStepFailurePolicy,
  MissionStepType,
  MissionTemplateId,
} from "../../types/mission";
import type { MessageKey } from "../../locales/ko";

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
  id: MissionLaunchTemplateId;
  label: string;
  emoji: string;
  weight: "light" | "medium" | "heavy";
  description: string;
  steps: StepSpec[];
}

// ★런치 가능한 템플릿만. 암묵적 미션의 "adhoc" 은 실행 계획이 없어 여기 없고,
// 그래서 listTemplates()(런치 다이얼로그 목록)에도 나타나지 않는다.
export const TEMPLATE_META: Record<
  MissionLaunchTemplateId,
  MissionTemplateMeta
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

/**
 * `missions.*` translation key for each template's user-facing description.
 * The `description` field above stays as the Korean source-of-truth (and the
 * electron-engine mirror), but the UI renders the localized copy via t() with
 * these keys. Typed `MessageKey` so a missing locale entry is a compile error.
 */
export const TEMPLATE_DESC_KEY: Record<MissionLaunchTemplateId, MessageKey> = {
  "quick-fix": "missions.template.quick-fix.desc",
  polish: "missions.template.polish.desc",
  feature: "missions.template.feature.desc",
  "full-feature": "missions.template.full-feature.desc",
  research: "missions.template.research.desc",
};

/**
 * 미션 문서의 templateId → 메타. 런치 템플릿이 아니면(암묵적 미션의 "adhoc")
 * `undefined` — 호출부는 이미 전부 `meta?.` 로 읽고 있다.
 */
export function templateMeta(
  id: MissionTemplateId,
): MissionTemplateMeta | undefined {
  return (
    TEMPLATE_META as Partial<Record<MissionTemplateId, MissionTemplateMeta>>
  )[id];
}

export function listTemplates(): MissionTemplateMeta[] {
  return Object.values(TEMPLATE_META);
}

export function instantiateTemplateSteps(
  id: MissionLaunchTemplateId,
): MissionStep[] {
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

/** 런치 가능한 템플릿 id 인가 — 미션 문서의 넓은 templateId 를 좁히는 게이트. */
export function isLaunchTemplateId(
  id: MissionTemplateId,
): id is MissionLaunchTemplateId {
  return id in TEMPLATE_META;
}
