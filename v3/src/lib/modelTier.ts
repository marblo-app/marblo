/**
 * 모델 티어 파생 — **렌더러 셰임**. 구현은 `electron/mcp-server/model-tier.ts`.
 *
 * 왜 여기 로직이 없나: 같은 티어를 읽는 곳이 두 프로세스가 됐다(사용량 탭 정보표
 * + 오케가 부르는 MCP `get_model_guidance`). 두 프로세스가 동시에 import 할 수
 * 있는 유일한 디렉토리가 `electron/mcp-server/` 라서 구현이 그리로 갔다 — 사유는
 * 그 파일 헤더에 있다. 이 파일은 렌더러의 종전 import 경로
 * (`src/components/usage/ModelFactSheet.tsx`, `tests/unit/model-tier.test.ts`)를
 * 그대로 유지하기 위한 얇은 재수출이다. 알고리즘은 한 벌뿐이다.
 */
export {
  MODEL_TIER_ORDER,
  modelFleetStats,
  modelTierOf,
  withModelTiers,
  groupModelsByTier,
  type ModelTier,
  type ModelCapability,
  type ModelTierFacts,
  type ModelTierReason,
  type ModelTierVerdict,
  type ModelTierAssignment,
  type ModelTierGroup,
  type ModelFleetStats,
} from "../../electron/mcp-server/model-tier";
