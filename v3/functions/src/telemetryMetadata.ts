// events.metadata 컬럼 조립 — 순수 로직(BQ/Firebase 무의존).
// adminAnalytics.ts / betaSegments.ts 와 같은 규약으로 index.ts 에서 떼어내
// node --test 로 단위검증한다.
//
// ── ★왜 이 조각만 따로 떼어냈나 (ticket woXp2c70oR0tliGB8Vs6) ────────────────
// 이 함수는 "events 테이블에 무엇이 적히는가" 를 결정하는 단일 지점이고, 그건
// 이제 프라이버시 불변식이다: **events 에는 계정 식별자가 들어가지 않는다.**
// 예전에는 logTelemetryBatch 가 여기에 accountUserId(=Firebase uid)를 몰래
// 얹었고, 처리방침은 같은 테이블을 "계정 UID 없는 익명 설치 ID" 로 고지하고
// 있었다. 문구가 아니라 코드를 고쳐 uid 부착을 중단했으므로, 되돌아오지 않도록
// 테스트가 지킬 수 있는 자리로 옮긴다(telemetryMetadata.test.ts).
//
// 여정 상관키는 익명 설치 ID(telemetryService.getClientId) 하나이며, 그건 이
// 함수가 아니라 row 의 userId 컬럼이 담는다.

/**
 * dispatch:decision 이벤트에서 metadata JSON 으로 접히는 필드 화이트리스트.
 * `model`/`agentId`/`taskId`/`role` 은 여기 없다 — 이미 1급 컬럼이다
 * (selectedModel 은 GROUP BY model 을 위해 `model` 로도 함께 보낸다).
 *
 * ★화이트리스트다 — 여기 없는 필드는 클라이언트가 보내도 metadata 에 접히지
 * 않고 조용히 사라진다. 새 결정 필드를 BigQuery 까지 살려 보내려면 등재 필수.
 */
export const DISPATCH_DECISION_META_KEYS = [
  "reuseVsSpawn",
  "selectedModel",
  "complexity",
  "tags",
  "eligibleModels",
  "explicitModel",
  "decisionReason",
  "modelSelectionMode",
  "perModelScores",
  "agentScore",
  "spawnedModel",
  "modelFallbackReason",
  // ★#890 F-1~F-4.
  "spawnedModelSource",
  "plannedModelKey",
  "candidateKeys",
  "candidateCostIndex",
  "decisionState",
  "decisionComponents",
] as const;

/**
 * buildMetadata 가 보는 최소 형태. index.ts 의 TelemetryRow 가 구조적으로
 * 이 타입에 들어맞으므로 그 큰 인터페이스를 여기로 끌고 오지 않는다.
 */
export interface TelemetryMetadataSource {
  event: string;
  metadata?: unknown;
}

/** JSON object 문자열을 파싱한다. object 가 아니거나 깨졌으면 {}. */
export function safeParseObject(s: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * 이벤트 1건의 `metadata` STRING 컬럼 값을 만든다.
 *
 * dispatch:decision 은 결정 관련 필드(perModelScores, reuseVsSpawn, 선택 모드…)를
 * metadata JSON 에 접어 넣는다. 설계 선택은 "필드마다 BQ 컬럼" 이 아니라 "JSON
 * STRING 단일 컬럼":
 *   - 하위호환: 스트리밍 인서트 테이블에 ALTER TABLE 이 필요 없다(스키마 변경이
 *     전파될 때까지 인서트가 실패할 위험이 있고, 기존 row 리플레이도 깨진다).
 *     배포는 함수 `firebase deploy` 뿐, BigQuery 마이그레이션이 없다.
 *   - 질의 편의: JSON_VALUE(metadata,'$.reuseVsSpawn') 같은 식으로 잘라
 *     cost_logs.taskId·task_outcomes 와 조인한다.
 *
 * ★불변식: 어떤 경로로도 계정 식별자(uid·이메일·전화)를 넣지 않는다. 계정에
 * 묶인 사용량은 cost_logs 에만 존재한다(사용자 본인에게 자기 지출을 되돌려주는
 * 용도). 클라이언트가 보낸 metadata 안의 식별자는 송신 전 렌더러
 * (telemetryService.scrub)가 이미 걷어낸다 — 여기서는 서버가 **새로 더하지
 * 않는다** 는 것만 보장한다.
 */
export function buildMetadata(e: TelemetryMetadataSource): string | null {
  const base =
    e.metadata != null
      ? typeof e.metadata === "string"
        ? safeParseObject(e.metadata)
        : (e.metadata as Record<string, unknown>)
      : {};

  if (e.event === "dispatch:decision") {
    const decision: Record<string, unknown> = { ...base };
    const row = e as unknown as Record<string, unknown>;
    for (const key of DISPATCH_DECISION_META_KEYS) {
      const v = row[key];
      if (v !== undefined) decision[key] = v;
    }
    return Object.keys(decision).length > 0 ? JSON.stringify(decision) : null;
  }

  return Object.keys(base).length > 0 ? JSON.stringify(base) : null;
}
