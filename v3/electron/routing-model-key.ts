/**
 * 라우팅 지식그래프의 **모델 축 해상도**(P2-2).
 *
 * `routing-graph.ts` 의 cell key 는 `role:backend|<modelKey>` 꼴이고, 이 파일이
 * 그 `<modelKey>` 를 만든다. 종전엔 프로바이더 문자열(`claude`/`gpt`)이라
 * "gpt-5.5 low 가 simple 에서 잘했다" 를 담을 자리가 자료구조에 없었다
 * (INTELLIGENT-ROUTING-PLAN.md §1.3-②). 이제 `claude-opus-5`·`gpt-5.5@medium`
 * 처럼 model@effort 해상도로 쓴다.
 *
 * ── 규율 ────────────────────────────────────────────────────────────────
 * 1. **모델 사실은 여기 없다.** id·alias·effort 지원·단가는 `model-registry.ts`,
 *    "어느 난도에 어느 칸" 은 `model-ladder.ts` + `agent-config.ts` 티어 정책이
 *    갖는다. 이 파일은 그 두 곳의 답을 **키 문자열로 접는 어댑터**다.
 * 2. **쓰기는 관측, 읽기는 예측.** 쓰기 경로(graph-updater)는 실제 스폰 argv 에서
 *    되읽은 값만 쓴다(`modelKeyFromSpawn`). 읽기 경로(dispatch 스코어러)는 아직
 *    스폰 전이므로 "이 프로바이더를 고르면 무엇으로 뜰 것인가" 를 **같은
 *    resolver 로** 예측한다(`predictedModelKey`) — 두 경로가 다른 함수로 키를
 *    만들면 읽는 셀과 쓰는 셀이 갈라져 학습이 조용히 죽는다.
 * 3. **모르면 프로바이더 키로 떨어진다.** gemini/antigravity/local 은 CLI-verified
 *    모델 사실이 아직 없어(레지스트리 하단 주석) 사다리도 없다. 그 경우 구체 id
 *    를 지어내지 않고 종전 키를 그대로 쓴다 — 그래서 그 벤더들의 학습은 무회귀다.
 * 4. **`agent-config` 를 import 하지 않는다.** 티어 정책은 `TierModelResolver` 로
 *    주입받는다. 그래야 (a) 이 모듈이 CLI 프로브 없이 결정적으로 유닛테스트되고,
 *    (b) 그래프 읽기 경로가 무거운 스폰 모듈을 끌고 오지 않는다.
 */

import {
  isApprovalGatedEffort,
  ladderFor,
  entryRung,
  type LadderTier,
} from "./model-ladder";
import { resolveModelAlias } from "./model-registry";

/** `agent-config.modelTierForComplexity` 의 반환 모양(구조적 타입). */
export interface TierModelResolution {
  claudeModel?: string;
  codexReasoning?: string;
}

/**
 * 난도 → (모델|effort) 정책. 프로덕션에서는 `agent-config.modelTierForComplexity`
 * 를 그대로 넘긴다 — 스폰이 쓰는 그 함수여야 예측 키와 실제 키가 일치한다.
 */
export type TierModelResolver = (
  provider: string,
  complexity: LadderTier | undefined,
) => TierModelResolution;

/** 실제 스폰 argv 에서 되읽은 모델 축(agent-manager.SpawnedModelInfo 구조부분). */
export interface SpawnedModelLike {
  modelId?: string;
  effort?: string;
}

/** `model@effort` 표기. effort 축이 없는 모델은 model 만. `model-ladder.rungLabel` 과 같은 모양이다. */
export function formatModelKey(
  modelId: string,
  effort?: string | null,
): string {
  const id = (modelId ?? "").trim().toLowerCase();
  const level = (effort ?? "").trim().toLowerCase();
  if (!id) return "";
  return level ? `${id}@${level}` : id;
}

/**
 * 이 프로바이더가 오늘 실제로 서빙하는 모델 id.
 *
 * codex 는 `pinsModel=false` — 우리 스폰은 effort 만 넘기고 모델은 사용자
 * `~/.codex/config.toml` 값을 쓴다. 그래서 "권장 칸의 모델"(rung.model)이 아니라
 * 사다리가 그 목적으로 들고 있는 `inheritedModel` 이 그래프 키의 모델이 된다
 * (`ProviderLadder.inheritedModel` 주석: "비용추정·그래프 키 용도").
 * 모델 핀 배선이 켜지면 이 함수만 pinsModel 분기를 타 자동으로 바뀐다.
 */
