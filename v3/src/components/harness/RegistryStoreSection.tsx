import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useTranslation,
  t as translate,
  type Locale,
  type TFunction,
} from "../../lib/i18n";
import { LocalModelsSection } from "../store/LocalModelsSection";

/**
 * **공개 레지스트리 스토어** 섹션 (marblo-app/marblo). 최상위 스토어 탭
 * (`components/store/StoreTab`)이 이것을 통째로 렌더한다.
 *
 * `EnvSwapVendorSection` 과 같은 "레지스트리 파생 섹션" 패턴이다 — 내장
 * 카탈로그 격자(HarnessPackage)와 데이터 소스·IPC 채널·설치 경로를 전혀
 * 공유하지 않는다(설계 §4.4: untrusted 입력은 내장 카탈로그와 같은 경로를
 * 타면 안 된다).
 *
 * 표시 원칙:
 *  - tier·permissions 는 **공시**다. UI 카피가 "강제 아님"을 명시한다(§4.6).
 *  - 목록은 상단 카테고리 탭(전체·MCP·스킬·에이전트·워크플로·스터디)으로
 *    브라우징한다 — 활성 카테고리의 그리드만 그린다.
 *  - ★community tier 는 보이고, 설치 계약이 있으면 설치 버튼도 달린다 — 단
 *    반드시 미검수 경고 모달(출처 신뢰 체크박스)을 지나야 하고, 동의 플래그
 *    (`acknowledgeUnreviewed`)의 **강제는 메인 프로세스 installer 가 한다**.
 *    이 UI 는 동의를 수집할 뿐 보안 경계가 아니다(§6.3) — 목록 표시 정책과
 *    설치 게이트는 계속 분리돼 있고, 표시를 열어도 차단은 main 이 유지한다.
 *  - install 계약이 없는 항목(v1 mcp-server 등)은 "자동 설치 불가"로 정직하게
 *    표시하고 홈페이지 링크만 준다 — 가짜 설치 버튼 금지. workflow/knowledge
 *    타입은 계약 자체가 없는 **참조 전용**이라 항상 링크만 준다.
 *  - 설치 전에는 항상 권한 공시 모달을 지난다. 고위험 스코프는 community
 *    항목에서만 경고로 강조하고, official/verified 는 정보성 공시로 표시한다.
 *  - 레지스트리 실패는 이 섹션 안에서만 표현된다(스토어 전체는 항상 열림).
 */

interface RegistryStoreSectionProps {
  /** "skill" | "mcp-server" | undefined(전 타입). 스토어 탭은 필터를 주지 않는다. */
  typeFilter?: "skill" | "mcp-server";
}

const HIGH_RISK_RE = /^(shell:exec|secrets:read|repository:write)/;

/**
 * 권한 문자열은 모든 tier 에서 그대로 공시한다. 다만 이 스코프가 위험 경고로
 * 읽혀야 하는 것은 미검수 community 항목뿐이다. 이 판정은 카드와 설치 전 공시
 * 모달이 공유해 두 표면의 위험 톤이 달라지지 않게 한다.
 */
export function isCommunityHighRiskPermission(
  item: Pick<RegistryStoreItem, "tier">,
  permission: string,
): boolean {
  return item.tier === "community" && HIGH_RISK_RE.test(permission);
}

/** 공개 레지스트리 저장소 — 전체 카탈로그의 정본. */
const REGISTRY_CATALOG_URL = "https://github.com/marblo-app/marblo";

// ── 카테고리 모델 ──────────────────────────────────────────────────

/**
 * 스토어 상단 탭의 카테고리. 레지스트리 타입과 1:1 이 아니라 **표시명 공간**이다
 * (knowledge→스터디 처럼 제품 라벨이 타입명과 다르다). "other" 는 우리 빌드가
 * 모르는 진짜 미지 타입만 담는다 — 알려진 타입을 여기로 흘리면 새 카테고리를
 * 추가할 때 조용히 '기타'로 새는 회귀를 못 잡는다.
 */
export type StoreCategoryKey =
  | "mcp"
  | "skills"
  | "agents"
  | "workflows"
  | "study"
  | "other";

const CATEGORY_FOR_TYPE: Record<string, StoreCategoryKey> = {
  "mcp-server": "mcp",
  skill: "skills",
  agent: "agents",
  workflow: "workflows",
  knowledge: "study",
};

export function categorizeRegistryType(type: string): StoreCategoryKey {
  return CATEGORY_FOR_TYPE[type] ?? "other";
}

/** 탭 표시 순서. "other" 는 해당 항목이 실제로 있을 때만 탭이 생긴다. */
const CATEGORY_ORDER: StoreCategoryKey[] = [
  "mcp",
  "skills",
  "agents",
  "workflows",
  "study",
  "other",
];

