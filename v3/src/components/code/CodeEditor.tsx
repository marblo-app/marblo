import { useCallback, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useEditorStore } from '../../stores/editorStore';
import { MONO_FONT_FAMILY } from '../../lib/monoFont';

interface CodeEditorProps {
  filePath: string;
  content: string;
  language: string;
  readOnly?: boolean;
}

export function CodeEditor({ filePath, content, language, readOnly = false }: CodeEditorProps) {
  const updateContent = useEditorStore(s => s.updateContent);
  const saveFile = useEditorStore(s => s.saveFile);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const formatAndSave = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || readOnly) return;
    const currentContent = ed.getValue();
    const { formatted, error } = await window.electronAPI.code.format(currentContent, filePath);
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
    const { formatted, error } = await window.electronAPI.code.format(currentContent, filePath);
    if (!error && formatted !== currentContent) {
      const pos = ed.getPosition();
      updateContent(filePath, formatted);
      ed.setValue(formatted);
      if (pos) ed.setPosition(pos);
    }
  }, [filePath, readOnly, updateContent]);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;

    // Cmd+S / Ctrl+S — format + save
    editor.addAction({
      id: 'format-and-save',
      label: 'Format and Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => { formatAndSave(); },
    });

    // Cmd+Shift+F / Ctrl+Shift+F — format only
    editor.addAction({
      id: 'format-code',
      label: 'Format Code',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
      run: () => { formatOnly(); },
    });

    editor.focus();
  }, [formatAndSave, formatOnly]);

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined && !readOnly) {
      updateContent(filePath, value);
    }
  }, [filePath, readOnly, updateContent]);

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
        minimap: { enabled: true, scale: 1, showSlider: 'mouseover' },
        fontSize: 13,
        // Match the terminals' stack. Without this Monaco uses its per-platform
        // default (Consolas on Windows), looking different from the terminals and
        // missing Cascadia Code when installed.
        fontFamily: MONO_FONT_FAMILY,
        lineHeight: 20,
        padding: { top: 8 },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        tabSize: 2,
        renderWhitespace: 'selection',
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
