/**
 * "시작하기" 탭의 **벤더 편입 카드**를 세우는 순수 규칙.
 *
 * ── 왜 이 파일이 따로 있나 ────────────────────────────────────────────────
 * 시작하기 탭은 오랫동안 `claude`/`codex` 두 CLI 만 전제했다. 그 사이 레지스트리엔
 * Grok(네이티브 하네스)·GLM·MiniMax·Kimi(env-swap)가 들어왔는데, 첫 실행 화면엔
 * 그 벤더들을 켜는 길이 아예 없었다 — 앱을 처음 켠 사람은 "이 앱은 Claude 전용" 으로
 * 읽고 끝난다.
 *
 * ★목록을 여기 배열로 적지 않는다. 입력은 전부 **`models:quickLaneCatalog` IPC**
 * (= `electron/model-registry.ts` 파생)와 기존 `cliSetupStore.ROWS` 다. 레지스트리에
 * 벤더 행이 늘면 카드가 자동으로 늘고, 이 파일은 한 줄도 안 바뀐다. 그래서 여기엔
 * 벤더 id·모델 id 리터럴이 **하나도 없다**(유닛테스트가 그 불변식을 강제한다).
 *
 * ── 세 갈래 분류(이름이 아니라 데이터로) ─────────────────────────────────
 *   orchestratorCli — 이미 ①설치/②로그인 단계가 다루는 CLI(=오케 후보 행).
 *                     여기서 또 그리면 같은 일을 두 번 시키는 화면이 된다.
 *   nativeCli       — 자기 CLI 를 갖고 **브라우저 인증**으로 붙는 벤더. 판별식은
 *                     "필요 env 키가 없다 + `ROWS` 에 그 CLI 행이 있다"(Grok).
 *   envSwap         — 우리 `claude` 바이너리에 env 만 갈아끼우는 벤더. 판별식은
 *                     **`requiredEnvKeys.length > 0`** 하나뿐이다(GLM/MiniMax/Kimi).
 *
 * ── 크레덴셜 판정의 출처 ─────────────────────────────────────────────────
 * 카탈로그의 `available` 은 `process.env` 만 본다. #624 이후 키는 **OS 키체인**에도
 * 저장되고 스폰은 `process.env[key] || 키체인` 순으로 읽으므로, 키체인에만 넣은
 * 사용자가 카탈로그만 보면 "미설정" 으로 보인다. 그래서 벤더 시크릿 스냅샷
 * (`settings.getVendorSecrets` — 값이 아니라 **키 이름과 존재 여부**만 온다)이 있으면
 * 그쪽을 우선한다. 스냅샷이 없으면(웹 프리뷰·구버전 브리지) 카탈로그로 떨어진다.
 */

/** 카탈로그 그룹에서 이 모듈이 실제로 읽는 필드만(전역 타입에 결합하지 않는다). */
export interface VendorCatalogGroupLike {
  vendor: string;
  label: string;
  harness: string;
  command: string;
  requiredEnvKeys: string[];
  missingEnvKeys: string[];
  available: boolean;
  models: Array<{ modelId: string }>;
}

/** `cliSetupStore.ROWS` 한 행(필요한 두 필드만). */
export interface CliRowLike {
  id: string;
  model: string;
}

/** `cliSetupStore.states[rowId]` 한 칸. */
export interface CliStateLike {
  installed: boolean;
  authenticated: boolean;
  checking?: boolean;
}

/** `settings.getVendorSecrets()` 스냅샷(값 없음 — 키 이름과 존재 여부뿐). */
export interface VendorSecretsLike {
  vendors: Array<{
    vendor: string;
    ready: boolean;
    keys?: Array<{ envKey: string; source: string }>;
  }>;
}

export type VendorSetupKind = "orchestratorCli" | "nativeCli" | "envSwap";

export type VendorSetupStatus =
  | "ready"
  | "needsInstall"
  | "needsLogin"
  | "needsKey"
  | "unknown";

export interface VendorSetupCard {
  vendor: string;
  label: string;
  harness: string;
  /** 스폰할 바이너리 이름(`agent doc.command`). CLI 벤더의 행 매칭 키이기도 하다. */
  command: string;
  kind: VendorSetupKind;
  status: VendorSetupStatus;
  requiredEnvKeys: string[];
  /** 아직 비어 있는 키 이름들(값 아님). 스냅샷이 있으면 그 판정이 이긴다. */
  missingEnvKeys: string[];
  /** 이 벤더의 활성 모델 id 들(능력등급 높음 → 낮음, 카탈로그 순서 그대로). */
  modelIds: string[];
  /** dispatch 예시에 처음 채울 모델 = 이 벤더의 최상위 등급 모델. */
  exampleModelId: string;
  /** CLI 벤더일 때 대응하는 `ROWS` 행 id(설치/로그인 UI 재사용용). */
  cliRowId: string | null;
}

