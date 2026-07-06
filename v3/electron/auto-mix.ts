/**
 * Usage-aware auto-mix policy (SPAWN-MODEL-ALLOCATION-V2 §B / 티켓 XL3NhdW).
 *
 * 배경: dispatch_task 의 모델 믹스(Claude 최상위 + Codex high 동반)는 지금까지
 * `mix` 파라미터로 **수동 opt-in** 할 때만 발동했다. 이 모듈은 "Codex·Claude 가
 * 둘 다 연결돼 있고 전체 usage 에 여유가 있으면 어려운(complex) 작업에서 자동으로
 * 교차검증 믹스를 걸고, 한쪽이 소진 임박이면 반대 모델로 라우팅한다"는 규칙을
 * **순수 함수**로 구현한다 — process.env·시계·spawn 같은 부작용이 전혀 없어
 * 단위테스트가 쉽고, 실제 배선(bridge-server)은 이 결정을 그대로 적용만 한다.
 *
 * ★안전 원칙:
 *   1. 기본 OFF. `MARBLO_AUTO_MIX` 플래그가 켜졌을 때만 활성(미설정=현행 무변동).
 *   2. complex 티어 한정. simple/standard 는 절대 건드리지 않는다.
 *   3. 명시적 mix 요청이 있으면 그대로 존중(자동판단 무시).
 *   4. reroute(반대 모델 라우팅)는 호출자가 model 을 **명시하지 않았을 때만**.
 *      명시적 model 지정을 뒤엎으면 재배정 가드 정책 위반이라 절대 안 함.
 *   5. usage 정보가 없으면(null) "여유 있음"으로 낙관하지 않는다 — 아무 것도 안 함.
 */

import type { ModelType } from "./agent-manager";
import type { RateLimitInfo } from "./session-parsers";

/** usage 여유 임계값 기본치(사용률 %). 이 미만이면 "여유(headroom)"로 본다. */
export const DEFAULT_MIX_HEADROOM_PCT = 80;
/** usage 소진 임박 임계값 기본치(사용률 %). 이 이상이면 "소진 임박"으로 본다. */
export const DEFAULT_MIX_EXHAUST_PCT = 90;

export type MixMode = "cross-check" | "split-role";

export interface AutoMixInput {
  /** MARBLO_AUTO_MIX 플래그 on 여부. */
  enabled: boolean;
  /** 요청 난도. complex 만 대상. */
  complexity: "simple" | "standard" | "complex";
  /** 호출자가 이미 mix 를 명시했나(명시 시 자동판단 skip). */
  explicitMix: boolean;
  /** 호출자가 model 을 명시했나(명시 시 reroute 금지). */
  explicitModel: boolean;
  /** 정규화된 유효 프로바이더(명시 model 또는 undefined). */
  effectiveModel: ModelType | undefined;
  /** claude 가 이 프로젝트에서 활성/연결돼 있나. */
  claudeEnabled: boolean;
  /** gpt(Codex)가 이 프로젝트에서 활성/연결돼 있나. */
  gptEnabled: boolean;
  /** account-global Claude rate-limit(없으면 null = 정보없음). */
  claude: RateLimitInfo | null;
  /** account-global Codex rate-limit(없으면 null = 정보없음). */
  gpt: RateLimitInfo | null;
  /** 여유 임계값(%). 미지정 시 DEFAULT_MIX_HEADROOM_PCT. */
  headroomPct?: number;
  /** 소진 임박 임계값(%). 미지정 시 DEFAULT_MIX_EXHAUST_PCT. */
  exhaustPct?: number;
}

export interface AutoMixDecision {
  /** 설정하면 이 모드로 Codex 동반 믹스를 자동 발동(dispatchMix). */
  mix?: MixMode;
  /** 설정하면 (명시 model 이 없을 때) 이 프로바이더로 1차 라우팅을 바꾼다. */
  rerouteModel?: ModelType;
  /** 사람이 읽을 결정 사유(로그/텔레메트리용). 항상 채워진다. */
  reason: string;
}

/**
 * 한 프로바이더의 "구속(binding) 사용률"을 고른다 — short/weekly 두 윈도우 중
 * 더 높은 쪽(=먼저 소진되는 쪽)을 보수적으로 취한다. 둘 다 null 이면 null(정보없음).
 */
export function bindingPercent(info: RateLimitInfo | null): number | null {
  if (!info) return null;
  const vals = [info.primaryPercent, info.secondaryPercent].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  return vals.length ? Math.max(...vals) : null;
}