function servedModelId(
  provider: string,
  complexity: LadderTier | undefined,
): string | undefined {
  const ladder = ladderFor(provider as never);
  if (!ladder) return undefined;
  if (!ladder.pinsModel) return ladder.inheritedModel;
  const rung = complexity
    ? entryRung(provider as never, complexity)
    : undefined;
  return rung?.model;
}

/**
 * **쓰기 경로 키** — 실제로 뭘로 떴는지(argv 관측)에서 만든다.
 *
 * `info.modelId` 가 있으면 그게 사실이다. 없고 effort 만 있으면(=codex 기본 경로)
 * 모델은 사용자 config 상속값이므로 `inheritedModel` 로 채운다. 둘 다 없으면
 * `null` — 그러면 호출자가 프로바이더 키로 떨어져 종전과 같이 학습한다.
 * ★난도에서 모델을 역추론하지 않는다(추측을 관측으로 적지 않는다).
 */
export function modelKeyFromSpawn(
  provider: string,
  info: SpawnedModelLike | null | undefined,
): string | null {
  const modelId = info?.modelId?.trim();
  const effort = info?.effort?.trim();
  if (modelId)
    return formatModelKey(resolveModelAlias(modelId), effort) || null;
  if (!effort) return null;
  const inherited = ladderFor(provider as never)?.inheritedModel;
  return inherited ? formatModelKey(inherited, effort) : null;
}

/**
 * **읽기 경로 키** — 이 프로바이더를 고르면 무엇으로 뜰지의 예측.
 *
 * 난도가 없으면(`complexity` undefined) 스폰이 모델 인자를 아예 붙이지 않아 CLI
 * 기본값이 서빙된다 — 그 값을 우리가 지어낼 수 없으므로 `null` 을 돌려주고 구키로
 * 떨어진다.
 *
 * ★승인 게이트(§4 넷-뉴 1-b)와의 관계: 여기 나오는 effort 는 티어 정책이 준
 * 값이고 그 경로는 max/ultra 를 env 로도 통과시키지 않는다
 * (`agent-config.validateCodexEffortEnv`). 그래도 방어적으로 게이트 칸이면
 * 예측을 포기한다 — 데이터 편향이 비용 상한을 우회할 입구를 만들지 않는다.
 */
export function predictedModelKey(
  provider: string,
  complexity: LadderTier | undefined,
  resolveTier: TierModelResolver,
): string | null {
  if (!complexity) return null;
  let tier: TierModelResolution;
  try {
    tier = resolveTier(provider, complexity) ?? {};
  } catch {
    // 티어 정책이 던지면(사다리 설정 오류 등) 그래프 해상도를 포기하고 구키로
    // 떨어진다 — dispatch 자체를 깨뜨리지 않는다.
    return null;
  }
  if (provider === "claude") {
    const id = tier.claudeModel?.trim();
    return id ? formatModelKey(resolveModelAlias(id)) || null : null;
  }
  if (provider === "gpt") {
    const effort = tier.codexReasoning?.trim();
    if (effort && isApprovalGatedEffort(effort)) return null;
    const modelId = servedModelId(provider, complexity);
    if (!modelId) return null;
    return formatModelKey(modelId, effort) || null;
  }
  return null;
}

/**
 * 그래프 조회에 넘길 키들 — **구체적인 것부터**(`["gpt-5.5@medium", "gpt"]`).
 *
 * 두 번째 칸이 P2-2 마이그레이션의 핵심인 **구키 폴백**이다: 종전 프로바이더
 * 셀에 쌓인 94건이 새 셀의 prior 로 계속 일하고, 새 셀에 관측이 차면 자동으로
 * 비중이 옮겨간다(routing-graph.blendKeyTiers). 예측이 불가한 프로바이더는
 * 칸이 하나뿐이므로 종전과 바이트 동일하다.
 */
export function graphModelKeys(
  provider: string,
  complexity: LadderTier | undefined,
  resolveTier: TierModelResolver,
): string[] {
  const precise = predictedModelKey(provider, complexity, resolveTier);
  return precise && precise !== provider ? [precise, provider] : [provider];
}
