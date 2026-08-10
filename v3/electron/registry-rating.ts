/**
 * 스토어 별점(★1~5) — 레지스트리 항목의 **객관 신호**만으로 산출한다.
 *
 * ── 왜 이런 게 필요한가 ─────────────────────────────────────────────
 * 레지스트리는 173개 항목을 인덱스 순서(디렉터리 알파벳)로 뱉는다. 그 순서엔
 * 정보가 0 이라, 사용자는 "airtable-mcp" 가 "figma-mcp" 보다 먼저 뜬 이유를
 * 영원히 알 수 없다. 별점은 그 순서에 **방어 가능한** 근거를 준다.
 *
 * ── 무엇을 안 하는가(설계상의 금지) ─────────────────────────────────
 *  1. **임의 별점 금지.** 사람이 손으로 매기는 큐레이션 점수는 없다. 모든 별은
 *     아래 네 성분의 가중합에서 나오고, 각 별에는 산출 근거(reasons)가 붙어
 *     UI 가 그대로 보여준다.
 *  2. **사용자 조작 불가.** 산출은 메인 프로세스에서만 한다 — 렌더러는 이미
 *     계산된 값을 표시·정렬만 하고, 점수를 만들 수단이 없다. 렌더러가 보내는
 *     어떤 IPC 도 점수에 영향을 주지 못한다.
 *  3. **런타임 GitHub API 금지.** 유용성 신호(업스트림 스타)는 빌드 타임
 *     스냅샷(`data/registry-stars-snapshot.ts`)에서만 읽는다. 스토어를 여는
 *     것으로 150+ 레포를 조회하면 레이트리밋에 즉사하고 사용자 IP 로 나간다.
 *  4. **벽시계 금지.** 신선도는 스냅샷의 `collectedAt` 을 기준 시계로 쓴다.
 *     `Date.now()` 를 쓰면 같은 데이터가 날마다 다른 별점을 내서 "왜 어제와
 *     다르지"에 답할 수 없고 테스트도 못 한다.
 *
 * ── 산식 (자세한 설명: v3/docs/store-rating.md) ─────────────────────
 *   score = 0.50·유용성 + 0.30·인증 + 0.10·라이선스 + 0.10·신선도   (각 0~1)
 * 데이터가 없어 **측정 불가**한 성분은 0 으로 깎지 않고 목록에서 빼고 남은
 * 가중치를 재정규화한다(모르는 것과 나쁜 것은 다르다). 다만 "측정할 수단이
 * 있는데 값이 없는" 경우(업스트림 레포는 선언됐는데 스냅샷에 없음)는 0 이다 —
 * 그렇지 않으면 신호를 지우는 게 이득이 되는 역인센티브가 생긴다.
 *
 * 그리고 상한(cap)이 별도로 있다. 가중합이 아무리 높아도 넘을 수 없는 선이다:
 *   revoked → ★1 고정 / 비OSI → ★2 / deprecated → ★3 /
 *   출처 미검증(허용 호스트·불변 핀 중 하나라도 실패) → ★4 / 유용성 측정불가 → ★4.
 * ★5 는 "업스트림에서 실제로 검증된 수요 + 출처 검증 통과"에만 남긴다.
 */
import {
  isPinnedSourceRef,
  isSafeSourcePath,
  parseGitHubSourceRepository,
  type RegistryInstall,
  type RegistryItemStatus,
} from "./registry-client";
import {
  REGISTRY_STARS_SNAPSHOT,
  type RegistryStarsSnapshot,
} from "./data/registry-stars-snapshot";

/** 산식이 바뀌면 올린다 — UI 툴팁이 "어느 산식으로 매긴 별인지" 밝힐 수 있게. */
export const RATING_FORMULA_VERSION = 1;

export const RATING_WEIGHTS = {
  usefulness: 0.5,
  verification: 0.3,
  license: 0.1,
  freshness: 0.1,
} as const;

export type RatingComponentKey = keyof typeof RATING_WEIGHTS;

/**
 * 유용성 만점 기준. `log10(1+stars)/5` 이므로 **스타가 10배 늘 때마다 0.2**,
 * 즉 별 한 칸에 해당하는 양이 붙는다: 10★→0.2, 100→0.4, 1k→0.6, 10k→0.8,
 * 100k→1.0. 선형이 아니라 로그인 이유는 상위 몇 개(26만 스타)가 나머지 전부를
 * 0 으로 만들어버리기 때문이다.
 */
