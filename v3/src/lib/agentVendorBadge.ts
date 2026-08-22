/**
 * 에이전트 탭 배지가 실제 스폰된 벤더를 보여주게 하는 해상 함수.
 *
 * 왜 필요한가: env-swap 벤더(GLM/MiniMax/DeepSeek/Kimi/Solar)는 자기 CLI 가
 * 없다 — `claude`/`gpt` 하네스를 그대로 스폰하고 env(ANTHROPIC_BASE_URL 등)만
 * 갈아끼워 다른 백엔드로 붙는다(`electron/model-registry.ts` 의
 * `VendorEnvProfile`). 그래서 `Agent.model`(하네스 축)만 보면 이 벤더들도 전부
 * "claude"/"gpt" 로 보인다 — 하네스 네이티브(claude/codex/grok 등)와 구분이 안
 * 된다. `Agent.spawnedModel`(스폰 argv 를 되읽어 스탬프한 실제 모델 id)을
 * 레지스트리에 되물으면 진짜 벤더를 알 수 있다.
 */
import { vendorForModel, type VendorId } from "../../electron/model-registry";
import type { ModelType } from "../types/agent";
import {
  HARNESS_VENDOR_KINDS,
  type VendorKind,
} from "../components/agents/list-panel/types";

const HARNESS_SET: ReadonlySet<string> = new Set(HARNESS_VENDOR_KINDS);

/** env-swap 벤더만의 좁은 유니온 — `VendorKind` 에 이 값들이 리터럴로 있다. */
type EnvSwapVendorId = "zai" | "minimax" | "deepseek" | "moonshot" | "upstage";

/**
 * 자기 CLI 가 없어 배지로 구분해줘야 하는 벤더만. 하네스 네이티브 벤더
 * (anthropic/openai/google/xai/local/custom) 는 하네스 배지를 그대로 쓴다 —
 * 여기 넣으면 harness 배지(Claude/Codex/Grok/...)가 사라지고 회귀가 난다.
 */
const ENV_SWAP_VENDORS: ReadonlySet<EnvSwapVendorId> = new Set([
  "zai",
  "minimax",
  "deepseek",
  "moonshot",
  "upstage",
]);

function isEnvSwapVendor(provider: VendorId): provider is EnvSwapVendorId {
  return (ENV_SWAP_VENDORS as ReadonlySet<VendorId>).has(provider);
}

/**
 * 이 행에 그릴 배지 종류(`VendorKind`)를 정한다.
 *  1. `spawnedModel` 이 레지스트리에 알려진 id 이고 그 provider 가 env-swap
 *     벤더면, 그 벤더로 구분 배지를 낸다(GLM/MiniMax/DeepSeek/Kimi/Solar).
 *  2. 그 외(스폰 전·모델 미핀·미상 모델·하네스 네이티브)는 종전처럼 harness
 *     로 배지를 낸다.
 *  3. harness 조차 모르면(빈 문자열·신규 미등록 값) "custom" 으로 떨어진다 —
 *     빈칸을 남기지 않는다.
 */
export function resolveAgentVendorKind(
  model: ModelType | string | null | undefined,
  spawnedModel: string | null | undefined,
): VendorKind {
  const trimmed = spawnedModel?.trim();
  if (trimmed) {
    const provider = vendorForModel(trimmed);
    if (provider && isEnvSwapVendor(provider)) {
      return provider;
    }
  }
  return typeof model === "string" && HARNESS_SET.has(model)
    ? (model as ModelType)
    : "custom";
}