/**
 * 스토어 상단 탭의 전체 키 공간. `"localModels"` 는 레지스트리 파생 카테고리가
 * **아니라** first-party 탭이다(§4.4 신뢰경계) — 그래서 `StoreCategoryKey` 와
 * `categorizeRegistryType` 에는 절대 넣지 않는다. 레지스트리 타입이 이 탭으로
 * 매핑되는 순간 untrusted 항목이 first-party 원클릭 경로에 섞인다.
 */
export type StoreTabKey = StoreCategoryKey | "all" | "localModels";

/**
 * 설치 계약이 존재할 수 없는 참조 전용 타입 — 카드에 설치 버튼 대신 링크만
 * 붙는다(가짜 설치 버튼 금지). 판정은 타입 기준이다: install 유무로만 가르면
 * 미래에 이 타입들이 계약을 싣기 시작했을 때 검토 없이 설치 버튼이 생긴다.
 */
export function isReferenceOnlyRegistryType(type: string): boolean {
  return type === "workflow" || type === "knowledge";
}

const TIER_RANK: Record<RegistryStoreItem["tier"], number> = {
  official: 0,
  verified: 1,
  community: 2,
};

/**
 * 기본 정렬 = **별점 내림차순**. "유용하고 인증받은 것이 위로" 를 순서로
 * 구현한 것이다(별점 산식은 electron/registry-rating.ts, 설명은
 * v3/docs/store-rating.md).
 *
 * 동점 규칙(위에서부터 적용):
 *  1. ★ 내림차순
 *  2. 같은 ★ → 원점수(score) 내림차순 — ★는 구간이라, 같은 칸 안에서도 근거가
 *     더 센 쪽이 위여야 4.9와 4.1이 뒤섞이지 않는다.
 *  3. 같은 점수 → 업스트림 스타 내림차순(측정 불가는 뒤로)
 *  4. 그래도 같으면 → tier(공식→검증됨→커뮤니티)
 *  5. 전부 같으면 → 0 을 반환해 **레지스트리 인덱스 순서**를 유지한다.
 *     Array.sort 가 안정 정렬이므로 이 카탈로그는 새로고침해도 순서가
 *     흔들리지 않는다(같은 화면이 매번 다르게 보이면 별점을 못 믿는다).
 *
 * 별점이 없는 항목(rating undefined — 별점 이전 메인 프로세스)은 0★로 취급해
 * 뒤로 가되, 그 경우 전 항목이 동률이라 4→5 규칙으로 기존 tier 순서가 그대로
 * 남는다. 즉 이 함수는 별점이 하나도 없어도 예전과 같은 화면을 만든다.
 */
export function compareByRating(
  a: Pick<RegistryStoreItem, "tier" | "rating">,
  b: Pick<RegistryStoreItem, "tier" | "rating">,
): number {
  const starsA = a.rating?.stars ?? 0;
  const starsB = b.rating?.stars ?? 0;
  if (starsA !== starsB) return starsB - starsA;
  const scoreA = a.rating?.score ?? 0;
  const scoreB = b.rating?.score ?? 0;
  if (scoreA !== scoreB) return scoreB - scoreA;
  const upA = a.rating?.upstreamStars ?? -1;
  const upB = b.rating?.upstreamStars ?? -1;
  if (upA !== upB) return upB - upA;
  return TIER_RANK[a.tier] - TIER_RANK[b.tier];
}

/**
 * 타입 필터를 지난 항목을 "화면에 그릴 목록"(별점 내림차순) 과 "그 중
 * community 개수" 로 가른다. 둘을 **같은 모집단**에서 뽑는 게 요점 — 카운트가
 * 화면의 필터와 어긋나면 "커뮤니티 N개" 가 거짓말이 된다.
 *
 * ★ community 는 `visible` 에 **들어간다**. 설치 차단은 여기가 아니라 카드의
 * 설치 판정 + 메인 프로세스 installer 가 한다 — 목록 정책과 설치 게이트를 같은
 * 곳에서 결정하면, 목록을 여는 변경이 조용히 설치까지 열어버린다.
 *
 * 정렬은 전 항목에 대해 한 번만 하고 카테고리 필터는 그 뒤에 건다 — 그래서
 * 카테고리 탭(MCP/스킬/에이전트)을 눌러도 각 탭 안이 같은 별점 내림차순으로
 * 남는다.
 */
export function rankRegistryItems(
  items: RegistryStoreItem[],
  typeFilter?: RegistryStoreSectionProps["typeFilter"],
): { visible: RegistryStoreItem[]; communityCount: number } {
  const scoped = items.filter((i) => !typeFilter || i.type === typeFilter);
  const visible = [...scoped].sort(compareByRating);
  return {
    visible,
    communityCount: scoped.filter((i) => i.tier === "community").length,
  };
}