const STARS_LOG_DIVISOR = 5;

/** 신선도 감점이 시작되는 지점과 0 이 되는 지점(업스트림 마지막 push 기준). */
const FRESH_GRACE_DAYS = 30;
const FRESH_ZERO_DAYS = 730;
const DAY_MS = 24 * 60 * 60 * 1000;

export type StarCount = 1 | 2 | 3 | 4 | 5;

/**
 * ★ 구간을 **스타 수로** 정의한다: "전 검증을 통과한 항목이 이만큼의 업스트림
 * 스타를 가졌을 때 받는 별". 점수 경계(0.97…)를 손으로 적는 대신 이 앵커에서
 * 계산하는 이유는 두 가지다 — (1) 가중치를 바꾸면 경계가 따라 움직여야 하는데
 * 상수로 박아 두면 조용히 어긋난다, (2) 사용자에게 설명할 수 있는 단위가
 * 점수가 아니라 스타다("★5 는 5만 스타부터").
 *
 * 이 값들은 실제 레지스트리(146개 항목) 분포에 맞춘 것이다. 이 카탈로그는
 * 중앙값이 2만 스타를 넘는 인기 레포 편중이 심해서, 흔한 기준(1만=만점)으로
 * 자르면 카탈로그의 44%가 ★5 가 되어 별점이 아무것도 구분하지 못한다.
 * 현재 앵커에서의 분포는 대략 ★5 12% / ★4 38% / ★3 19% / ★2 28% / ★1 3%.
 */
const FULLY_VERIFIED_STAR_ANCHORS: Array<{
  stars: StarCount;
  upstreamStars: number;
}> = [
  { stars: 5, upstreamStars: 50_000 },
  { stars: 4, upstreamStars: 10_000 },
  { stars: 3, upstreamStars: 1_000 },
  { stars: 2, upstreamStars: 10 },
];

/**
 * OSI 승인 라이선스(레지스트리 정책은 OSI-only). 여기 없는 값은 "미인식"이지
 * 자동으로 비OSI 가 아니다 — 미인식은 감점, 비OSI 는 상한이라 취급이 다르다.
 */
const OSI_LICENSES = new Set([
  "MIT",
  "MIT-0",
  "APACHE-2.0",
  "BSD-2-CLAUSE",
  "BSD-3-CLAUSE",
  "BSD-3-CLAUSE-CLEAR",
  "ISC",
  "MPL-2.0",
  "GPL-2.0",
  "GPL-2.0-ONLY",
  "GPL-2.0-OR-LATER",
  "GPL-3.0",
  "GPL-3.0-ONLY",
  "GPL-3.0-OR-LATER",
  "LGPL-2.1",
  "LGPL-2.1-ONLY",
  "LGPL-2.1-OR-LATER",
  "LGPL-3.0",
  "LGPL-3.0-ONLY",
  "LGPL-3.0-OR-LATER",
  "AGPL-3.0",
  "AGPL-3.0-ONLY",
  "AGPL-3.0-OR-LATER",
  "EPL-2.0",
  "EUPL-1.2",
  "ARTISTIC-2.0",
  "ZLIB",
  "UNLICENSE",
  "0BSD",
  "BSL-1.0",
  "POSTGRESQL",
  "PYTHON-2.0",
]);

/**
 * OSI 승인은 아니지만 **퍼블릭 도메인 헌정**이라 OSI 라이선스보다 제약이 적은
 * 것들. 정책의 취지(자유롭게 쓸 수 있는가)로 보면 감점 대상이 아니다.
 */
const PUBLIC_DOMAIN_LICENSES = new Set(["CC0-1.0", "CC-PDDC", "WTFPL"]);

/**
 * source-available/비상업 — 레지스트리 OSI-only 정책의 **명시적 위반**이다.
 * 감점이 아니라 상한(★2)으로 처리한다: 인기 있고 잘 핀 걸려 있어도 정책상
 * 올라와선 안 되는 것이 별 다섯 개로 추천되면 안 된다.
 */
const NON_OSI_LICENSES = new Set([
  "BUSL-1.1",
  "SSPL-1.0",
  "ELASTIC-2.0",
  "COMMONS-CLAUSE",
  "PROPRIETARY",
  "UNLICENSED",
  "NONE",
  "LICENSEREF-PROPRIETARY",
]);

