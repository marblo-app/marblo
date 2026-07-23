import { useCallback, useEffect, useRef } from "react";
import Editor, { type OnMount, type Monaco } from "@monaco-editor/react";
import type { editor, Selection as MonacoSelection } from "monaco-editor";
import { useEditorStore } from "../../stores/editorStore";
import { MONO_FONT_FAMILY } from "../../lib/monoFont";
import { useTranslation } from "../../lib/i18n";
import { useOrchestratorDiffComment } from "../../hooks/useOrchestratorDiffComment";
import {
  buildRangeFromLines,
  formatRangeLabel,
  type DiffCommentRange,
} from "../../lib/diffComment";

interface CodeEditorProps {
  filePath: string;
  content: string;
  language: string;
  readOnly?: boolean;
}

export function CodeEditor({
  filePath,
  content,
  language,
  readOnly = false,
}: CodeEditorProps) {
  const { t } = useTranslation();
  const updateContent = useEditorStore((s) => s.updateContent);
  const saveFile = useEditorStore((s) => s.saveFile);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // "이 코드를 오케에게 수정 요청" — reuses the exact send path DiffSurface uses
  // (routeInstructionToOrchestrator + formatDiffComment), so no new IPC and no
  // drift from the diff-tab comment flow. `send` is referentially stable; we
  // still route it through a ref because Monaco handlers register once on mount.
  const { send, toast } = useOrchestratorDiffComment();

  const formatAndSave = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || readOnly) return;
    const currentContent = ed.getValue();
    const { formatted, error } = await window.electronAPI.code.format(
      currentContent,
      filePath,
    );
    if (!error && formatted !== currentContent) {
      const pos = ed.getPosition();
      updateContent(filePath, formatted);
      ed.setValue(formatted);
      if (pos) ed.setPosition(pos);
    }
    saveFile(filePath);
  }, [filePath, readOnly, saveFile, updateContent]);

  const formatOnly = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || readOnly) return;
    const currentContent = ed.getValue();
    const { formatted, error } = await window.electronAPI.code.format(
      currentContent,
      filePath,
    );
    if (!error && formatted !== currentContent) {
      const pos = ed.getPosition();
      updateContent(filePath, formatted);
      ed.setValue(formatted);
      if (pos) ed.setPosition(pos);
    }
  }, [filePath, readOnly, updateContent]);

  // @monaco-editor/react registers `onMount` exactly once per editor instance,
  // and this editor is reused across every open file (CodeTab renders
  // <CodeEditor> without a per-file key, and we pass no `path` prop, so Monaco
  // swaps content into a single shared model). If the Cmd+S action closed over
  // `formatAndSave` directly it would capture the FIRST file's `filePath`
  // forever — after switching files, Cmd+S would then call saveFile() with the
  // stale path, that (unmodified) file would early-return, and the edit to the
  // visible file would silently never hit disk. Routing through a ref that we
  // keep pointed at the latest callback makes the once-registered action always
  // save the file currently on screen. The same reason applies to filePath +
  // send below (used by the "request edit" composer).
  const formatAndSaveRef = useRef(formatAndSave);
  formatAndSaveRef.current = formatAndSave;
  const formatOnlyRef = useRef(formatOnly);
  formatOnlyRef.current = formatOnly;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const tRef = useRef(t);
  tRef.current = t;
  const sendRef = useRef(send);
  sendRef.current = send;

  // The floating composer + the auto "선택 시 미니 팝업" trigger are Monaco
  // content widgets (overlays that float over the text rather than pushing it
  // down — this editor is editable, so a view zone would shift real content).
  const composerRef = useRef<{
    widget: editor.IContentWidget;
    dom: HTMLElement;
  } | null>(null);
  const triggerRef = useRef<{
    widget: editor.IContentWidget;
    dom: HTMLElement;
  } | null>(null);

  const removeComposer = useCallback(() => {
    const ed = editorRef.current;
    const entry = composerRef.current;
    if (ed && entry) ed.removeContentWidget(entry.widget);
    composerRef.current = null;
  }, []);

  const removeTrigger = useCallback(() => {
    const ed = editorRef.current;
    const entry = triggerRef.current;
    if (ed && entry) ed.removeContentWidget(entry.widget);
    triggerRef.current = null;
  }, []);

  // Open the fix-request composer for a line RANGE. The context menu passes the
  // current selection; the mini popup passes the same. A collapsed selection
  // (plain right-click) targets that single line.
  const openComposer = useCallback(
    (startLine: number, endLine: number) => {
      const ed = editorRef.current;
      if (!ed) return;
      const model = ed.getModel();
      if (!model) return;

      removeTrigger();
      removeComposer();

      const range: DiffCommentRange = buildRangeFromLines(
        filePathRef.current,
        startLine,
        endLine,
        (line) => model.getLineContent(line),
      );
      const tr = tRef.current;

      const dom = document.createElement("div");
      dom.className = "marblo-code-edit-request";
      dom.style.cssText =
        "width:min(520px,calc(100vw - 48px));box-sizing:border-box;background:#111827;border:1px solid #374151;border-left:2px solid #3b82f6;border-radius:6px;padding:8px 12px;font-family:inherit;box-shadow:0 12px 28px rgba(0,0,0,.35);";

      const label = document.createElement("div");
      label.style.cssText =
        "font-size:11px;color:#9ca3af;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      label.textContent = `${tr("diff.comment.editAction")} · ${formatRangeLabel(range)}`;

      const textarea = document.createElement("textarea");
      textarea.rows = 2;
      textarea.placeholder = tr("diff.comment.editPlaceholder");
      textarea.style.cssText =
        "width:100%;box-sizing:border-box;background:#0b0f19;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:6px;font-size:12px;resize:vertical;outline:none;";

      const buttons = document.createElement("div");
      buttons.style.cssText =
        "display:flex;gap:6px;justify-content:flex-end;margin-top:6px;";

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = tr("common.cancel");
      cancelBtn.style.cssText =
        "font-size:11px;padding:3px 10px;border-radius:4px;background:transparent;color:#9ca3af;border:1px solid #374151;cursor:pointer;";

      const sendBtn = document.createElement("button");
      sendBtn.textContent = tr("diff.comment.send");
      sendBtn.style.cssText =
        "font-size:11px;padding:3px 10px;border-radius:4px;background:#2563eb;color:#fff;border:0;cursor:pointer;";

      buttons.append(cancelBtn, sendBtn);
      dom.append(label, textarea, buttons);

      // Keep clicks/keys inside the composer from reaching the editor.
      const stop = (e: Event) => e.stopPropagation();
      dom.addEventListener("mousedown", stop);
      dom.addEventListener("click", stop);

      const submit = () => {
        const comment = textarea.value.trim();
        if (!comment || sendBtn.disabled) return;
        sendBtn.disabled = true;
        sendBtn.textContent = tr("orchestrator.sending");
        removeComposer();
        void sendRef.current(range, comment);
      };

      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          removeComposer();
          ed.focus();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          submit();
        }
      });
      cancelBtn.addEventListener("click", () => {
        removeComposer();
        ed.focus();
      });
      sendBtn.addEventListener("click", submit);

      const line = Math.min(startLine, endLine);
      const pref = monacoRef.current?.editor.ContentWidgetPositionPreference;
      const widget: editor.IContentWidget = {
        getId: () => "marblo.codeEditRequestComposer",
        getDomNode: () => dom,
        getPosition: () => ({
          position: { lineNumber: line, column: 1 },
          preference: pref ? [pref.ABOVE, pref.BELOW] : [],
        }),
      };
      composerRef.current = { widget, dom };
      ed.addContentWidget(widget);
      window.setTimeout(() => textarea.focus(), 0);
    },
    [removeComposer, removeTrigger],
  );
  const openComposerRef = useRef(openComposer);
  openComposerRef.current = openComposer;

  // Auto "선택 시 미니 팝업" — a small floating button anchored at the selection
  // that opens the composer. Shown whenever a non-empty selection exists and no
  // composer is already open; removed the moment the selection collapses.
  const syncTrigger = useCallback(
    (selection: MonacoSelection | null) => {
      const ed = editorRef.current;
      if (!ed) return;
      const empty =
        !selection ||
        (selection.startLineNumber === selection.endLineNumber &&
          selection.startColumn === selection.endColumn);
      if (empty || composerRef.current) {
        removeTrigger();
        return;
      }

      const startLine = selection.startLineNumber;
      const endLine = selection.endLineNumber;

      if (triggerRef.current) {
        // Reposition the existing button to follow the growing selection.
        const entry = triggerRef.current;
        entry.dom.dataset.startLine = String(startLine);
        entry.dom.dataset.endLine = String(endLine);
        ed.layoutContentWidget(entry.widget);
        return;
      }

      const dom = document.createElement("button");
      dom.textContent = `✦ ${tRef.current("diff.comment.editAction")}`;
      dom.dataset.startLine = String(startLine);
      dom.dataset.endLine = String(endLine);
      dom.style.cssText =
        "font-size:11px;padding:3px 8px;border-radius:4px;background:#2563eb;color:#fff;border:0;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.35);white-space:nowrap;";
      const stop = (e: Event) => e.stopPropagation();
      dom.addEventListener("mousedown", stop);
      dom.addEventListener("click", (e) => {
        e.stopPropagation();
        openComposerRef.current(
          Number(dom.dataset.startLine),
          Number(dom.dataset.endLine),
        );
      });

      const widget: editor.IContentWidget = {
        getId: () => "marblo.codeEditRequestTrigger",
        getDomNode: () => dom,
        getPosition: () => {
          const s = Number(dom.dataset.startLine);
          const e = Number(dom.dataset.endLine);
          const pref =
            monacoRef.current?.editor.ContentWidgetPositionPreference;
          return {
            position: {
              lineNumber: Math.min(s, e),
              column: 1,
            },
            preference: pref ? [pref.BELOW, pref.ABOVE] : [],
          };
        },
      };
      triggerRef.current = { widget, dom };
      ed.addContentWidget(widget);
    },
    [removeTrigger],
  );
  const syncTriggerRef = useRef(syncTrigger);
  syncTriggerRef.current = syncTrigger;

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Cmd+S / Ctrl+S — format + save
    editor.addAction({
      id: "format-and-save",
      label: "Format and Save",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        formatAndSaveRef.current();
      },
    });

    // Cmd+Shift+F / Ctrl+Shift+F — format only
    editor.addAction({
      id: "format-code",
      label: "Format Code",
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
      ],
      run: () => {
        formatOnlyRef.current();
      },
    });

    // Select code → right-click → "오케에게 수정 요청". Quotes the selection
    // (file:line + snippet, worktree-absolute path included) and routes it to
    // the orchestrator through the shared diff-comment send path.
    editor.addAction({
      id: "marblo.requestEditFromOrchestrator",
      label: tRef.current("diff.comment.editAction"),
      contextMenuGroupId: "navigation",
      contextMenuOrder: 0,
      precondition: "editorHasSelection",
      run: (ed) => {
        const sel = ed.getSelection();
        if (!sel) return;
        openComposerRef.current(sel.startLineNumber, sel.endLineNumber);
      },
    });

    // Auto mini popup follows the live selection.
    editor.onDidChangeCursorSelection((e) => {
      syncTriggerRef.current(e.selection);
    });

    editor.focus();
  }, []);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined && !readOnly) {
        updateContent(filePath, value);
      }
    },
    [filePath, readOnly, updateContent],
  );

  // Drop the open composer + mini popup when the file changes or the editor
  // unmounts, so a stale widget never lingers over the next file.
  useEffect(() => {
    removeComposer();
    removeTrigger();
  }, [filePath, removeComposer, removeTrigger]);
  useEffect(() => {
    return () => {
      removeComposer();
      removeTrigger();
    };
  }, [removeComposer, removeTrigger]);

  return (
    <div className="relative h-full">
      <Editor
        height="100%"
        language={language}
        value={content}
        theme="vs-dark"
        onChange={handleChange}
        onMount={handleMount}
        options={{
          readOnly,
          minimap: { enabled: true, scale: 1, showSlider: "mouseover" },
          fontSize: 13,
          // Match the terminals' stack. Without this Monaco uses its per-platform
          // default (Consolas on Windows), looking different from the terminals and
          // missing Cascadia Code when installed.
          fontFamily: MONO_FONT_FAMILY,
          lineHeight: 20,
          padding: { top: 8 },
          scrollBeyondLastLine: false,
          wordWrap: "off",
          tabSize: 2,
          renderWhitespace: "selection",
          bracketPairColorization: { enabled: true },
          automaticLayout: true,
          guides: { bracketPairs: true, indentation: true },
          stickyScroll: { enabled: true },
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
        }}
      />
      {toast && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-100 shadow-lg ring-1 ring-gray-700">
          {toast}
        </div>
      )}
    </div>
  );
}
