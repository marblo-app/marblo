import { useEffect, useRef, useState } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useTranslation } from "../../lib/i18n";
import { useWorktreeDiffStore } from "../../stores/worktreeDiffStore";
import { useOrchestratorDiffComment } from "../../hooks/useOrchestratorDiffComment";
import {
  buildRangeFromLines,
  formatRangeLabel,
  type DiffCommentRange,
} from "../../lib/diffComment";

/**
 * Diff-A surface — the default Code tab diff for ALL users (both the legacy
 * Layout and the opt-in Workspace shell), promoted from shell-only.
 *
 * Same full-width diff view as the legacy DiffViewer (layout A: editor at full
 * width, diff toggled per tab), PLUS inline review comments:
 *  - click a line's glyph margin → a Monaco view zone opens with a comment box
 *  - submitting routes the comment to the orchestrator via the existing
 *    local-first / cross-machine pattern (no new IPC) — see
 *    orchestratorInstructionService.
 *
 * The legacy DiffViewer (components/code/DiffViewer) is retained as a fallback
 * component but is no longer wired as the default.
 */
interface DiffSurfaceProps {
  filePath: string;
  language: string;
  currentContent: string;
}

export function DiffSurface({
  filePath,
  language,
  currentContent,
}: DiffSurfaceProps) {
  const { t } = useTranslation();
  const { send, toast } = useOrchestratorDiffComment();

  const [original, setOriginal] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<Parameters<DiffOnMount>[1] | null>(null);
  const zoneIdRef = useRef<string | null>(null);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);

  // Monaco handlers are registered once on mount, so they must not close over
  // render-scoped values. Both are reached through refs refreshed every render.
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const openCommentZoneRef = useRef<(start: number, end: number) => void>(
    () => {},
  );

  // Baseline for THIS file. When it is part of a worktree diff auto-open, use
  // that collection's merge-base so already-committed work still renders as a
  // diff — against the default HEAD baseline a committed file reads as
  // identical and the surface shows an empty diff. Any other file (a normal
  // working-tree edit) keeps the HEAD baseline.
  const baseSha = useWorktreeDiffStore((s) =>
    s.state.kind === "opened" && s.state.files.some((f) => f.path === filePath)
      ? s.state.baseSha
      : undefined,
  );

  // Load the git baseline for the diff.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.electronAPI.fs
      .gitDiff(filePath, baseSha)
      .then((result) => {
        if (!cancelled) {
          setOriginal(result.original);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOriginal("");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, baseSha]);

  const clearZone = () => {
    const ed = editorRef.current;
    const zoneId = zoneIdRef.current;
    if (ed && zoneId) {
      ed.getModifiedEditor().changeViewZones((acc) => acc.removeZone(zoneId));
    }
    zoneIdRef.current = null;
  };

  /**
   * Open the composer for a line RANGE. The gutter path passes the same line
   * twice (unchanged behaviour); the context-menu path passes the current
   * selection, so a comment can quote several lines at once.
   */
  const openCommentZone = (startLine: number, endLine: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    const modified = ed.getModifiedEditor();
    const model = modified.getModel();
    const lastLine = endLine;
    const range: DiffCommentRange = buildRangeFromLines(
      filePathRef.current,
      startLine,
      endLine,
      (line) => model?.getLineContent(line) ?? "",
    );

    clearZone();

    const dom = document.createElement("div");
    dom.className = "marblo-diff-comment-zone";
    dom.style.cssText =
      "position:sticky;left:12px;z-index:10;width:min(520px,calc(100vw - 48px));max-width:calc(100% - 24px);box-sizing:border-box;background:#111827;border:1px solid #374151;border-left:2px solid #3b82f6;border-radius:6px;padding:8px 12px;font-family:inherit;box-shadow:0 12px 28px rgba(0,0,0,.35);pointer-events:auto;";
    dom.innerHTML = `
      <div style="font-size:11px;color:#9ca3af;margin-bottom:6px;">
        ${t("diff.comment.on")} · ${escapeHtml(formatRangeLabel(range))}
      </div>
      <textarea rows="2" placeholder="${escapeAttr(
        t("diff.comment.placeholder"),
      )}" style="width:100%;box-sizing:border-box;background:#0b0f19;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:6px;font-size:12px;resize:vertical;outline:none;"></textarea>
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px;">
        <button data-action="cancel" style="font-size:11px;padding:3px 10px;border-radius:4px;background:transparent;color:#9ca3af;border:1px solid #374151;cursor:pointer;">${escapeHtml(
          t("common.cancel"),
        )}</button>
        <button data-action="send" style="font-size:11px;padding:3px 10px;border-radius:4px;background:#2563eb;color:#fff;border:0;cursor:pointer;">${escapeHtml(
          t("diff.comment.send"),
        )}</button>
      </div>
    `;

    const textarea = dom.querySelector("textarea") as HTMLTextAreaElement;
    const cancelBtn = dom.querySelector(
      '[data-action="cancel"]',
    ) as HTMLButtonElement;
    const sendBtn = dom.querySelector(
      '[data-action="send"]',
    ) as HTMLButtonElement;

    const stopEditorEvent = (event: Event) => event.stopPropagation();
    dom.addEventListener("mousedown", stopEditorEvent);
    dom.addEventListener("click", stopEditorEvent);

    const cancelComment = () => clearZone();
    const submitComment = async () => {
      const comment = textarea.value.trim();
      if (!comment || sendBtn.disabled) return;
      sendBtn.disabled = true;
      sendBtn.textContent = t("orchestrator.sending");
      clearZone();
      void send(range, comment);
    };

    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelComment();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        void submitComment();
      }
    });
    cancelBtn.addEventListener("click", () => clearZone());
    sendBtn.addEventListener("click", () => void submitComment());

    modified.changeViewZones((acc) => {
      zoneIdRef.current = acc.addZone({
        afterLineNumber: lastLine,
        heightInLines: 6,
        domNode: dom,
      });
    });
    // Focus after the zone lays out.
    window.setTimeout(() => textarea.focus(), 0);
  };
  openCommentZoneRef.current = openCommentZone;

  const handleMount: DiffOnMount = (diffEditor, monaco) => {
    editorRef.current = diffEditor;
    monacoRef.current = monaco;
    const modified = diffEditor.getModifiedEditor();

    // Click in the glyph margin → open the comment composer on that line.
    const d1 = modified.onMouseDown((e) => {
      const MT = monaco.editor.MouseTargetType;
      if (
        e.target.type === MT.GUTTER_GLYPH_MARGIN ||
        e.target.type === MT.GUTTER_LINE_NUMBERS
      ) {
        const line = e.target.position?.lineNumber;
        if (line) openCommentZoneRef.current(line, line);
      }
    });
    disposablesRef.current.push(d1);

    // Select code → right-click → "Comment to orchestrator". The gutter path
    // above still works; this one exists because it is *visible* (a gutter
    // click is an invisible affordance) and because it can quote a range.
    const d2 = modified.addAction({
      id: "marblo.commentToOrchestrator",
      label: t("diff.comment.action"),
      contextMenuGroupId: "navigation",
      contextMenuOrder: 0,
      run: (ed) => {
        const sel = ed.getSelection();
        if (!sel) return;
        // A collapsed selection (plain right-click) comments on that one line.
        openCommentZoneRef.current(sel.startLineNumber, sel.endLineNumber);
      },
    });
    disposablesRef.current.push(d2);
  };

  // Lifecycle cleanup: drop the open zone + listeners when the file changes or
  // the surface unmounts (mirrors the watcher/listener teardown discipline the
  // shell uses elsewhere).
  useEffect(() => {
    return () => {
      clearZone();
      disposablesRef.current.forEach((d) => d.dispose());
      disposablesRef.current = [];
      try {
        editorRef.current?.setModel(null);
      } catch {
        // Monaco may already be disposing during HMR or rapid tab teardown.
      }
      editorRef.current = null;
    };
  }, [filePath]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        {t("code.diffLoading")}
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <DiffEditor
        height="100%"
        language={language}
        original={original}
        modified={currentContent}
        theme="vs-dark"
        onMount={handleMount}
        options={{
          readOnly: true,
          glyphMargin: true,
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          renderSideBySide: true,
          automaticLayout: true,
        }}
      />
      <div className="pointer-events-none absolute right-3 top-2 rounded bg-gray-800/90 px-2 py-1 text-[10px] text-gray-400">
        {t("diff.comment.hintGutter")}
      </div>
      {toast && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-100 shadow-lg ring-1 ring-gray-700">
          {toast}
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
