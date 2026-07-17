import { useEffect, useRef, useState } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useTranslation } from "../../lib/i18n";
import { useProjectStore } from "../../stores/projectStore";
import { useAuth } from "../../hooks/useAuth";
import {
  routeInstructionToOrchestrator,
  type RouteResult,
} from "../../services/orchestratorInstructionService";

/**
 * Diff-A surface for the Workspace shell.
 *
 * Same full-width diff view as the legacy DiffViewer (layout A: editor at full
 * width, diff toggled per tab), PLUS inline review comments:
 *  - click a line's glyph margin → a Monaco view zone opens with a comment box
 *  - submitting routes the comment to the orchestrator via the existing
 *    local-first / cross-machine pattern (no new IPC) — see
 *    orchestratorInstructionService.
 *
 * Kept separate from DiffViewer so the legacy Code tab (flag OFF) is untouched.
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
  const currentProject = useProjectStore((s) => s.currentProject);
  const { user } = useAuth();

  const [original, setOriginal] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<Parameters<DiffOnMount>[1] | null>(null);
  const zoneIdRef = useRef<string | null>(null);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);

  // Keep routing inputs fresh for the (once-registered) view-zone handler.
  const routeCtxRef = useRef({
    projectId: currentProject?.id ?? "",
    userId: user?.uid,
    userName: user?.displayName ?? "User",
  });
  routeCtxRef.current = {
    projectId: currentProject?.id ?? "",
    userId: user?.uid,
    userName: user?.displayName ?? "User",
  };

  // Load the git baseline for the diff.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.electronAPI.fs
      .gitDiff(filePath)
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
  }, [filePath]);

  const clearZone = () => {
    const ed = editorRef.current;
    const zoneId = zoneIdRef.current;
    if (ed && zoneId) {
      ed.getModifiedEditor().changeViewZones((acc) => acc.removeZone(zoneId));
    }
    zoneIdRef.current = null;
  };

  const openCommentZone = (lineNumber: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    const modified = ed.getModifiedEditor();
    const lineText = modified.getModel()?.getLineContent(lineNumber) ?? "";

    clearZone();

    const dom = document.createElement("div");
    dom.className = "marblo-diff-comment-zone";
    dom.style.cssText =
      "background:#111827;border-left:2px solid #3b82f6;padding:8px 12px;font-family:inherit;";
    dom.innerHTML = `
      <div style="font-size:11px;color:#9ca3af;margin-bottom:6px;">
        ${t("workspace.diff.commentOn")} · ${escapeHtml(filePath)}:${lineNumber}
      </div>
      <textarea rows="2" placeholder="${escapeAttr(
        t("workspace.diff.commentPlaceholder")
      )}" style="width:100%;box-sizing:border-box;background:#0b0f19;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:6px;font-size:12px;resize:vertical;outline:none;"></textarea>
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px;">
        <button data-action="cancel" style="font-size:11px;padding:3px 10px;border-radius:4px;background:transparent;color:#9ca3af;border:1px solid #374151;cursor:pointer;">${escapeHtml(
          t("common.cancel")
        )}</button>
        <button data-action="send" style="font-size:11px;padding:3px 10px;border-radius:4px;background:#2563eb;color:#fff;border:0;cursor:pointer;">${escapeHtml(
          t("workspace.diff.sendToOrchestrator")
        )}</button>
      </div>
    `;

    const textarea = dom.querySelector("textarea") as HTMLTextAreaElement;
    const cancelBtn = dom.querySelector(
      '[data-action="cancel"]'
    ) as HTMLButtonElement;
    const sendBtn = dom.querySelector(
      '[data-action="send"]'
    ) as HTMLButtonElement;

    cancelBtn.addEventListener("click", () => clearZone());
    sendBtn.addEventListener("click", async () => {
      const comment = textarea.value.trim();
      if (!comment) return;
      sendBtn.disabled = true;
      sendBtn.textContent = t("orchestrator.sending");
      const { projectId, userId, userName } = routeCtxRef.current;
      const message = formatComment(filePath, lineNumber, lineText, comment);
      let result: RouteResult = "failed";
      if (projectId) {
        result = await routeInstructionToOrchestrator({
          projectId,
          message,
          fromUserId: userId,
          fromUserName: userName,
        });
      }
      clearZone();
      const toastKey =
        result === "local"
          ? "workspace.diff.sentLocal"
          : result === "queued"
          ? "workspace.diff.sentQueued"
          : "workspace.diff.sentFailed";
      setToast(t(toastKey));
      window.setTimeout(() => setToast(null), 3500);
    });

    modified.changeViewZones((acc) => {
      zoneIdRef.current = acc.addZone({
        afterLineNumber: lineNumber,
        heightInLines: 4,
        domNode: dom,
      });
    });
    // Focus after the zone lays out.
    window.setTimeout(() => textarea.focus(), 0);
  };

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
        if (line) openCommentZone(line);
      }
    });
    disposablesRef.current.push(d1);
  };

  // Lifecycle cleanup: drop the open zone + listeners when the file changes or
  // the surface unmounts (mirrors the watcher/listener teardown discipline the
  // shell uses elsewhere).
  useEffect(() => {
    return () => {
      clearZone();
      disposablesRef.current.forEach((d) => d.dispose());
      disposablesRef.current = [];
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
        {t("workspace.diff.gutterHint")}
      </div>
      {toast && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-100 shadow-lg ring-1 ring-gray-700">
          {toast}
        </div>
      )}
    </div>
  );
}

function formatComment(
  filePath: string,
  line: number,
  lineText: string,
  comment: string
): string {
  const snippet = lineText.trim();
  const lines = [`[Code review] ${filePath}:${line}`];
  if (snippet) lines.push(`> ${snippet}`);
  lines.push("", comment);
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
