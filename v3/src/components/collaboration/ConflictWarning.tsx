import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import type { ActiveEditor } from '../../types/collaboration';
import { subscribeToActiveEditors } from '../../services/collaborationService';

interface ConflictWarningProps {
  projectId: string;
  currentFilePath: string;
}

export function ConflictWarning({ projectId, currentFilePath }: ConflictWarningProps) {
  const { user } = useAuth();
  const [conflictEditors, setConflictEditors] = useState<ActiveEditor[]>([]);

  useEffect(() => {
    if (!projectId) return;

    const unsubscribe = subscribeToActiveEditors(projectId, (editors) => {
      const others = editors.filter(
        (e) => e.userId !== user?.uid && e.filePath === currentFilePath,
      );
      setConflictEditors(others);
    });

    return unsubscribe;
  }, [projectId, currentFilePath, user?.uid]);

  if (conflictEditors.length === 0) return null;

  return (
    <div className="flex items-center gap-2 border-b border-yellow-600/30 bg-yellow-900/30 px-4 py-2">
      <svg
        className="h-4 w-4 flex-shrink-0 text-yellow-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>
      <span className="text-sm text-yellow-300">
        {conflictEditors.map((e) => e.displayName).join(', ')}
        {conflictEditors.length === 1
          ? ' 님이 이 파일을 수정 중입니다'
          : ' 님이 이 파일을 수정 중입니다'}
      </span>
    </div>
  );
}
