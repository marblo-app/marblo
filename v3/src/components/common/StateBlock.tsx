/**
 * StateBlock — "안 될 때" 의 화면. `LoadState` 를 받아 세 형태 중 하나로 그린다.
 *
 * 정본: `docs/design-tokens-and-failure-vocabulary-2026-08-22.md` §3-4.
 *
 *   | 형태     | 언제                                   | 구성                                        |
 *   |----------|----------------------------------------|---------------------------------------------|
 *   | `block`  | 리스트·패널 **전체**가 그 상태          | 눈썹 라벨 + 한 문장 + **행동 버튼 1개**       |
 *   | `inline` | 수치 **한 칸**만 그 상태                | 숫자 자리에 상태 라벨 + 물음표 툴팁(사유)      |
 *   | `banner` | 데이터는 있는데 **오래됐거나 잘렸다**   | 패널 상단 한 줄 + 행동                        |
 *
 * 쓰는 법 — `block`/`inline` 은 **감싸는 컴포넌트**다. 데이터가 있을 때의 콘텐츠를
 * 렌더 함수로 넘기면, 상태가 `ready`/`partial` 일 때만 그것을 호출한다(실패 상태에서
 * `data.map` 이 터지지 않는다). `banner` 는 콘텐츠 위에 따로 놓는다.
 *
 *   <StateBlock variant="block" state={state} minHeight={240}>
 *     {() => <TicketList tickets={tickets} />}
 *   </StateBlock>
 *
 *   <StateBlock variant="inline" state={costState}>{() => <>{formatUsd(total)}</>}</StateBlock>
 *
 *   <StateBlock variant="banner" state={state} />   // partial/failed 일 때만 한 줄
 *
 * 이 컴포넌트가 지키는 것(금지 다섯, 정본 §3-4):
 *   ① ★실패를 0 으로 그리지 않는다 — `failed`/`denied`/`not_ready` 는 **숫자 자리에
 *      숫자도 0도 그리지 않는다**(테스트로 고정: `tests/unit/state-block-render.test.ts`).
 *   ③ ★`err.message` 원문은 본문에 쓰지 않는다 — `reasonCode`(i18n 키)가 본문,
 *      `detail` 은 접힌 `<details>` 안에서만 보인다. inline/banner 는 원문을 아예 안 보인다.
 *   ④ ★다음 행동 없는 상태는 그릴 수 없다 — `LoadState` 타입이 막는다.
 *   ⑤ ★로딩에서 레이아웃이 튀지 않는다 — `block` 은 `minHeight` 를 **필수**로 받아
 *      모든 상태(골격 포함)에 같은 최소 높이를 건다. 5초 뒤 "계속 시도 중" 줄은 골격
 *      **위에 겹쳐** 그려 높이가 안 바뀐다.
 *
 * 색은 역할 토큰만 쓴다(#1134). 버튼 스타일은 D2(`components/common/ui.tsx`) 가
 * 들어오면 그쪽 `Button` 으로 바꾼다 — 그때까지 여기 상수가 같은 값이다.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation, type TFunction } from "../../lib/i18n";
import {
  LOADING_STILL_TRYING_MS,
  type DeniedState,
  type EmptyState,
  type FailedState,
  type LoadState,
  type LocalizedText,
  type NotReadyState,
  type PartialState,
  type StateAction,
} from "./loadState";
import { Skeleton } from "./Skeleton";

/** `LocalizedText` → 문자열. 키 하나이거나 `{ key, vars }`. */
export function resolveText(t: TFunction, text: LocalizedText): string {
  return typeof text === "string" ? t(text) : t(text.key, text.vars);
}

type CssLength = number | string;

interface CommonProps {
  state: LoadState;
  className?: string;
}

export interface StateBlockBlockProps extends CommonProps {
  variant: "block";
  /** ★최종 콘텐츠의 높이. 모든 상태에 `min-height` 로 걸려 레이아웃이 튀지 않는다. */
  minHeight: CssLength;
  /** 눈썹 라벨(섹션 이름). 없으면 생략. */
  label?: LocalizedText;
  /** 로딩 골격의 줄 수. 목록이면 행 수와 맞춘다. 기본 3. */
  skeletonLines?: number;
  /** 데이터가 있을 때의 콘텐츠. `ready`/`partial` 에서만 호출된다. */
  children: () => ReactNode;
}

export interface StateBlockInlineProps extends CommonProps {
  variant: "inline";
  /** 골격 너비 — 수치 칸 폭. 기본 `"4ch"`. */
  width?: CssLength;
  /** 골격 높이 — 줄 높이. 기본 `"1.25em"`. */
  height?: CssLength;
  /** 수치. `ready`/`empty`(★진짜 0)/`partial` 에서만 호출된다. */
  children: () => ReactNode;
}

export interface StateBlockBannerProps extends CommonProps {
  variant: "banner";
}

export type StateBlockProps =
  | StateBlockBlockProps
  | StateBlockInlineProps
  | StateBlockBannerProps;