/**
 * ★(a) 원클릭 설치 판정(§6.3). 동의 절차 없이 설치 버튼이 바로 설치로 이어지는
 * 것은 세 조건을 **모두** 만족할 때만이다:
 *  1. tier 가 official/verified — 리뷰를 통과한 페이로드,
 *  2. 설치 계약(`install`)이 실제로 있다 — 없으면 "자동 설치 불가"로 정직하게,
 *  3. 회수(revoked)되지 않았다.
 *
 * 목록 필터(`rankRegistryItems`)와 **일부러 분리**돼 있다 — 표시 정책이
 * 바뀌면 같이 사라지는 방어선은 방어선이 아니다. 그리고 이 함수 자체도 UI
 * 편의일 뿐, 실제 강제는 메인 프로세스 installer 가 같은 규칙으로 다시 한다.
 */
export function isRegistryItemInstallable(
  item: Pick<RegistryStoreItem, "tier" | "install" | "status">,
): boolean {
  return (
    (item.tier === "official" || item.tier === "verified") &&
    !!item.install &&
    item.status !== "revoked"
  );
}

/**
 * ★(b) community '동의 필요' 판정. 설치 계약이 있는 미검수 항목 — 설치 버튼은
 * 달리지만 반드시 경고 모달(출처 신뢰 체크)을 지나 `acknowledgeUnreviewed`
 * 플래그와 함께 요청된다. (a)와 상호 배타적이다: 같은 항목이 원클릭이면서
 * 동의 필요일 수 없다. revoked 는 동의로도 열리지 않는다(installer 도 거부).
 */
export function isRegistryItemConsentInstallable(
  item: Pick<RegistryStoreItem, "tier" | "install" | "status">,
): boolean {
  return (
    item.tier === "community" && !!item.install && item.status !== "revoked"
  );
}

/**
 * 표시용 이름·설명 — 앱 로케일에 맞는 오버레이가 **그 필드에** 있으면 그것을,
 * 없으면 영어 base 를 쓴다.
 *
 * 폴백이 필드 단위인 게 요점이다: 이름만 번역된 항목은 이름만 한국어로 나오고
 * 설명은 영어로 남는다. "둘 다 있어야 번역을 쓴다" 로 만들면 부분 번역이 통째로
 * 사라져서, 기여자가 정확히 옮길 수 있는 것만 옮기는 선택지가 없어진다.
 *
 * 영어는 오버레이가 아니라 base 자체다(공개 스키마의 i18n 키에 `en` 이 없다) —
 * 그래서 en 은 조회 없이 곧장 base 로 간다.
 */
export function localizedItemText(
  item: Pick<RegistryStoreItem, "name" | "description" | "i18n">,
  locale: Locale,
): { name: string; description: string } {
  const overlay = locale === "en" ? undefined : item.i18n?.[locale];
  return {
    name: overlay?.name ?? item.name,
    description: overlay?.description ?? item.description,
  };
}

function tierBadgeClass(tier: RegistryStoreItem["tier"]): string {
  switch (tier) {
    case "official":
      return "bg-[#89b4fa]/20 text-[#89b4fa]";
    case "verified":
      return "bg-[#a6e3a1]/20 text-[#a6e3a1]";
    default:
      return "bg-[#585b70]/30 text-[#a6adc8]";
  }
}

function tierLabel(tier: RegistryStoreItem["tier"]): string {
  return translate(
    `harness.store.registry.tier.${tier}` as Parameters<typeof translate>[0],
  );
}

function categoryLabel(key: StoreTabKey): string {
  const i18nKey =
    key === "all"
      ? "harness.store.registry.category.all"
      : key === "mcp"
        ? "harness.store.registry.mcp"
        : key === "skills"
          ? "harness.store.registry.skills"
          : key === "agents"
            ? "harness.store.registry.agents"
            : key === "workflows"
              ? "harness.store.registry.workflows"
              : key === "study"
                ? "harness.store.registry.study"
                : key === "localModels"
                  ? "harness.store.local.tab"
                  : "harness.store.registry.other";
  return translate(i18nKey as Parameters<typeof translate>[0]);
}

/** 경고 모달에 보여줄 출처 문자열 — 없으면 레지스트리 내 경로가 정직한 폴백. */
function communitySourceLabel(item: RegistryStoreItem): string {
  if (item.sourceRepository) {
    return item.sourceRef
      ? `${item.sourceRepository}@${item.sourceRef}`
      : item.sourceRepository;
  }
  return `${REGISTRY_CATALOG_URL.replace("https://github.com/", "")}/${
    item.path
  }`;
}

// ── 별점 표시 ──────────────────────────────────────────────────────
//
// 별점은 **메인 프로세스가 계산해서 내려준다**(electron/registry-rating.ts).
// 여기서 하는 일은 그리기와 근거 문장 조립뿐이다 — 렌더러에 점수를 만들거나
// 바꾸는 코드가 있으면 "유저 조작 불가" 가 성립하지 않는다.

