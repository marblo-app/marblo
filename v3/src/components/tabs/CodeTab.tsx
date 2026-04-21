import { useEditorStore } from '../../stores/editorStore';
import { EditorTabs } from '../code/EditorTabs';
import { CodeEditor } from '../code/CodeEditor';
import { DiffViewer } from '../code/DiffViewer';

export function CodeTab() {
  const openFiles = useEditorStore(s => s.openFiles);
  const activeFilePath = useEditorStore(s => s.activeFilePath);
  const showDiff = useEditorStore(s => s.showDiff);

  const activeFile = openFiles.find(f => f.path === activeFilePath);

  return (
    <div className="flex h-full flex-col">
      {/* Editor tabs */}
      <EditorTabs />

      {/* Editor content */}
      <div className="flex-1 overflow-hidden">
        {activeFile ? (
          showDiff ? (
            <DiffViewer
              filePath={activeFile.path}
              language={activeFile.language}
              currentContent={activeFile.content}
            />
          ) : (
            <CodeEditor
              filePath={activeFile.path}
              content={activeFile.content}
              language={activeFile.language}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-gray-400">
            <div className="text-center">
              <svg className="mx-auto h-16 w-16 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <p className="mt-4 text-lg font-medium">파일을 선택하세요</p>
              <p className="mt-1 text-sm text-gray-500">사이드바에서 파일을 클릭하면 여기에 표시됩니다</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
