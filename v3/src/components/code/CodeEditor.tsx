import { useCallback, useEffect, useRef, useState } from "react";
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
import { useCodeQuickAction } from "./useCodeQuickAction";
import { QuickActionPanel } from "./QuickActionPanel";
import { diffLines, summarizeDiff, type QuickActionId } from "./quickActions";

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

  // 경량 퀵액션(docs/CODE-QUICK-ACTIONS.md) — 선택 → 클릭 → 연결 CLI 1회.
  // 커서식 연속 자동완성이 아니라 온디맨드라 여기엔 타이핑 훅이 하나도 없다.
  const quick = useCodeQuickAction();
  const [applyNotice, setApplyNotice] = useState<string | null>(null);

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
  const languageRef = useRef(language);
  languageRef.current = language;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const runQuickRef = useRef(quick.run);
  runQuickRef.current = quick.run;

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
  // 퀵액션 `이거 고쳐` 의 인라인 diff. 같은 content-widget 패턴을 쓰는 이유도
  // 같다 — 제안일 뿐인 코드가 실제 줄을 아래로 밀면 안 된다.
  const diffWidgetRef = useRef<{
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

  const removeDiffWidget = useCallback(() => {
    const ed = editorRef.current;
    const entry = diffWidgetRef.current;
    if (ed && entry) ed.removeContentWidget(entry.widget);
    diffWidgetRef.current = null;
  }, []);

  /**
   * 퀵액션 실행. 선택이 비어 있으면(우클릭만 한 경우) 커서가 놓인 줄 하나를
   * 대상으로 삼는다 — 컨텍스트 메뉴에서 "이 줄 설명해줘" 가 자연스럽게 된다.
   *
   * 보내는 내용은 **디스크가 아니라 에디터 모델**이다. 저장 전 편집 중인 코드를
   * 물어보는 게 이 기능의 일상적인 쓰임이라, 디스크를 읽으면 사용자가 보고 있는
   * 것과 다른 코드를 설명하게 된다.
   */
  const runQuickAction = useCallback(
    (action: QuickActionId, startLine: number, endLine: number) => {
      const ed = editorRef.current;
      const model = ed?.getModel();
      if (!ed || !model) return;
      // 읽기 전용 표면(이미지/노트북/마크다운 미리보기의 내장 에디터)에서는
      // 적용할 수가 없다. 제안만 띄우고 [적용] 이 조용히 실패하느니 안 연다.
      if (action === "fix" && readOnlyRef.current) return;
      removeTrigger();
      removeComposer();
      removeDiffWidget();
      setApplyNotice(null);
      void runQuickRef.current({
        action,
        filePath: filePathRef.current,
        language: languageRef.current,
        content: model.getValue(),
        startLine: Math.min(startLine, endLine),
        endLine: Math.max(startLine, endLine),
      });
    },
    [removeComposer, removeDiffWidget, removeTrigger],
  );
  const runQuickActionRef = useRef(runQuickAction);
  runQuickActionRef.current = runQuickAction;

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

  // Auto "선택 시 미니 팝업" — a small floating toolbar anchored at the selection.
  // Shown whenever a non-empty selection exists and no composer is already open;
  // removed the moment the selection collapses.
  //
  // 세 버튼의 체급이 다르다: ✨ 둘은 **온디맨드 퀵액션**(연결 CLI 1회, 결과가
  // 이 에디터로 돌아온다)이고, ✦ 는 기존 오케스트레이터 요청(티켓·여러 파일급)
  // 이다. 퀵액션이 ✦ 를 대체하지 않으므로 둘 다 남긴다.
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
        // Reposition the existing toolbar to follow the growing selection.
        const entry = triggerRef.current;
        entry.dom.dataset.startLine = String(startLine);
        entry.dom.dataset.endLine = String(endLine);
        ed.layoutContentWidget(entry.widget);
        return;
      }

      const dom = document.createElement("div");
      dom.dataset.startLine = String(startLine);
      dom.dataset.endLine = String(endLine);
      dom.style.cssText =
        "display:flex;gap:4px;padding:3px;border-radius:6px;background:#111827;border:1px solid #374151;box-shadow:0 6px 16px rgba(0,0,0,.4);white-space:nowrap;";
      const stop = (e: Event) => e.stopPropagation();
      dom.addEventListener("mousedown", stop);

      const addButton = (
        label: string,
        primary: boolean,
        onPick: (start: number, end: number) => void,
      ) => {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.style.cssText = `font-size:11px;padding:3px 8px;border-radius:4px;border:0;cursor:pointer;white-space:nowrap;${
          primary
            ? "background:#2563eb;color:#fff;"
            : "background:transparent;color:#cbd5e1;"
        }`;
        btn.addEventListener("mousedown", stop);
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          onPick(Number(dom.dataset.startLine), Number(dom.dataset.endLine));
        });
        dom.appendChild(btn);
      };

      const tr = tRef.current;
      addButton(`✨ ${tr("code.quickAction.explain")}`, true, (s, e) =>
        runQuickActionRef.current("explain", s, e),
      );
      if (!readOnlyRef.current) {
        addButton(`✨ ${tr("code.quickAction.fix")}`, true, (s, e) =>
          runQuickActionRef.current("fix", s, e),
        );
      }
      addButton(`✦ ${tr("diff.comment.editAction")}`, false, (s, e) =>
        openComposerRef.current(s, e),
      );

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

    // 퀵액션은 우클릭 메뉴에도 둔다 — 플로팅 툴바를 못 보거나 마우스 습관이
    // 다른 사용자가 같은 자리에서 찾는다. `editorHasSelection` 을 걸지 않아
    // 커서만 놓고 "이 줄 설명해줘" 도 된다(runQuickAction 이 한 줄로 접는다).
    editor.addAction({
      id: "marblo.quickAction.explain",
      label: `✨ ${tRef.current("code.quickAction.explain")}`,
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1,
      run: (ed) => {
        const sel = ed.getSelection();
        const line = sel?.startLineNumber ?? ed.getPosition()?.lineNumber ?? 1;
        runQuickActionRef.current("explain", line, sel?.endLineNumber ?? line);
      },
    });

    editor.addAction({
      id: "marblo.quickAction.fix",
      label: `✨ ${tRef.current("code.quickAction.fix")}`,
      contextMenuGroupId: "navigation",
      contextMenuOrder: 2,
      run: (ed) => {
        const sel = ed.getSelection();
        const line = sel?.startLineNumber ?? ed.getPosition()?.lineNumber ?? 1;
        runQuickActionRef.current("fix", line, sel?.endLineNumber ?? line);
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

  /**
   * `이거 고쳐` 결과 → 선택 지점에 앵커된 **인라인 diff**.
   *
   * 파일은 아직 한 바이트도 안 바뀐 상태다. [적용] 을 눌러야 `executeEdits` 가
   * 그 범위를 치환하고, 그 편집은 기존 onChange → updateContent 경로를 타 더티
   * 표시가 뜬다(저장은 여전히 Cmd+S, 되돌리기는 Cmd+Z). [취소] 는 위젯만 걷는다.
   */
  const quickState = quick.state;
  const dismissQuick = quick.dismiss;
  useEffect(() => {
    removeDiffWidget();
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    const s = quickState;
    if (!ed || !monaco || !s) return;
    if (s.action !== "fix" || s.status !== "done" || s.replacement === null) {
      return;
    }
    // 결과가 도착하기 전에 다른 파일로 넘어갔다면 적용 대상이 없다.
    if (s.filePath !== filePath) return;

    const replacement = s.replacement;
    const rows = diffLines(s.original.split("\n"), replacement.split("\n"));
    const stat = summarizeDiff(rows);
    const tr = tRef.current;

    const dom = document.createElement("div");
    dom.className = "marblo-code-quick-diff";
    dom.style.cssText =
      "width:min(620px,calc(100vw - 48px));box-sizing:border-box;background:#111827;border:1px solid #374151;border-left:2px solid #22c55e;border-radius:6px;font-family:inherit;box-shadow:0 12px 28px rgba(0,0,0,.4);";
    const stop = (e: Event) => e.stopPropagation();
    dom.addEventListener("mousedown", stop);
    dom.addEventListener("click", stop);

    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #374151;";
    const title = document.createElement("span");
    title.style.cssText =
      "flex:1;min-width:0;font-size:11px;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    title.textContent = `✨ ${tr("code.quickAction.diffTitle", {
      start: s.startLine,
      end: s.endLine,
    })}`;
    const stats = document.createElement("span");
    stats.style.cssText = "font-size:11px;color:#9ca3af;white-space:nowrap;";
    stats.textContent = stat.unchanged
      ? tr("code.quickAction.diffNoChange")
      : tr("code.quickAction.diffStat", {
          added: stat.added,
          removed: stat.removed,
        });
    header.append(title, stats);

    const body = document.createElement("pre");
    body.style.cssText =
      "margin:0;max-height:320px;overflow:auto;padding:6px 0;font-family:inherit;font-size:12px;line-height:18px;";
    for (const row of rows) {
      const line = document.createElement("div");
      const marker = row.kind === "add" ? "+" : row.kind === "del" ? "−" : " ";
      const tone =
        row.kind === "add"
          ? "background:rgba(34,197,94,.14);color:#bbf7d0;"
          : row.kind === "del"
            ? "background:rgba(239,68,68,.14);color:#fecaca;"
            : "color:#9ca3af;";
      line.style.cssText = `padding:0 10px;white-space:pre-wrap;word-break:break-word;${tone}`;
      line.textContent = `${marker} ${row.text}`;
      body.appendChild(line);
    }

    const buttons = document.createElement("div");
    buttons.style.cssText =
      "display:flex;gap:6px;justify-content:flex-end;padding:6px 10px;border-top:1px solid #374151;";
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = tr("common.cancel");
    cancelBtn.style.cssText =
      "font-size:11px;padding:3px 10px;border-radius:4px;background:transparent;color:#9ca3af;border:1px solid #374151;cursor:pointer;";
    const applyBtn = document.createElement("button");
    applyBtn.textContent = tr("code.quickAction.apply");
    applyBtn.style.cssText =
      "font-size:11px;padding:3px 10px;border-radius:4px;background:#16a34a;color:#fff;border:0;cursor:pointer;";
    applyBtn.disabled = stat.unchanged;
    if (stat.unchanged) applyBtn.style.opacity = "0.5";
    buttons.append(cancelBtn, applyBtn);

    cancelBtn.addEventListener("click", () => {
      removeDiffWidget();
      dismissQuick();
      ed.focus();
    });
    applyBtn.addEventListener("click", () => {
      const model = ed.getModel();
      if (!model) return;
      const endLine = Math.min(s.endLine, model.getLineCount());
      const range = new monaco.Range(
        s.startLine,
        1,
        endLine,
        model.getLineMaxColumn(endLine),
      );
      // ★드리프트 가드: CLI 가 도는 몇 초 사이 사용자가 그 줄을 고쳤을 수 있다.
      // 줄번호만 믿고 치환하면 방금 쓴 코드를 말없이 덮어쓴다.
      if (model.getValueInRange(range) !== s.original) {
        setApplyNotice(tr("code.quickAction.rangeDrifted"));
        removeDiffWidget();
        dismissQuick();
        return;
      }
      ed.pushUndoStop();
      ed.executeEdits("marblo.quickAction", [
        { range, text: replacement, forceMoveMarkers: true },
      ]);
      ed.pushUndoStop();
      removeDiffWidget();
      dismissQuick();
      ed.focus();
    });

    dom.append(header, body, buttons);

    const pref = monaco.editor.ContentWidgetPositionPreference;
    const widget: editor.IContentWidget = {
      getId: () => "marblo.quickActionDiff",
      getDomNode: () => dom,
      getPosition: () => ({
        position: { lineNumber: s.startLine, column: 1 },
        preference: pref ? [pref.BELOW, pref.ABOVE] : [],
      }),
    };
    diffWidgetRef.current = { widget, dom };
    ed.addContentWidget(widget);

    return () => removeDiffWidget();
  }, [quickState, filePath, removeDiffWidget, dismissQuick]);

  // 적용 실패 안내는 잠깐만 띄운다 — 남아 있으면 다음 액션의 상태로 오해된다.
  useEffect(() => {
    if (!applyNotice) return;
    const id = window.setTimeout(() => setApplyNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [applyNotice]);

  // Drop the open composer + mini popup when the file changes or the editor
  // unmounts, so a stale widget never lingers over the next file.
  //
  // 진행 중이던 퀵액션도 함께 접는다: 결과는 **떠날 때 보던 파일**의 특정
  // 줄 범위에 대한 것이라, 다른 파일 위에 남겨두면 적용할 곳이 없다.
  useEffect(() => {
    removeComposer();
    removeTrigger();
    dismissQuick();
  }, [filePath, dismissQuick, removeComposer, removeTrigger]);
  useEffect(() => {
    return () => {
      removeComposer();
      removeTrigger();
      removeDiffWidget();
      try {
        editorRef.current?.setModel(null);
      } catch {
        // Monaco may already be disposing during HMR or rapid tab teardown.
      }
      editorRef.current = null;
    };
  }, [removeComposer, removeDiffWidget, removeTrigger]);

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
      {quickState && (
        <QuickActionPanel
          state={quickState}
          onDismiss={dismissQuick}
          onOpenCliSetup={quick.openCliSetup}
        />
      )}
      {(toast || applyNotice) && (
        <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-100 shadow-lg ring-1 ring-gray-700">
          {applyNotice ?? toast}
        </div>
      )}
    </div>
  );
}