/**
 * usage 기반 자동 믹스/라우팅 결정(순수). 부작용 없음 — 입력만으로 판정한다.
 *
 * 판정 순서(먼저 매칭되는 하나만 적용):
 *   0. 비활성/미대상(플래그 off·complex 아님·명시 mix·둘 중 하나 미연결) → 무동작.
 *   1. reroute — model 미명시 & 한쪽 소진임박 & 반대쪽 여유 → 여유 쪽으로 라우팅.
 *   2. mix    — 1차가 claude & claude·codex 둘 다 여유 → cross-check 자동 믹스.
 *   3. 그 외(중간 사용률/정보없음) → 무동작(현행 단일 디스패치).
 */
export function decideAutoMix(input: AutoMixInput): AutoMixDecision {
  const headroom = input.headroomPct ?? DEFAULT_MIX_HEADROOM_PCT;
  const exhaust = input.exhaustPct ?? DEFAULT_MIX_EXHAUST_PCT;

  if (!input.enabled) return { reason: "auto-mix 비활성(MARBLO_AUTO_MIX off)" };
  if (input.complexity !== "complex")
    return {
      reason: `complex 아님(complexity=${input.complexity}) — 대상 아님`,
    };
  if (input.explicitMix)
    return { reason: "명시적 mix 요청 — 자동판단 skip(수동 존중)" };
  if (!input.claudeEnabled || !input.gptEnabled)
    return {
      reason: `둘 다 연결 아님(claude=${input.claudeEnabled}, gpt=${input.gptEnabled}) — 자동 믹스 조건 미충족`,
    };

  const c = bindingPercent(input.claude);
  const g = bindingPercent(input.gpt);
  const constrained = (x: number | null): x is number =>
    x !== null && x >= exhaust;
  const free = (x: number | null): x is number => x !== null && x < headroom;

  // 1. 소진 임박 → 반대 모델로 라우팅(명시 model 이 없을 때만).
  if (!input.explicitModel) {
    if (constrained(c) && free(g)) {
      return {
        rerouteModel: "gpt",
        reason: `Claude ${c}%≥${exhaust}(소진 임박) → 여유 있는 Codex ${g}% 로 1차 라우팅`,
      };
    }
    if (constrained(g) && free(c)) {
      return {
        rerouteModel: "claude",
        reason: `Codex ${g}%≥${exhaust}(소진 임박) → 여유 있는 Claude ${c}% 로 1차 라우팅`,
      };
    }
  }

  // 2. 1차가 Claude 이고 양쪽 다 여유 → Codex 교차검증 자동 믹스.
  //    effectiveModel === "claude"(명시 claude) 또는 미명시+claude 연결이면
  //    1차는 Claude 경로다. 미명시는 스코어링이 다른 모델을 뽑을 수도 있으나,
  //    complex+양쪽여유에서 Claude 최상위를 1차로 두고 Codex 로 교차검증하는 게
  //    이 정책의 의도라 Claude 를 1차로 고정하는 rerouteModel 을 함께 돌려준다.
  if (free(c) && free(g)) {
    if (input.effectiveModel === "claude") {
      return {
        mix: "cross-check",
        reason: `Claude ${c}% · Codex ${g}% 모두 여유(<${headroom}) → Codex 교차검증 자동 믹스`,
      };
    }
    if (input.effectiveModel === undefined) {
      return {
        mix: "cross-check",
        rerouteModel: "claude",
        reason: `model 미지정 + Claude ${c}% · Codex ${g}% 여유 → Claude 1차 고정 + Codex 교차검증 자동 믹스`,
      };
    }
  }

  return {
    reason: `자동 동작 없음(claude=${c ?? "?"}%, codex=${g ?? "?"}%, model=${
      input.effectiveModel ?? "미지정"
    })`,
  };
}

/** MARBLO_AUTO_MIX 플래그 파싱(1/true/on/yes = 켜짐). 기본 off. */
export function isAutoMixEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.MARBLO_AUTO_MIX || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

/** 여유/소진 임계값을 env 에서 읽는다(MARBLO_MIX_HEADROOM_PCT / MARBLO_MIX_EXHAUST_PCT).
 *  파싱 실패/범위 밖(0..100) 이면 기본치로 폴백. */
export function autoMixThresholds(env: NodeJS.ProcessEnv = process.env): {
  headroomPct: number;
  exhaustPct: number;
} {
  const parse = (v: string | undefined, dflt: number): number => {
    const n = Number.parseInt((v || "").trim(), 10);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : dflt;
  };
  const headroomPct = parse(
    env.MARBLO_MIX_HEADROOM_PCT,
    DEFAULT_MIX_HEADROOM_PCT,
  );
  const exhaustPct = parse(env.MARBLO_MIX_EXHAUST_PCT, DEFAULT_MIX_EXHAUST_PCT);
  // 여유 임계값이 소진 임계값보다 높으면 논리가 뒤집히므로 보정.
  return exhaustPct >= headroomPct
    ? { headroomPct, exhaustPct }
    : {
        headroomPct: DEFAULT_MIX_HEADROOM_PCT,
        exhaustPct: DEFAULT_MIX_EXHAUST_PCT,
      };
}