/** 근거 코드 → i18n 키. 모르는 코드는 **버린다**(메인이 새 코드를 내보내도
 *  카드가 `harness.store...reason.foo` 같은 원문 키를 뱉지 않게). */
const RATING_REASON_KEYS: Record<string, string> = {
  stars: "harness.store.registry.rating.reason.stars",
  starsMissing: "harness.store.registry.rating.reason.starsMissing",
  usefulnessUnmeasurable:
    "harness.store.registry.rating.reason.usefulnessUnmeasurable",
  verifiedPin: "harness.store.registry.rating.reason.verifiedPin",
  unpinnedSource: "harness.store.registry.rating.reason.unpinnedSource",
  hostRejected: "harness.store.registry.rating.reason.hostRejected",
  verifiedIntegrity: "harness.store.registry.rating.reason.verifiedIntegrity",
  integrityNotApplicable:
    "harness.store.registry.rating.reason.integrityNotApplicable",
  noIntegrity: "harness.store.registry.rating.reason.noIntegrity",
  licenseOsi: "harness.store.registry.rating.reason.licenseOsi",
  licensePublicDomain:
    "harness.store.registry.rating.reason.licensePublicDomain",
  licenseNonOsi: "harness.store.registry.rating.reason.licenseNonOsi",
  licenseUnrecognized:
    "harness.store.registry.rating.reason.licenseUnrecognized",
  licenseUndeclared: "harness.store.registry.rating.reason.licenseUndeclared",
  freshPin: "harness.store.registry.rating.reason.freshPin",
  freshUpstream: "harness.store.registry.rating.reason.freshUpstream",
  staleUpstream: "harness.store.registry.rating.reason.staleUpstream",
  archivedUpstream: "harness.store.registry.rating.reason.archivedUpstream",
  freshnessUnknown: "harness.store.registry.rating.reason.freshnessUnknown",
  capRevoked: "harness.store.registry.rating.reason.capRevoked",
  capDeprecated: "harness.store.registry.rating.reason.capDeprecated",
  capUnverifiedSource:
    "harness.store.registry.rating.reason.capUnverifiedSource",
};

/**
 * 툴팁 본문 — "왜 이 별점인가" 를 한 카드 안에서 끝까지 읽을 수 있게 근거를
 * 전부 문장으로 편다. 점수 소수점을 같이 보여주는 이유는 같은 ★ 안의 정렬
 * 순서(동점 규칙 2)가 임의로 보이지 않게 하기 위해서다.
 */
export function ratingTooltip(
  rating: RegistryRating,
  translateFn: TFunction = translate,
): string {
  const head = translateFn("harness.store.registry.rating.title", {
    stars: rating.stars,
    score: rating.score.toFixed(2),
  });
  const lines = rating.reasons
    .map((reason) => {
      const key = RATING_REASON_KEYS[reason.code];
      if (!key) return null;
      return `· ${translateFn(key as Parameters<TFunction>[0], reason.params)}`;
    })
    .filter((line): line is string => line !== null);
  const foot = [
    translateFn("harness.store.registry.rating.formula"),
    translateFn("harness.store.registry.rating.snapshotAt", {
      date: rating.snapshotAt.slice(0, 10),
    }),
  ];
  return [head, ...lines, "", ...foot].join("\n");
}

function StarRating({ rating }: { rating: RegistryRating }) {
  const { t } = useTranslation();
  // 회수·비OSI 처럼 상한이 걸린 별은 색으로도 구분한다 — 별 개수만 보면
  // "낮은 별점"과 "정책상 올려선 안 되는 항목"이 같아 보인다.
  const capped = rating.cap === "revoked" || rating.cap === "nonOsi";
  return (
    <span
      className={`flex-shrink-0 font-mono text-[11px] leading-none tracking-tight ${
        capped ? "text-[#f38ba8]" : "text-[#f9e2af]"
      }`}
      title={ratingTooltip(rating)}
      aria-label={t("harness.store.registry.rating.aria", {
        stars: rating.stars,
      })}
    >
      {"★".repeat(rating.stars)}
      <span className="text-[#45475a]">{"☆".repeat(5 - rating.stars)}</span>
    </span>
  );
}