/** 접두사로만 알 수 있는 비OSI 계열(FSL/PolyForm/CC 의 NC·ND 변종). */
const NON_OSI_PREFIXES = [
  "FSL-",
  "POLYFORM-",
  "CC-BY-NC",
  "CC-BY-ND",
  "CC-BY-SA-NC",
];

/** npm/PyPI exact pin — `pkg@1.2.3`. 범위(^,~,latest)는 "내일 다른 바이트"다. */
const EXACT_PACKAGE_PIN_RE = /@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export type RatingReasonCode =
  | "stars"
  | "starsMissing"
  | "usefulnessUnmeasurable"
  | "verifiedPin"
  | "unpinnedSource"
  | "hostRejected"
  | "verifiedIntegrity"
  | "integrityNotApplicable"
  | "noIntegrity"
  | "licenseOsi"
  | "licensePublicDomain"
  | "licenseNonOsi"
  | "licenseUnrecognized"
  | "licenseUndeclared"
  | "freshPin"
  | "freshUpstream"
  | "staleUpstream"
  | "archivedUpstream"
  | "freshnessUnknown"
  | "capRevoked"
  | "capDeprecated"
  | "capUnverifiedSource";

/** 별점의 근거 한 줄. 표시 문자열은 렌더러가 code 로 i18n 조회해 만든다. */
export interface RegistryRatingReason {
  code: RatingReasonCode;
  params?: Record<string, string | number>;
}

export interface RegistryRatingComponent {
  key: RatingComponentKey;
  /** 0~1. null = 측정 불가 → 가중치에서 제외되고 나머지가 재정규화된다. */
  value: number | null;
  /** 이 항목에 **실제로 적용된** 가중치(재정규화 후). 제외된 성분은 0. */
  weight: number;
}

export interface RegistryRating {
  stars: StarCount;
  /** 상한 적용 전 원점수 0~1(소수 3자리) — 같은 ★ 안의 정렬 키. */
  score: number;
  formulaVersion: number;
  /** 업스트림 스타 수. null = 측정 대상 아님(외부 소스 없음) 또는 미수집. */
  upstreamStars: number | null;
  components: RegistryRatingComponent[];
  reasons: RegistryRatingReason[];
  /** 스타 스냅샷 수집 시각(ISO) — "언제 기준 별점인지" 공시용. */
  snapshotAt: string;
  /** 상한이 걸렸으면 그 이유(별이 점수보다 낮은 이유). */
  cap?:
    | "revoked"
    | "nonOsi"
    | "deprecated"
    | "unverifiedSource"
    | "usefulnessUnmeasurable";
}

