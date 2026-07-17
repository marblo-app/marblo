import { useCallback, useEffect, useRef, useState } from "react";
import { usePaneStore } from "../../stores/paneStore";

/**
 * A self-contained browser pane for the Workspace shell.
 *
 * Renderer-only: the app runs with `webviewTag` disabled and this ticket must
 * not touch the Electron main process, so we use an <iframe> rather than
 * <webview>. That's fine for the primary use case (previewing a local dev
 * server / docs while working), with the known limitation that sites sending
 * `X-Frame-Options: DENY` / restrictive CSP can't be framed — we surface that
 * as a hint rather than a blank pane.
 */
interface BrowserPaneProps {
  paneId: string;
  url: string;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "about:blank") return "about:blank";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (
    /^localhost(:\d+)?/i.test(trimmed) ||
    /^\d+\.\d+\.\d+\.\d+/.test(trimmed)
  ) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

export function BrowserPane({ paneId, url }: BrowserPaneProps) {
  const setBrowserUrl = usePaneStore((s) => s.setBrowserUrl);
  const [draft, setDraft] = useState(url === "about:blank" ? "" : url);
  const [loadFailed, setLoadFailed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setDraft(url === "about:blank" ? "" : url);
    setLoadFailed(false);
  }, [url]);

  const commit = useCallback(
    (value: string) => {
      const next = normalizeUrl(value);
      setLoadFailed(false);
      setBrowserUrl(paneId, next);
    },
    [paneId, setBrowserUrl]
  );

  const reload = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    setLoadFailed(false);
    // Re-assign src to force a reload without a full remount.
    // eslint-disable-next-line no-self-assign
    frame.src = frame.src;
  }, []);

  const showFrame = url !== "about:blank";

  return (
    <div className="flex h-full flex-col bg-gray-900">
      {/* URL bar */}
      <div className="flex items-center gap-1.5 border-b border-gray-700 bg-gray-800 px-2 py-1.5">
        <button
          type="button"
          onClick={reload}
          disabled={!showFrame}
          title="Reload"
          className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200 disabled:opacity-40"
        >
          <svg
            className="h-3.5 w-3.5"
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
          placeholder="localhost:3001, docs URL, …"
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

      {/* Viewport */}
      <div className="relative flex-1 overflow-hidden bg-white">
        {showFrame ? (
          <>
            <iframe
              ref={iframeRef}
              src={url}
              title={`browser-${paneId}`}
              className="h-full w-full border-0"
              // Sandbox keeps a framed page from reaching back into the app,
              // while still allowing the page to run its own scripts / forms.
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onError={() => setLoadFailed(true)}
            />
            {loadFailed && (
              <div className="absolute inset-x-0 bottom-0 bg-amber-950/90 px-3 py-2 text-xs text-amber-200">
                This site may block embedding (X-Frame-Options / CSP). Open it
                in a real browser tab instead.
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center bg-gray-900 text-center text-sm text-gray-500">
            <div>
              <p className="text-gray-400">Enter a URL to preview</p>
              <p className="mt-1 text-xs text-gray-600">
                Great for your local dev server or docs while agents work.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