function PermissionBadges({ item }: { item: RegistryStoreItem }) {
  const { t } = useTranslation();
  if (!item.permissionsDeclared) {
    return (
      <span className="rounded bg-[#f9e2af]/15 px-1.5 py-0.5 text-[10px] text-[#f9e2af]">
        {t("harness.store.registry.permissionsUndeclared")}
      </span>
    );
  }
  if (item.permissions.length === 0) {
    return (
      <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#a6adc8]">
        {t("harness.store.registry.permissionsNone")}
      </span>
    );
  }
  return (
    <>
      {item.permissions.map((perm) => {
        const highRisk = isCommunityHighRiskPermission(item, perm);
        return (
          <span
            key={perm}
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
              highRisk
                ? "bg-[#f38ba8]/15 text-[#f38ba8]"
                : "bg-[#313244] text-[#a6adc8]"
            }`}
          >
            {highRisk
              ? `⚠ ${perm} (${t("harness.store.registry.highRisk")})`
              : perm}
          </span>
        );
      })}
    </>
  );
}

export function RegistryStoreSection({
  typeFilter,
}: RegistryStoreSectionProps) {
  const { t, locale } = useTranslation();
  const [items, setItems] = useState<RegistryStoreItem[]>([]);
  const [stale, setStale] = useState(false);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [category, setCategory] = useState<StoreTabKey>("all");
  const [ratingHelpOpen, setRatingHelpOpen] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "info" | "error";
    text: string;
  } | null>(null);
  const [disclosureFor, setDisclosureFor] = useState<RegistryStoreItem | null>(
    null,
  );
  // community 미검수 경고 모달 — 권한 공시 모달과 별개 상태다. 체크박스 동의는
  // 모달을 열 때마다 리셋된다(한 번의 동의가 다른 항목으로 이월되지 않게).
  const [consentFor, setConsentFor] = useState<RegistryStoreItem | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);

  const load = useCallback(async (refresh?: boolean) => {
    setLoading(true);
    try {
      const res = await window.electronAPI.registry.index(
        refresh ? { refresh: true } : undefined,
      );
      setItems(res.items ?? []);
      setStale(!!res.stale);
      setAvailable(res.available !== false);
    } catch {
      setAvailable(false);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { visible, communityCount } = useMemo(
    () => rankRegistryItems(items, typeFilter),
    [items, typeFilter],
  );
  const countByCategory = useMemo(() => {
    const counts = new Map<StoreCategoryKey, number>();
    for (const item of visible) {
      const key = categorizeRegistryType(item.type);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [visible]);
  // "other" 탭은 진짜 미지 타입이 실제로 왔을 때만 나타난다. 나머지 카테고리는
  // 비어 있어도 탭을 유지한다 — 탭이 사라졌다 생겼다 하면 카탈로그 구조를
  // 학습할 수 없다. '로컬 모델' 은 레지스트리 모집단과 무관한 first-party 탭이라
  // 항상 있고, '기타' 바로 앞에 선다(레지스트리 실패에도 이 탭은 살아 있다).
  const categoryTabs = useMemo(() => {
    const tabs: StoreTabKey[] = (
      ["all", ...CATEGORY_ORDER] as StoreTabKey[]
    ).filter(
      (key) => key !== "other" || (countByCategory.get("other") ?? 0) > 0,
    );
    const otherIdx = tabs.indexOf("other");
    if (otherIdx >= 0) tabs.splice(otherIdx, 0, "localModels");
    else tabs.push("localModels");
    return tabs;
  }, [countByCategory]);
  const shown = useMemo(
    () =>
      category === "all"
        ? visible
        : category === "localModels"
          ? [] // 로컬 모델 탭은 레지스트리 그리드를 그리지 않는다(§4.4 분리)
          : visible.filter((i) => categorizeRegistryType(i.type) === category),
    [visible, category],
  );

  const runInstall = useCallback(
    async (item: RegistryStoreItem, acknowledgeUnreviewed: boolean) => {
      setDisclosureFor(null);
      setConsentFor(null);
      setConsentChecked(false);
      setNotice(null);
      setBusy(item.id);
      try {
        // 이 플래그는 요청에 실릴 뿐이다 — community 를 실제로 거부/허용하는
        // 것은 메인 프로세스 registry-installer 의 tier 게이트다.
        const res = await window.electronAPI.registry.install({
          id: item.id,
          type: item.type,
          ...(acknowledgeUnreviewed ? { acknowledgeUnreviewed: true } : {}),
        });
        if (res.success) {
          setNotice({
            kind: "info",
            text: translate("harness.store.registry.installDone", {
              // 알림도 카드와 같은 이름을 써야 한다 — 카드엔 한국어 이름이,
              // 알림엔 영어 이름이 뜨면 사용자는 다른 걸 설치했다고 읽는다.
              name: localizedItemText(item, locale).name,
            }),
          });
        } else {
          setNotice({
            kind: "error",
            text: res.error ?? translate("harness.store.registry.installFail"),
          });
        }
      } finally {
        setBusy(null);
        void load();
      }
    },
    [load, locale],
  );

  const runUninstall = useCallback(
    async (item: RegistryStoreItem) => {
      if (
        !confirm(
          translate("harness.store.registry.uninstallConfirm", {
            name: localizedItemText(item, locale).name,
          }),
        )
      ) {
        return;
      }
      setNotice(null);
      setBusy(item.id);
      try {
        const res = await window.electronAPI.registry.uninstall({
          id: item.id,
        });
        if (res.success) {
          setNotice({
            kind: "info",
            text: translate("harness.store.registry.uninstallDone", {
              name: localizedItemText(item, locale).name,
            }),
          });
        } else {
          setNotice({
            kind: "error",
            text:
              res.error ?? translate("harness.store.registry.uninstallFail"),
          });
        }
      } finally {
        setBusy(null);
        void load();
      }
    },
    [load, locale],
  );

  // '로컬 모델' 탭 활성 시 레지스트리 전용 표면(새로고침·stale·그리드·푸터)을
  // 전부 숨긴다 — 두 모집단은 데이터 소스가 다르고, 여기 컨트롤이 로컬 탭에
  // 보이면 레지스트리 상태가 로컬 카탈로그의 상태인 것처럼 읽힌다.
  const isLocalTab = category === "localModels";

  return (
    <section className="border-b border-[#313244] px-4 py-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-base">{isLocalTab ? "🖥️" : "🛍️"}</span>
        <h3 className="text-sm font-semibold text-[#cdd6f4]">
          {t(
            isLocalTab
              ? "harness.store.local.title"
              : "harness.store.registry.title",
          )}
        </h3>
        {!isLocalTab && (
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#a6adc8] transition-colors hover:bg-[#45475a] disabled:opacity-50"
          >
            {t("harness.store.registry.refresh")}
          </button>
        )}
        {!isLocalTab && stale && (
          <span className="rounded bg-[#f9e2af]/20 px-1.5 py-0.5 text-[10px] text-[#f9e2af]">
            {t("harness.store.registry.stale")}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-[#7f849c]">
        {t(
          isLocalTab
            ? "harness.store.local.subtitle"
            : "harness.store.registry.subtitle",
        )}
      </p>

      {/* 별점 기준 공시 — 정렬 키를 화면에 심어 놓고 그 규칙을 앱 안에서 못
          읽으면 별점은 그냥 우리가 정한 순서로 읽힌다. 카드 툴팁은 "이 항목이
          왜 이 별점인지"를, 이 패널은 "별점이 애초에 무엇으로 만들어지는지"를
          답한다(상세: v3/docs/store-rating.md). */}
      {!isLocalTab && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setRatingHelpOpen((v) => !v)}
            aria-expanded={ratingHelpOpen}
            className="text-[11px] text-[#89b4fa] hover:underline"
          >
            {ratingHelpOpen ? "▾ " : "▸ "}
            {t("harness.store.registry.rating.helpToggle")}
          </button>
          {ratingHelpOpen && (
            <div className="mt-1.5 rounded border border-[#313244] bg-[#181825] px-3 py-2 text-[11px] leading-relaxed text-[#a6adc8]">
              <p className="mb-1 text-[#bac2de]">
                {t("harness.store.registry.rating.helpIntro")}
              </p>
              <ul className="mb-1 list-disc space-y-0.5 pl-4">
                <li>{t("harness.store.registry.rating.helpUsefulness")}</li>
                <li>{t("harness.store.registry.rating.helpVerification")}</li>
                <li>{t("harness.store.registry.rating.helpLicense")}</li>
                <li>{t("harness.store.registry.rating.helpFreshness")}</li>
              </ul>
              <p className="mb-1">
                {t("harness.store.registry.rating.helpCaps")}
              </p>
              <p className="text-[#7f849c]">
                {t("harness.store.registry.rating.helpSource")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 카테고리 탭바— 활성 카테고리의 그리드만 그린다. typeFilter 를 받는
          레거시 임베드(현재 호출자 없음)에서는 탭이 의미가 없어 숨긴다. */}
      {!typeFilter && (
        <div className="mb-3 flex flex-wrap items-center gap-1">
          {categoryTabs.map((key) => {
            // '로컬 모델' 탭엔 개수 배지를 달지 않는다 — 이 숫자들은 레지스트리
            // 모집단 카운트라, first-party 카탈로그 개수를 섞으면 거짓말이 된다.
            const count =
              key === "all"
                ? visible.length
                : key === "localModels"
                  ? null
                  : (countByCategory.get(key) ?? 0);
            const active = category === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCategory(key)}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  active
                    ? "bg-[#89b4fa]/20 font-semibold text-[#89b4fa]"
                    : "bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]"
                }`}
              >
                {categoryLabel(key)}
                {count !== null && (
                  <span
                    className={`ml-1 text-[10px] ${
                      active ? "text-[#89b4fa]/80" : "text-[#6c7086]"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* '로컬 모델' 탭은 first-party 섹션으로 통째 대체 — 레지스트리 상태
          (unavailable/stale/빈 상태)와 무관하게 항상 동작한다(§4.4). */}
      {isLocalTab && <LocalModelsSection />}

      {!isLocalTab && notice && (
        <div
          className={`mb-3 rounded border px-3 py-2 text-xs ${
            notice.kind === "error"
              ? "border-[#f38ba8]/30 bg-[#f38ba8]/10 text-[#f38ba8]"
              : "border-[#a6e3a1]/30 bg-[#a6e3a1]/10 text-[#a6e3a1]"
          }`}
        >
          {notice.text}
        </div>
      )}

      {!isLocalTab && !available && (
        <p className="text-xs text-[#6c7086]">
          {t("harness.store.registry.unavailable")}
        </p>
      )}
      {/* 빈 상태 = 레지스트리에서 이 화면 조건에 맞는 항목이 하나도 안 왔다는
          뜻이다(tier 로 감추는 항목이 없으므로, 활성 카테고리가 정말 빈 것). */}
      {!isLocalTab && available && !loading && shown.length === 0 && (
        <p className="text-xs text-[#6c7086]">
          {t("harness.store.registry.emptyCatalog")}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((item) => {
          const isBusy = busy === item.id;
          const display = localizedItemText(item, locale);
          const installed =
            item.installState === "installed" ||
            item.installState === "outdated";
          const referenceOnly = isReferenceOnlyRegistryType(item.type);
          const oneClick = isRegistryItemInstallable(item);
          const needsConsent =
            !referenceOnly && isRegistryItemConsentInstallable(item);
          return (
            <div
              key={`${item.type}:${item.id}`}
              className="rounded-md border border-[#313244] bg-[#181825] p-3 transition-colors hover:border-[#45475a]"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  {/* 별점은 이름 **앞**에 둔다 — 목록의 정렬 키가 눈으로 보이는
                      값이어야 "왜 이 순서인지" 가 스크롤만으로 읽힌다. 별점이
                      없는 응답(옛 메인 프로세스)에선 아예 그리지 않는다. */}
                  {item.rating && <StarRating rating={item.rating} />}
                  <span className="truncate text-sm font-semibold text-[#cdd6f4]">
                    {display.name}
                  </span>
                  <span className="flex-shrink-0 text-[10px] text-[#6c7086]">
                    v{item.version}
                  </span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${tierBadgeClass(
                      item.tier,
                    )}`}
                  >
                    {tierLabel(item.tier)}
                  </span>
                  {item.status === "revoked" && (
                    <span className="rounded bg-[#f38ba8]/20 px-1.5 py-0.5 text-[10px] text-[#f38ba8]">
                      {t("harness.store.registry.revoked")}
                    </span>
                  )}
                  {item.status === "deprecated" && (
                    <span className="rounded bg-[#f38ba8]/20 px-1.5 py-0.5 text-[10px] text-[#f38ba8]">
                      {t("harness.store.deprecated")}
                    </span>
                  )}
                  {installed && (
                    <span className="rounded bg-[#a6e3a1]/20 px-1.5 py-0.5 text-[10px] text-[#a6e3a1]">
                      {item.installState === "outdated"
                        ? t("harness.store.registry.outdated")
                        : t("harness.store.registry.installed")}
                    </span>
                  )}
                </div>
              </div>
              <p className="mb-2 text-xs text-[#bac2de]">
                {display.description}
              </p>

              {/* 권한 공시 — 스코프 문자열은 모든 tier 에서 verbatim, 경고 톤은
                  미검수 community 의 고위험 스코프에만 적용한다(§4.6). */}
              <div className="mb-2 flex flex-wrap items-center gap-1">
                <PermissionBadges item={item} />
              </div>

              {item.sourceRepository && (
                <p className="mb-2 truncate text-[10px] text-[#6c7086]">
                  {t("harness.store.registry.source")}: {item.sourceRepository}
                  {item.sourceRef ? ` @ ${item.sourceRef}` : ""}
                </p>
              )}

              <div className="flex items-center gap-2">
                {referenceOnly ? (
                  <span className="text-[10px] text-[#6c7086]">
                    {t("harness.store.registry.referenceOnly")}
                  </span>
                ) : !installed && oneClick ? (
                  <button
                    onClick={() => setDisclosureFor(item)}
                    disabled={isBusy}
                    className="rounded bg-[#89b4fa]/20 px-2.5 py-1 text-xs text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/30 disabled:opacity-50"
                  >
                    {isBusy
                      ? t("harness.store.registry.installing")
                      : t("harness.store.registry.install")}
                  </button>
                ) : !installed && needsConsent ? (
                  <button
                    onClick={() => {
                      setConsentChecked(false);
                      setConsentFor(item);
                    }}
                    disabled={isBusy}
                    className="rounded bg-[#f9e2af]/15 px-2.5 py-1 text-xs text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/25 disabled:opacity-50"
                  >
                    {isBusy
                      ? t("harness.store.registry.installing")
                      : `⚠ ${t("harness.store.registry.install")}`}
                  </button>
                ) : !installed ? (
                  <span
                    className="text-[10px] text-[#6c7086]"
                    title={item.notInstallableReason}
                  >
                    {t("harness.store.registry.notInstallable")}
                    {item.notInstallableReason
                      ? ` — ${item.notInstallableReason}`
                      : ""}
                  </span>
                ) : null}
                {installed && (
                  <button
                    onClick={() => void runUninstall(item)}
                    disabled={isBusy}
                    className="rounded bg-[#f38ba8]/20 px-2.5 py-1 text-xs text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/30 disabled:opacity-50"
                  >
                    {isBusy
                      ? t("harness.store.processing")
                      : t("harness.store.registry.uninstall")}
                  </button>
                )}
                {item.homepage && (
                  <a
                    href={item.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-xs text-[#6c7086] hover:text-[#89b4fa]"
                  >
                    {t("harness.store.docs")}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 전체 카탈로그의 정본은 GitHub 이다. 목록에 섞여 있는 community 항목이
          몇 개인지도 여기서 한 번 더 공시한다 — 카드마다 붙는 배지를 훑지
          않아도 "이 중 N개는 미검수라 동의를 거쳐야 설치된다"가 한 줄로
          읽히게. 레지스트리에 닿지 못한 상태(!available)에선 개수가 0 이라
          링크만 남는다. */}
      {!isLocalTab && available && !loading && (
        <p className="mt-3 text-[11px] text-[#6c7086]">
          {communityCount > 0 && (
            <>
              {t("harness.store.registry.communityListedNote", {
                count: communityCount,
              })}
              {" · "}
            </>
          )}
          <a
            href={REGISTRY_CATALOG_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#89b4fa] hover:underline"
          >
            {t("harness.store.registry.githubCatalog")}
          </a>
        </p>
      )}

      {/* 설치 전 권한 공시 모달 (§4.6) — official/verified 원클릭 경로 */}
      {disclosureFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-lg border border-[#313244] bg-[#1e1e2e] p-4 shadow-2xl">
            <h4 className="mb-1 text-sm font-semibold text-[#cdd6f4]">
              {t("harness.store.registry.disclosureTitle")} —{" "}
              {localizedItemText(disclosureFor, locale).name}
            </h4>
            <p className="mb-3 text-xs text-[#7f849c]">
              {t("harness.store.registry.disclosureNote")}
            </p>
            <div className="mb-4 flex flex-wrap gap-1">
              <PermissionBadges item={disclosureFor} />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDisclosureFor(null)}
                className="rounded bg-[#313244] px-2.5 py-1 text-xs text-[#a6adc8] transition-colors hover:bg-[#45475a]"
              >
                {t("harness.store.registry.disclosureCancel")}
              </button>
              <button
                onClick={() => void runInstall(disclosureFor, false)}
                className="rounded bg-[#89b4fa]/20 px-2.5 py-1 text-xs text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/30"
              >
                {t("harness.store.registry.disclosureConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ★community 미검수 경고 모달 — 출처 신뢰 체크박스를 켜야만 설치 버튼이
          활성화되고, 그때 acknowledgeUnreviewed=true 로 요청한다. 이 모달은
          동의 수집 UI 일 뿐이다: 플래그 없는 community 설치는 메인 프로세스
          installer 가 거부한다. */}
      {consentFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-lg border border-[#f9e2af]/40 bg-[#1e1e2e] p-4 shadow-2xl">
            <h4 className="mb-1 text-sm font-semibold text-[#f9e2af]">
              ⚠ {t("harness.store.registry.communityWarnTitle")} —{" "}
              {localizedItemText(consentFor, locale).name}
            </h4>
            <p className="mb-3 text-xs text-[#bac2de]">
              {t("harness.store.registry.communityWarnBody", {
                source: communitySourceLabel(consentFor),
              })}
            </p>
            <div className="mb-3 flex flex-wrap gap-1">
              <PermissionBadges item={consentFor} />
            </div>
            <label className="mb-4 flex cursor-pointer items-start gap-2 text-xs text-[#cdd6f4]">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 accent-[#f9e2af]"
              />
              <span>
                {t("harness.store.registry.communityWarnConsent", {
                  source: communitySourceLabel(consentFor),
                })}
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setConsentFor(null);
                  setConsentChecked(false);
                }}
                className="rounded bg-[#313244] px-2.5 py-1 text-xs text-[#a6adc8] transition-colors hover:bg-[#45475a]"
              >
                {t("harness.store.registry.disclosureCancel")}
              </button>
              <button
                onClick={() => void runInstall(consentFor, true)}
                disabled={!consentChecked}
                className="rounded bg-[#f9e2af]/20 px-2.5 py-1 text-xs text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("harness.store.registry.communityWarnConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