// ── 스타일 상수 (토큰만) ────────────────────────────────────────────────
const BTN_BASE =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const BTN_PRIMARY = `${BTN_BASE} bg-accent font-semibold text-on-accent hover:bg-accent-hover`;
const BTN_SECONDARY = `${BTN_BASE} border border-default text-primary hover:border-strong hover:bg-surface-hover`;
const BTN_LINK =
  "inline-flex items-center text-[11px] text-accent underline-offset-2 hover:underline";

const TITLE_TONE: Record<
  Exclude<LoadState["kind"], "loading" | "ready">,
  string
> = {
  empty: "text-primary",
  failed: "text-danger",
  denied: "text-warning",
  not_ready: "text-secondary",
  partial: "text-warning",
};

// ── 5초 규칙 ──────────────────────────────────────────────────────────
/**
 * 로딩이 `LOADING_STILL_TRYING_MS` 를 넘겼는가. `since` 가 있으면 그 시각 기준(리마운트
 * 해도 이어진다), 없으면 이 컴포넌트가 로딩을 처음 본 시각 기준.
 */
function useStillTrying(state: LoadState): boolean {
  const loading = state.kind === "loading";
  const since = state.kind === "loading" ? state.since : undefined;
  const startRef = useRef<number | null>(null);
  const [stillAt, setStillAt] = useState<number | null>(null);

  useEffect(() => {
    if (!loading) {
      startRef.current = null;
      return;
    }
    const start = since ?? Date.now();
    startRef.current = start;
    const remaining = Math.max(
      0,
      LOADING_STILL_TRYING_MS - (Date.now() - start),
    );
    const id = setTimeout(() => setStillAt(start), remaining);
    return () => clearTimeout(id);
  }, [loading, since]);

  return loading && stillAt !== null && stillAt === startRef.current;
}

// ── 조각 ──────────────────────────────────────────────────────────────
function ActionButton({
  action,
  primary,
  t,
}: {
  action: StateAction;
  primary?: boolean;
  t: TFunction;
}) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      className={primary ? BTN_PRIMARY : BTN_SECONDARY}
    >
      {resolveText(t, action.label)}
    </button>
  );
}

/** 각 상태의 문장·행동을 한 군데서 계산한다 — block/inline/banner 가 같은 말을 쓴다. */
function describe(
  t: TFunction,
  state: EmptyState | FailedState | DeniedState | NotReadyState | PartialState,
): {
  title: string;
  /** inline 의 숫자 자리에 들어갈 짧은 라벨. */
  label: string;
  reason?: string;
  action?: StateAction;
  primary?: boolean;
  detail?: string;
} {
  switch (state.kind) {
    case "empty":
      return {
        title: resolveText(t, state.title ?? "common.state.empty.title"),
        label: resolveText(t, state.title ?? "common.state.empty.title"),
        reason: resolveText(t, state.hint),
        action: state.create,
        primary: true,
      };
    case "failed":
      return {
        title: resolveText(t, state.title ?? "common.state.failed.title"),
        label: t("common.state.failed.label"),
        reason: t(state.reasonCode),
        action: state.action ?? {
          label: "common.state.action.retry",
          onClick: state.retry,
        },
        detail: state.detail,
      };
    case "denied": {
      const ask = t("common.state.denied.ask", { whom: state.askWhom });
      return {
        title: resolveText(t, state.title ?? "common.state.denied.title"),
        label: t("common.unknown"),
        reason: `${t(state.reasonCode)} ${ask}`,
        action: state.onAsk
          ? {
              label: {
                key: "common.state.action.askOwner",
                vars: { whom: state.askWhom },
              },
              onClick: state.onAsk,
            }
          : undefined,
      };
    }
    case "not_ready": {
      const label = resolveText(
        t,
        state.label ?? "common.state.notReady.label",
      );
      const when = state.availableWhen
        ? resolveText(t, state.availableWhen)
        : undefined;
      return {
        title: label,
        label,
        reason: when ? `${t(state.reasonCode)} ${when}` : t(state.reasonCode),
        action: state.enable,
      };
    }
    case "partial":
      return {
        title: t("common.state.partial.title", {
          shown: state.shown,
          total: state.total,
        }),
        label: `${state.shown}/${state.total}`,
        action: {
          label: "common.state.action.showMore",
          onClick: state.showMore,
        },
      };
  }
}

