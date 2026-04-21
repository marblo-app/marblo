import { useCallback, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useEditorStore } from '../../stores/editorStore';

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

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;

    // Cmd+S / Ctrl+S to save
    editor.addAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        if (!readOnly) {
          saveFile(filePath);
        }
      },
    });

    editor.focus();
  }, [filePath, readOnly, saveFile]);

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
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 20,
        padding: { top: 8 },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        tabSize: 2,
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        automaticLayout: true,
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      }}
    />
  );
}
