import { useCallback, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEditorStore } from "../../stores/editorStore";
import { MONO_FONT_FAMILY } from "../../lib/monoFont";

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
  const updateContent = useEditorStore((s) => s.updateContent);
  const saveFile = useEditorStore((s) => s.saveFile);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

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
  // save the file currently on screen.
  const formatAndSaveRef = useRef(formatAndSave);
  formatAndSaveRef.current = formatAndSave;
  const formatOnlyRef = useRef(formatOnly);
  formatOnlyRef.current = formatOnly;

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;

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

  return (
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
  );
}