/** 별점 산출에 필요한 항목 필드 — RegistryItem 의 부분집합. */
export interface RatingInput {
  sourceRepository?: string;
  sourceRef?: string;
  sourcePath?: string;
  license?: string;
  status: RegistryItemStatus;
  install: RegistryInstall | null;
  installDerived: boolean;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * 유용성 = 업스트림 GitHub 스타의 로그 스케일.
 *
 * 스타를 쓰는 이유는 그것이 완벽해서가 아니라, 이 카탈로그에서 **모든 항목에
 * 대해 같은 방식으로 구할 수 있는 유일한 수요 신호**이기 때문이다. 다운로드
 * 수는 레지스트리가 모르고, 우리 설치 수는 신제품이라 표본이 없으며(그리고
 * 자기 강화 루프가 된다), 별점을 사람이 매기면 그 순간 임의 큐레이션이 된다.
 */
export function usefulnessFromStars(stars: number): number {
  if (!Number.isFinite(stars) || stars <= 0) return 0;
  return clamp01(Math.log10(1 + stars) / STARS_LOG_DIVISOR);
}

/** 스타는 **설치 바이트가 실제로 오는 레포**에서만 센다(homepage 는 안 본다). */
function upstreamKey(item: RatingInput): string | null {
  const parsed = parseGitHubSourceRepository(item.sourceRepository);
  return parsed ? `${parsed.owner}/${parsed.repo}` : null;
}

/**
 * 인증 = 이 앱이 설치 직전에 실제로 강제하는 세 가지 검사를 그대로 점수화한 것
 * (community_source_fetch 계약: host allowlist · pinned ref · integrity).
 * 별점이 보안 검사와 **같은 규칙**을 쓰는 게 요점이다 — 서로 다른 기준이면
 * "별 다섯인데 설치는 거부됨" 같은 모순이 생긴다.
 */
function verificationScore(item: RatingInput): {
  value: number;
  /** 호스트 allowlist + 불변 핀을 **둘 다** 통과했는가(★5 의 전제 조건). */
  provenanceVerified: boolean;
  reasons: RegistryRatingReason[];
} {
  const reasons: RegistryRatingReason[] = [];
  const hasExternalSource =
    typeof item.sourceRepository === "string" && item.sourceRepository !== "";

  // (1) 호스트 allowlist. 외부 소스가 없으면 페이로드는 레지스트리 레포 자체에
  //     있다 — 그건 우리가 리뷰하는 저장소라 allowlist 를 정의상 통과한다.
  const host = hasExternalSource
    ? parseGitHubSourceRepository(item.sourceRepository) !== null &&
      isSafeSourcePath(item.sourcePath)
      ? 1
      : 0
    : 1;
  if (host === 0) reasons.push({ code: "hostRejected" });

  // (2) 불변 핀. 외부 소스는 40-hex SHA 또는 버전 태그여야 한다. 레지스트리
  //     내부 항목은 인덱스가 읽은 커밋 자체가 핀이다(항상 40-hex).
  const pin = hasExternalSource
    ? isPinnedSourceRef(item.sourceRef)
      ? 1
      : 0
    : 1;
  if (pin === 0) reasons.push({ code: "unpinnedSource" });
  if (host === 1 && pin === 1) reasons.push({ code: "verifiedPin" });

  // (3) 무결성 — "디스크에 닿는 바이트가 무엇에 대조되는가".
  //     ★설치 계약이 아예 없는 항목(v1 mcp-server 등)에서는 이 질문이 **성립하지
  //     않는다**: 앱이 그 항목으로 파일을 쓰지 않는다(스토어는 링크만 준다).
  //     측정 불가를 0 으로 깎으면, 우리가 설치하지도 않는 항목이 "무결성 실패"로
  //     강등돼 스타 1.5만짜리 MCP 가 검증만 된 무명 항목보다 아래로 간다. 그래서
  //     여기서도 산식의 원칙을 따른다 — **모르는 것은 빼고, 나머지로 평균낸다**.
  let integrity: number | null;
  if (item.install?.kind === "files") {
    const digests = item.install.integrity;
    // 트리 파생 설치는 핀 커밋 자체가 앵커라 다이제스트 없이도 대조가 성립한다.
    integrity =
      digests && item.install.files.every((f) => digests[f])
        ? 1
        : item.installDerived
          ? 1
          : 0;
  } else if (item.install?.kind === "mcp-server") {
    integrity = EXACT_PACKAGE_PIN_RE.test(item.install.package) ? 1 : 0;
  } else {
    integrity = null;
  }
  reasons.push({
    code:
      integrity === null
        ? "integrityNotApplicable"
        : integrity === 1
          ? "verifiedIntegrity"
          : "noIntegrity",
  });

  const checks = integrity === null ? [host, pin] : [host, pin, integrity];
  return {
    value: checks.reduce((a, b) => a + b, 0) / checks.length,
    provenanceVerified: host === 1 && pin === 1,
    reasons,
  };
}

function normalizeLicense(license?: string): string | null {
  const raw = license?.trim();
  return raw ? raw.toUpperCase() : null;
}

export function isOsiApprovedLicense(license?: string): boolean {
  const norm = normalizeLicense(license);
  return !!norm && (OSI_LICENSES.has(norm) || PUBLIC_DOMAIN_LICENSES.has(norm));
}

export function isKnownNonOsiLicense(license?: string): boolean {
  const norm = normalizeLicense(license);
  if (!norm) return false;
  return (
    NON_OSI_LICENSES.has(norm) ||
    NON_OSI_PREFIXES.some((prefix) => norm.startsWith(prefix))
  );
}

/**
 * 라이선스 성분. 미신고·미인식(0.35)과 **알려진 비OSI**(0 + ★2 상한)를 가른다 —
 * 모르는 것을 정책 위반과 같이 취급하면, 라이선스 칸을 비우는 게 이득이 된다.
 */
function licenseScore(item: RatingInput): {
  value: number;
  reasons: RegistryRatingReason[];
  nonOsi: boolean;
} {
  const norm = normalizeLicense(item.license);
  if (!norm) {
    return {
      value: 0.35,
      reasons: [{ code: "licenseUndeclared" }],
      nonOsi: false,
    };
  }
  if (isKnownNonOsiLicense(item.license)) {
    return {
      value: 0,
      reasons: [{ code: "licenseNonOsi", params: { license: item.license! } }],
      nonOsi: true,
    };
  }
  if (PUBLIC_DOMAIN_LICENSES.has(norm)) {
    return {
      value: 1,
      reasons: [
        { code: "licensePublicDomain", params: { license: item.license! } },
      ],
      nonOsi: false,
    };
  }
  if (OSI_LICENSES.has(norm)) {
    return {
      value: 1,
      reasons: [{ code: "licenseOsi", params: { license: item.license! } }],
      nonOsi: false,
    };
  }
  return {
    value: 0.35,
    reasons: [
      { code: "licenseUnrecognized", params: { license: item.license! } },
    ],
    nonOsi: false,
  };
}

/**
 * 신선도 = "이 핀이 아직 살아 있는 코드를 가리키는가".
 * 핀이 업스트림 HEAD 와 같으면 최신(1.0). 아니면 업스트림의 마지막 push 로부터
 * 얼마나 지났는지로 본다 — 30일까지는 만점, 2년이면 0. 아카이브된 레포는 0 이다.
 */
function freshnessScore(
  item: RatingInput,
  upstream: RegistryStarsSnapshot["repos"][string] | undefined,
  collectedAtMs: number,
): { value: number | null; reasons: RegistryRatingReason[] } {
  if (!upstream) {
    return { value: null, reasons: [{ code: "freshnessUnknown" }] };
  }
  if (upstream.archived) {
    return { value: 0, reasons: [{ code: "archivedUpstream" }] };
  }
  if (
    upstream.headSha &&
    item.sourceRef &&
    item.sourceRef.toLowerCase() === upstream.headSha.toLowerCase()
  ) {
    return { value: 1, reasons: [{ code: "freshPin" }] };
  }
  const pushedAtMs = upstream.pushedAt ? Date.parse(upstream.pushedAt) : NaN;
  if (!Number.isFinite(pushedAtMs)) {
    return { value: null, reasons: [{ code: "freshnessUnknown" }] };
  }
  const days = Math.max(0, Math.round((collectedAtMs - pushedAtMs) / DAY_MS));
  const value = clamp01(
    1 - (days - FRESH_GRACE_DAYS) / (FRESH_ZERO_DAYS - FRESH_GRACE_DAYS),
  );
  return {
    value,
    reasons: [
      value >= 1
        ? { code: "freshUpstream", params: { days } }
        : { code: "staleUpstream", params: { days } },
    ],
  };
}

/**
 * 앵커(스타 수) → 점수 경계. "인증·라이선스·신선도가 전부 만점인 항목"을
 * 기준으로 잡으므로, 그 셋 중 하나라도 깎인 항목은 같은 스타로도 한 칸 아래에
 * 앉는다 — 그게 "유용하고 **인증받은** 것이 위로" 의 정확한 의미다.
 */
const STAR_THRESHOLDS: Array<{ min: number; stars: StarCount }> =
  FULLY_VERIFIED_STAR_ANCHORS.map(({ stars, upstreamStars }) => ({
    stars,
    min:
      RATING_WEIGHTS.usefulness * usefulnessFromStars(upstreamStars) +
      (1 - RATING_WEIGHTS.usefulness),
  }));

function starsFromScore(score: number): StarCount {
  for (const { min, stars } of STAR_THRESHOLDS) {
    if (score >= min) return stars;
  }
  return 1;
}

/**
 * 한 항목의 별점. 순수 함수다 — 같은 입력 + 같은 스냅샷이면 언제 호출해도
 * 같은 값이 나온다(벽시계·네트워크·디스크를 읽지 않는다).
 */
export function computeRegistryRating(
  item: RatingInput,
  snapshot: RegistryStarsSnapshot = REGISTRY_STARS_SNAPSHOT,
): RegistryRating {
  const key = upstreamKey(item);
  const upstream = key ? snapshot.repos[key] : undefined;
  const collectedAtMs = Date.parse(snapshot.collectedAt);
  const reasons: RegistryRatingReason[] = [];

  // ── 유용성 ────────────────────────────────────────────────────────
  let usefulness: number | null;
  let upstreamStars: number | null = null;
  let usefulnessUnmeasurable = false;
  if (!key) {
    // 외부 업스트림 자체가 없다(레지스트리 안에 페이로드가 있는 first-party
    // 항목). 스타로 잴 대상이 없으니 0 점이 아니라 **제외**하고, 대신 ★5 는
    // 주지 않는다 — ★5 의 의미는 "업스트림에서 실증된 수요"이기 때문이다.
    usefulness = null;
    usefulnessUnmeasurable = true;
    reasons.push({ code: "usefulnessUnmeasurable" });
  } else if (!upstream) {
    // 잴 대상은 선언됐는데 스냅샷에 없다(삭제·비공개·수집 실패). 여기서
    // 제외해 주면 "레포를 감추면 감점을 피한다"가 성립하므로 0 으로 둔다.
    usefulness = 0;
    reasons.push({ code: "starsMissing", params: { repo: key } });
  } else {
    upstreamStars = upstream.stars;
    usefulness = usefulnessFromStars(upstream.stars);
    reasons.push({ code: "stars", params: { stars: upstream.stars } });
  }

  const verification = verificationScore(item);
  reasons.push(...verification.reasons);
  const license = licenseScore(item);
  reasons.push(...license.reasons);
  const freshness = freshnessScore(item, upstream, collectedAtMs);
  reasons.push(...freshness.reasons);

  // ── 가중합 (측정 불가 성분은 빼고 재정규화) ────────────────────────
  const raw: Array<{ key: RatingComponentKey; value: number | null }> = [
    { key: "usefulness", value: usefulness },
    { key: "verification", value: verification.value },
    { key: "license", value: license.value },
    { key: "freshness", value: freshness.value },
  ];
  const measured = raw.filter((c) => c.value !== null);
  const totalWeight = measured.reduce(
    (sum, c) => sum + RATING_WEIGHTS[c.key],
    0,
  );
  const components: RegistryRatingComponent[] = raw.map((c) => ({
    key: c.key,
    value: c.value,
    weight:
      c.value === null || totalWeight === 0
        ? 0
        : RATING_WEIGHTS[c.key] / totalWeight,
  }));
  const score = components.reduce(
    (sum, c) => sum + (c.value ?? 0) * c.weight,
    0,
  );
  const rounded = Math.round(clamp01(score) * 1000) / 1000;

  // ── 상한 ──────────────────────────────────────────────────────────
  let stars = starsFromScore(rounded);
  let cap: RegistryRating["cap"];
  if (item.status === "revoked") {
    // 회수는 "쓰지 말라"는 신호다. 점수가 무엇이든 최하점으로 내려 목록 맨
    // 아래에 둔다(숨기지는 않는다 — 이미 설치한 사용자가 찾을 수 있어야 한다).
    stars = 1;
    cap = "revoked";
    reasons.push({ code: "capRevoked" });
  } else {
    if (license.nonOsi && stars > 2) {
      stars = 2;
      cap = "nonOsi";
    }
    // ★출처를 검증할 수 없는 항목은 인기가 아무리 많아도 최고점을 못 받는다.
    // 이 두 검사(허용 호스트·불변 핀)는 installer 가 설치를 **거부**하는
    // 기준과 같다 — 같은 규칙을 쓰지 않으면 "별 다섯인데 설치는 거부됨"이
    // 생기고, 그 순간 별점은 안전과 무관한 인기 투표가 된다.
    if (!verification.provenanceVerified && stars > 4) {
      stars = 4;
      cap = cap ?? "unverifiedSource";
      reasons.push({ code: "capUnverifiedSource" });
    }
    if (item.status === "deprecated" && stars > 3) {
      stars = 3;
      cap = cap ?? "deprecated";
      reasons.push({ code: "capDeprecated" });
    }
    if (usefulnessUnmeasurable && stars > 4) {
      stars = 4;
      cap = cap ?? "usefulnessUnmeasurable";
    }
  }

  return {
    stars,
    score: rounded,
    formulaVersion: RATING_FORMULA_VERSION,
    upstreamStars,
    components,
    reasons,
    snapshotAt: snapshot.collectedAt,
    cap,
  };
}

/** 인덱스 전체에 별점을 붙인다(원본 불변 — 새 객체를 만든다). */
export function rateRegistryItems<T extends RatingInput>(
  items: T[],
  snapshot: RegistryStarsSnapshot = REGISTRY_STARS_SNAPSHOT,
): Array<T & { rating: RegistryRating }> {
  return items.map((item) => ({
    ...item,
    rating: computeRegistryRating(item, snapshot),
  }));
}