// ── block ─────────────────────────────────────────────────────────────
function Block(props: StateBlockBlockProps) {
  const { t } = useTranslation();
  const { state, minHeight, label, skeletonLines = 3, className = "" } = props;
  const stillTrying = useStillTrying(state);
  const mh = typeof minHeight === "number" ? `${minHeight}px` : minHeight;
  const common = {
    "data-state-block": "block",
    "data-state-kind": state.kind,
    style: { minHeight: mh },
  } as const;

  if (state.kind === "loading") {
    return (
      <div {...common} className={`relative ${className}`}>
        <Skeleton height={mh} lines={skeletonLines} shape="panel" />
        {stillTrying && (
          <div
            role="status"
            className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 rounded-b-lg bg-surface-panel px-4 py-2 text-xs text-secondary"
          >
            <span>{t("common.state.loading.still")}</span>
            {state.cancel && (
              <button
                type="button"
                onClick={state.cancel}
                className={BTN_SECONDARY}
              >
                {t("common.cancel")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (state.kind === "ready") {
    return (
      <div {...common} className={className}>
        {props.children()}
      </div>
    );
  }

  if (state.kind === "partial") {
    return (
      <div {...common} className={`flex flex-col gap-2 ${className}`}>
        <Banner variant="banner" state={state} />
        {props.children()}
      </div>
    );
  }

  const d = describe(t, state);
  return (
    <div
      {...common}
      role="status"
      className={`flex flex-col items-start justify-center gap-2 rounded-lg border border-subtle bg-surface-panel px-4 py-3 ${className}`}
    >
      {label !== undefined && (
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
          {resolveText(t, label)}
        </span>
      )}
      <p className={`text-sm font-medium ${TITLE_TONE[state.kind]}`}>
        {d.title}
      </p>
      {d.reason && <p className="text-xs text-secondary">{d.reason}</p>}
      {d.action && <ActionButton action={d.action} primary={d.primary} t={t} />}
      {d.detail !== undefined && d.detail !== "" && (
        <details className="w-full text-[11px] text-muted">
          <summary className="cursor-pointer select-none">
            {t("common.state.failed.detail")}
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border border-subtle bg-surface-raised px-2 py-1 font-mono">
            {d.detail}
          </pre>
        </details>
      )}
    </div>
  );
}

// ── inline ────────────────────────────────────────────────────────────
function Inline(props: StateBlockInlineProps) {
  const { t } = useTranslation();
  const { state, width = "4ch", height = "1.25em", className = "" } = props;

  if (state.kind === "loading") {
    return (
      <Skeleton
        inline
        height={height}
        width={width}
        shape="text"
        className={className}
      />
    );
  }

  if (state.kind === "ready" || state.kind === "empty") {
    // ★empty 는 진짜 0 — 이때만 0 을 그린다(정본 §3-2 매핑).
    return <>{props.children()}</>;
  }

  if (state.kind === "partial") {
    const d = describe(t, state);
    return (
      <span
        data-state-block="inline"
        data-state-kind={state.kind}
        className={`inline-flex items-baseline gap-1 ${className}`}
      >
        {props.children()}
        <button
          type="button"
          onClick={state.showMore}
          title={d.title}
          aria-label={`${d.title} — ${t("common.state.action.showMore")}`}
          className={`${BTN_LINK} text-warning`}
        >
          {d.label}
        </button>
      </span>
    );
  }

  // failed / denied / not_ready — ★숫자 자리에 숫자도 0도 없다.
  const d = describe(t, state);
  const tooltip = d.reason ? `${d.title} ${d.reason}` : d.title;
  return (
    <span
      data-state-block="inline"
      data-state-kind={state.kind}
      role="status"
      className={`inline-flex items-center gap-1 text-xs ${TITLE_TONE[state.kind]} ${className}`}
    >
      <span title={tooltip} aria-label={tooltip}>
        {d.label}
      </span>
      <span
        aria-hidden="true"
        title={tooltip}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-default text-[10px] leading-none text-muted"
      >
        ?
      </span>
      {d.action && (
        <button type="button" onClick={d.action.onClick} className={BTN_LINK}>
          {resolveText(t, d.action.label)}
        </button>
      )}
    </span>
  );
}

// ── banner ────────────────────────────────────────────────────────────
function Banner({ state, className = "" }: StateBlockBannerProps) {
  const { t } = useTranslation();
  // 데이터가 있는 화면 위에 얹는 한 줄 — 정상/로딩/빈 상태엔 할 말이 없다.
  if (
    state.kind === "ready" ||
    state.kind === "loading" ||
    state.kind === "empty"
  ) {
    return null;
  }
  const d = describe(t, state);
  return (
    <div
      data-state-block="banner"
      data-state-kind={state.kind}
      role="status"
      className={`flex items-center gap-2 rounded-md border border-subtle bg-surface-raised px-3 py-1.5 text-xs ${className}`}
    >
      <span className={`font-medium ${TITLE_TONE[state.kind]}`}>{d.title}</span>
      {d.reason && <span className="text-secondary">{d.reason}</span>}
      {d.action && (
        <span className="ml-auto">
          <ActionButton action={d.action} primary={d.primary} t={t} />
        </span>
      )}
    </div>
  );
}

export function StateBlock(props: StateBlockProps) {
  switch (props.variant) {
    case "block":
      return <Block {...props} />;
    case "inline":
      return <Inline {...props} />;
    case "banner":
      return <Banner {...props} />;
  }
}