export interface VendorSetupInput {
  /** `cliSetupStore.ROWS`. */
  cliRows: CliRowLike[];
  /** `cliSetupStore.ORCHESTRATOR_CLI_IDS` — ①②단계가 이미 다루는 행들. */
  orchestratorRowIds: string[];
  /** `cliSetupStore.states` — row id → 프로브 결과. */
  cliStates: Record<string, CliStateLike | undefined>;
  /** 벤더 시크릿 스냅샷(없으면 카탈로그 `available` 로 판정). */
  vendorSecrets?: VendorSecretsLike | null;
}

/**
 * 이 그룹에 대응하는 CLI 행. `command` 로 먼저 맞추고(`gpt` 하네스 → `codex`
 * 바이너리처럼 이름이 갈리는 축이 command 쪽이라), 안 맞으면 하네스 이름으로
 * 한 번 더 본다(`antigravity` 하네스 ↔ `agy` 바이너리처럼 반대로 갈리는 행).
 */
function matchCliRow(
  group: VendorCatalogGroupLike,
  rows: CliRowLike[],
): CliRowLike | undefined {
  return (
    rows.find((r) => r.model === group.command) ??
    rows.find((r) => r.model === group.harness)
  );
}

function cliStatus(state: CliStateLike | undefined): VendorSetupStatus {
  // 프로브 전/진행 중에는 단정하지 않는다 — "미설치" 로 잘못 단정하면 이미 깔린
  // CLI 를 다시 깔라고 시키는 화면이 된다.
  if (!state || state.checking) return "unknown";
  if (!state.installed) return "needsInstall";
  if (!state.authenticated) return "needsLogin";
  return "ready";
}

/**
 * 카탈로그(레지스트리 파생) → 시작하기 탭 카드들. 순서는 카탈로그 순서를 그대로
 * 보존한다(네이티브 벤더 먼저 → env-swap 벤더).
 */
export function vendorSetupCards(
  groups: VendorCatalogGroupLike[],
  input: VendorSetupInput,
): VendorSetupCard[] {
  const { cliRows, orchestratorRowIds, cliStates, vendorSecrets } = input;

  return groups.map((group) => {
    const row = matchCliRow(group, cliRows);
    const needsKey = group.requiredEnvKeys.length > 0;

    const kind: VendorSetupKind = needsKey
      ? "envSwap"
      : row && orchestratorRowIds.includes(row.id)
        ? "orchestratorCli"
        : "nativeCli";

    const secret = vendorSecrets?.vendors.find(
      (v) => v.vendor === group.vendor,
    );
    // 스냅샷이 있으면 그것이 진실이다(process.env + 키체인 양쪽을 본 판정).
    const missingEnvKeys = secret
      ? (secret.keys ?? [])
          .filter((k) => k.source === "none")
          .map((k) => k.envKey)
      : group.missingEnvKeys;
    const keyReady = secret ? secret.ready : group.available;

    const status: VendorSetupStatus = needsKey
      ? keyReady
        ? "ready"
        : "needsKey"
      : cliStatus(row ? cliStates[row.id] : undefined);

    const modelIds = group.models.map((m) => m.modelId);

    return {
      vendor: group.vendor,
      label: group.label,
      harness: group.harness,
      command: group.command,
      kind,
      status,
      requiredEnvKeys: [...group.requiredEnvKeys],
      missingEnvKeys,
      modelIds,
      exampleModelId: modelIds[0] ?? "",
      cliRowId: kind === "envSwap" ? null : (row?.id ?? null),
    };
  });
}

/**
 * 시작하기 탭이 **실제로 그리는** 카드들 — ①②단계가 이미 다루는 오케 CLI 는 빼고,
 * 모델 행이 하나도 없는 벤더도 뺀다(고를 것이 없는 카드는 안내가 아니라 소음이다).
 */
export function additionalVendorCards(
  cards: VendorSetupCard[],
): VendorSetupCard[] {
  return cards.filter(
    (c) => c.kind !== "orchestratorCli" && c.modelIds.length > 0,
  );
}

/** 헤더에 접어 보여줄 요약(= 지금 바로 쓸 수 있는 벤더 수). */
export function vendorReadyCount(cards: VendorSetupCard[]): number {
  return cards.filter((c) => c.status === "ready").length;
}
