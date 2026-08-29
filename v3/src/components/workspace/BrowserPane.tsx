import { useCallback, useEffect, useRef, useState } from "react";
import { usePaneStore } from "../../stores/paneStore";

/**
 * WebContentsView-backed browser pane.
 *
 * The real page is not a DOM child. BrowserPane owns the toolbar/status UI and
 * reports a viewport rectangle to main, where a WebContentsView floats in the
 * BrowserWindow contentView. Visibility is explicit: hide the native view when
 * this tab is inactive, too small, the document is hidden, or a modal/popover is
 * present, because native child views otherwise render above renderer overlays.
 */
interface BrowserPaneProps {
  paneId: string;
  url: string;
}

const MIN_NATIVE_VIEW_SIZE = 8;
const OVERLAY_SELECTORS = [
  '[aria-modal="true"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-radix-popper-content-wrapper]',
  '[data-floating-ui-portal]',
].join(",");

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "about:blank") return "about:blank";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (
    /^localhost(:\d+)?([/?#].*)?$/i.test(trimmed) ||
    /^127\.0\.0\.1(:\d+)?([/?#].*)?$/i.test(trimmed) ||
    /^\d+\.\d+\.\d+\.\d+(:\d+)?([/?#].*)?$/.test(trimmed)
  ) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

function elementIsVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.pointerEvents !== "none"
  );
}

function hasBlockingOverlay(owner: HTMLElement): boolean {
  const nodes = document.querySelectorAll(OVERLAY_SELECTORS);
  for (const node of nodes) {
    if (owner.contains(node)) continue;
    if (elementIsVisible(node)) return true;
  }
  return false;
}

function rectToBounds(rect: DOMRect): BrowserPaneBounds {
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

function canShowNativeView(owner: HTMLElement, viewport: HTMLElement): boolean {
  if (document.hidden) return false;
  if (viewport.getClientRects().length === 0) return false;
  const rect = viewport.getBoundingClientRect();
  if (
    rect.width < MIN_NATIVE_VIEW_SIZE ||
    rect.height < MIN_NATIVE_VIEW_SIZE ||
    rect.bottom <= 0 ||
    rect.right <= 0 ||
    rect.left >= window.innerWidth ||
    rect.top >= window.innerHeight
  ) {
    return false;
  }
  return !hasBlockingOverlay(owner);
}

export function BrowserPane({ paneId, url }: BrowserPaneProps) {
  const setBrowserUrl = usePaneStore((s) => s.setBrowserUrl);
  const [draft, setDraft] = useState(url === "about:blank" ? "" : url);
  const [state, setState] = useState<BrowserPaneState | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const initialUrlRef = useRef(url);
  const propUrlRef = useRef(url);
  const lastNavigatedUrlRef = useRef<string | null>(url);
  const lastNativeUrlRef = useRef<string | null>(url);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    propUrlRef.current = url;
    setDraft(url === "about:blank" ? "" : url);
  }, [url]);

  const applyState = useCallback(
    (next: BrowserPaneState) => {
      if (next.paneId !== paneId) return;
      setState(next);
      setBridgeError(null);
      if (next.url && next.url !== lastNativeUrlRef.current) {
        lastNativeUrlRef.current = next.url;
        if (next.url !== propUrlRef.current) setBrowserUrl(paneId, next.url);
      }
    },
    [paneId, setBrowserUrl]
  );

  const reportBounds = useCallback(() => {
    const api = window.electronAPI?.browserPane;
    const root = rootRef.current;
    const viewport = viewportRef.current;
    if (!api || !root || !viewport) return;

    const visible =
      url !== "about:blank" &&
      !state?.notice &&
      canShowNativeView(root, viewport);
    const bounds = rectToBounds(viewport.getBoundingClientRect());
    void api
      .setBounds({
        paneId,
        visible,
        bounds,
      })
      .catch(() => {
        if (mountedRef.current) setBridgeError("Browser view unavailable.");
      });
  }, [paneId, state?.notice, url]);

  useEffect(() => {
    const api = window.electronAPI?.browserPane;
    if (!api) {
      setBridgeError("Browser view unavailable in this build.");
      return;
    }

    let disposed = false;
    const offState = api.onState(applyState);
    void api
      .attach({ paneId, url: initialUrlRef.current })
      .then((result) => {
        if (disposed || !mountedRef.current) return;
        if (result.ok) applyState(result.state);
        else setBridgeError(result.error);
      })
      .catch(() => {
        if (!disposed && mountedRef.current) {
          setBridgeError("Browser view unavailable.");
        }
      });

    return () => {
      disposed = true;
      offState();
      void api.release(paneId).catch(() => {});
    };
  }, [applyState, paneId]);

  useEffect(() => {
    const api = window.electronAPI?.browserPane;
    if (!api) return;
    const next = url;
    if (lastNavigatedUrlRef.current === next) return;
    lastNavigatedUrlRef.current = next;
    void api
      .navigate({ paneId, url: next })
      .then((result) => {
        if (!mountedRef.current) return;
        if (result.ok) applyState(result.state);
        else setBridgeError(result.error);
      })
      .catch(() => {
        if (mountedRef.current) setBridgeError("Browser navigation failed.");
      });
  }, [applyState, paneId, url]);

  useEffect(() => {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        reportBounds();
      });
    };

    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("visibilitychange", schedule);

    const resizeObserver =
      typeof ResizeObserver === "undefined" || !viewportRef.current
        ? null
        : new ResizeObserver(schedule);
    if (viewportRef.current) resizeObserver?.observe(viewportRef.current);

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(schedule);
    mutationObserver?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "aria-modal", "role"],
    });

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("visibilitychange", schedule);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      void window.electronAPI?.browserPane
        ?.setBounds({ paneId, visible: false })
        .catch(() => {});
    };
  }, [paneId, reportBounds]);

  useEffect(() => {
    reportBounds();
  }, [reportBounds]);

  const commit = useCallback(
    (value: string) => {
      const next = normalizeUrl(value);
      setBridgeError(null);
      setState((prev) => (prev ? { ...prev, notice: undefined } : prev));
      setBrowserUrl(paneId, next);
    },
    [paneId, setBrowserUrl]
  );

  const reload = useCallback(() => {
    setBridgeError(null);
    void window.electronAPI?.browserPane?.reload(paneId).catch(() => {
      if (mountedRef.current) setBridgeError("Browser reload failed.");
    });
  }, [paneId]);

  const dismissNotice = useCallback(() => {
    setBridgeError(null);
    setState((prev) => (prev ? { ...prev, notice: undefined } : prev));
  }, []);

  const showNativeTarget = url !== "about:blank";
  const notice = bridgeError ?? state?.notice?.message ?? null;
  const securityLabel = state?.security
    ? `nodeIntegration off · contextIsolation on · ${state.security.partition}`
    : "nodeIntegration off · contextIsolation on";

  return (
    <div ref={rootRef} className="flex h-full flex-col bg-gray-900">
      <div className="flex items-center gap-1.5 border-b border-gray-700 bg-gray-800 px-2 py-1.5">
        <button
          type="button"
          onClick={reload}
          disabled={!showNativeTarget}
          title="Reload"
          className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200 disabled:opacity-40"
        >
          <svg
            className={`h-3.5 w-3.5 ${
              state?.isLoading ? "animate-spin" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft);
          }}
          placeholder="localhost:3001 or https://example.com"
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 outline-none focus:border-blue-500"
        />
        <button
          type="button"
          onClick={() => commit(draft)}
          className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-500"
        >
          Go
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden bg-white">
        <div
          ref={viewportRef}
          data-testid="browser-pane-native-anchor"
          className="absolute inset-0 bg-white"
        />
        {!showNativeTarget && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-center text-sm text-gray-500">
            <div>
              <p className="text-gray-400">Enter a URL to open</p>
              <p className="mt-1 text-xs text-gray-600">
                Sites that block iframe embedding can load here.
              </p>
            </div>
          </div>
        )}
        {notice && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-amber-950/95 px-3 py-2 text-xs text-amber-100">
            <span className="min-w-0 flex-1">{notice}</span>
            <button
              type="button"
              onClick={dismissNotice}
              className="flex-shrink-0 rounded border border-amber-400/40 px-2 py-0.5 text-[11px] text-amber-50 hover:bg-amber-800"
            >
              Dismiss
            </button>
          </div>
        )}
        <div className="pointer-events-none absolute right-2 top-2 rounded bg-gray-950/70 px-2 py-1 text-[10px] text-gray-300">
          {securityLabel}
        </div>
      </div>
    </div>
  );
}
