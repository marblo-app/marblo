import { useState, useEffect, useCallback, useRef } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';
import { useAuth } from '../../hooks/useAuth';

// File icon by extension
function getFileIcon(name: string): { icon: string; color: string } {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, { icon: string; color: string }> = {
    ts: { icon: 'TS', color: 'text-blue-400' },
    tsx: { icon: 'TX', color: 'text-blue-300' },
    js: { icon: 'JS', color: 'text-yellow-400' },
    jsx: { icon: 'JX', color: 'text-yellow-300' },
    py: { icon: 'PY', color: 'text-green-400' },
    rs: { icon: 'RS', color: 'text-orange-400' },
    go: { icon: 'GO', color: 'text-cyan-400' },
    md: { icon: 'MD', color: 'text-gray-400' },
    json: { icon: '{}', color: 'text-yellow-500' },
    yaml: { icon: 'YM', color: 'text-pink-400' },
    yml: { icon: 'YM', color: 'text-pink-400' },
    html: { icon: '<>', color: 'text-orange-400' },
    css: { icon: '#', color: 'text-purple-400' },
    scss: { icon: '#', color: 'text-pink-400' },
    sql: { icon: 'SQ', color: 'text-blue-300' },
    sh: { icon: '$', color: 'text-green-300' },
    toml: { icon: 'TM', color: 'text-gray-400' },
    lock: { icon: 'LK', color: 'text-gray-500' },
  };
  return map[ext] || { icon: '  ', color: 'text-gray-500' };
}

// Git status color
function gitStatusColor(status?: string): string {
  if (!status) return '';
  switch (status) {
    case 'M': case 'MM': return 'text-orange-400';
    case 'A': case 'AM': return 'text-green-400';
    case 'D': return 'text-red-400';
    case '?': case '??': return 'text-gray-500';
    case 'R': return 'text-blue-400';
    default: return 'text-orange-400';
  }
}

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  gitStatuses: Record<string, string>;
}

function FileTreeNode({ node, depth, gitStatuses }: FileTreeNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const openFile = useEditorStore(s => s.openFile);
  const activeFilePath = useEditorStore(s => s.activeFilePath);

  const isActive = node.type === 'file' && node.path === activeFilePath;
  const gitStatus = gitStatuses[node.path];

  const handleClick = useCallback(() => {
    if (node.type === 'directory') {
      setIsOpen(!isOpen);
    } else {
      openFile(node.path);
    }
  }, [node, isOpen, openFile]);

  const statusColor = gitStatusColor(gitStatus);

  return (
    <div>
      <button
        onClick={handleClick}
        className={`flex w-full items-center gap-1 px-1 py-0.5 text-left text-[13px] hover:bg-gray-700 ${
          isActive ? 'bg-gray-700 text-white' : 'text-gray-300'
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {/* Expand/collapse arrow for directories */}
        {node.type === 'directory' ? (
          <svg
            className={`h-3.5 w-3.5 flex-shrink-0 text-gray-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}

        {/* Icon */}
        {node.type === 'directory' ? (
          <svg className="h-4 w-4 flex-shrink-0 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
            {isOpen ? (
              <path fillRule="evenodd" d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v1H8a3 3 0 00-2.83 2H4V6z" clipRule="evenodd" />
            ) : (
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            )}
          </svg>
        ) : (
          <span className={`flex-shrink-0 text-[10px] font-bold ${getFileIcon(node.name).color}`}>
            {getFileIcon(node.name).icon}
          </span>
        )}

        {/* Name */}
        <span className={`truncate ${statusColor}`}>
          {node.name}
        </span>

        {/* Git status indicator */}
        {gitStatus && (
          <span className={`ml-auto flex-shrink-0 text-[10px] font-bold ${statusColor}`}>
            {gitStatus.charAt(0)}
          </span>
        )}
      </button>

      {/* Children */}
      {node.type === 'directory' && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              gitStatuses={gitStatuses}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [gitStatuses, setGitStatuses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const rootPath = useEditorStore(s => s.rootPath);
  const setRootPath = useEditorStore(s => s.setRootPath);

  const { user } = useAuth();
  const setCurrentProject = useProjectStore(s => s.setCurrentProject);
  const findByFolderPath = useProjectStore(s => s.findByFolderPath);
  const createProject = useProjectStore(s => s.createProject);

  // Inline project creation state
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(null);
  const newProjectInputRef = useRef<HTMLInputElement>(null);

  const loadingRef = useRef(false);

  const loadTree = useCallback(async (dirPath: string, showLoading = true) => {
    if (loadingRef.current) return; // prevent concurrent runs
    loadingRef.current = true;
    if (showLoading) setLoading(true);
    try {
      const [nodes, statuses] = await Promise.all([
        window.electronAPI.fs.readTree(dirPath),
        window.electronAPI.fs.gitStatus(dirPath),
      ]);
      setTree(nodes);
      setGitStatuses(statuses);
    } catch (err) {
      console.error('Failed to load file tree:', err);
    } finally {
      loadingRef.current = false;
      if (showLoading) setLoading(false);
    }
  }, []);

  // Load tree and start watching when rootPath changes
  useEffect(() => {
    if (!rootPath) return;
    loadTree(rootPath, true);
    window.electronAPI.fs.watch(rootPath);

    // Listen for file changes (debounced, silent reload)
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => loadTree(rootPath, false), 2000);
    };
    window.electronAPI.fs.onFileChange(handler);

    return () => {
      if (timer) clearTimeout(timer);
      window.electronAPI.fs.offFileChange?.();
    };
  }, [rootPath, loadTree]);

  // Auto-focus the project name input when shown
  useEffect(() => {
    if (showNewProject && newProjectInputRef.current) {
      newProjectInputRef.current.focus();
      newProjectInputRef.current.select();
    }
  }, [showNewProject]);

  const handleSelectDirectory = useCallback(async () => {
    const dir = await window.electronAPI.fs.selectDirectory();
    if (!dir) return;

    setRootPath(dir);

    // Check if a project already exists for this folder
    const existing = findByFolderPath(dir);
    if (existing) {
      setCurrentProject(existing);
      return;
    }

    // Show inline project creation UI
    const folderName = dir.split('/').pop() || 'new-project';
    setNewProjectName(folderName);
    setPendingFolderPath(dir);
    setShowNewProject(true);
  }, [setRootPath, findByFolderPath, setCurrentProject]);

  const handleCreateInlineProject = useCallback(async () => {
    if (!newProjectName.trim() || !user || !pendingFolderPath) return;
    try {
      const id = await createProject({
        name: newProjectName.trim(),
        ownerId: user.uid,
        members: [user.uid],
        folderPath: pendingFolderPath,
      });
      // Find the newly created project from store (it may take a moment via subscription)
      // Set it optimistically
      setCurrentProject({
        id,
        name: newProjectName.trim(),
        ownerId: user.uid,
        members: [user.uid],
        folderPath: pendingFolderPath,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setShowNewProject(false);
      setNewProjectName('');
      setPendingFolderPath(null);
    }
  }, [newProjectName, user, pendingFolderPath, createProject, setCurrentProject]);

  const handleCancelInlineProject = useCallback(() => {
    setShowNewProject(false);
    setNewProjectName('');
    setPendingFolderPath(null);
  }, []);

  const handleRefresh = useCallback(() => {
    if (rootPath) loadTree(rootPath);
  }, [rootPath, loadTree]);

  if (!rootPath) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-4">
        <svg className="h-10 w-10 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <p className="mt-2 text-xs text-gray-500">프로젝트 열기</p>
        <button
          onClick={handleSelectDirectory}
          className="mt-2 rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
        >
          폴더 선택
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Inline project creation banner */}
      {showNewProject && (
        <div className="border-b border-blue-500/30 bg-blue-500/10 px-3 py-2">
          <p className="mb-1 text-[11px] font-medium text-blue-400">새 프로젝트</p>
          <div className="flex items-center gap-1">
            <input
              ref={newProjectInputRef}
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateInlineProject();
                if (e.key === 'Escape') handleCancelInlineProject();
              }}
              className="flex-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
              placeholder="프로젝트 이름"
            />
            <button
              onClick={handleCreateInlineProject}
              className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white hover:bg-blue-500"
              title="생성"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-[10px] text-gray-500">Enter로 생성 / Esc 취소</p>
        </div>
      )}

      {/* Project path header */}
      <div className="flex items-center gap-1 border-b border-gray-700 px-2 py-1">
        <span className="flex-1 truncate text-[11px] text-gray-400" title={rootPath}>
          {rootPath.split('/').pop()}
        </span>
        <button
          onClick={handleRefresh}
          className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
          title="새로고침"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
        <button
          onClick={handleSelectDirectory}
          className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
          title="다른 폴더 열기"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </button>
      </div>

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto py-1 pr-2">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <span className="text-xs text-gray-500">로딩 중...</span>
          </div>
        ) : (
          tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              gitStatuses={gitStatuses}
            />
          ))
        )}
      </div>
    </div>
  );
}
