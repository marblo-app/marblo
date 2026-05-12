import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  KeyboardEvent,
} from "react";
import { useEditorStore } from "../../stores/editorStore";
import { useProjectStore } from "../../stores/projectStore";
import type { Project } from "../../types/project";
import { useFileTreeStore } from "../../stores/fileTreeStore";
import { useAuth } from "../../hooks/useAuth";
import { FileTreeContextMenu, ContextMenuItem } from "./FileTreeContextMenu";
import { FileTreeConfirmDialog } from "./FileTreeConfirmDialog";

// File icon by extension
function getFileIcon(name: string): { icon: string; color: string } {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, { icon: string; color: string }> = {
    ts: { icon: "TS", color: "text-blue-400" },
    tsx: { icon: "TX", color: "text-blue-300" },
    js: { icon: "JS", color: "text-yellow-400" },
    jsx: { icon: "JX", color: "text-yellow-300" },
    py: { icon: "PY", color: "text-green-400" },
    rs: { icon: "RS", color: "text-orange-400" },
    go: { icon: "GO", color: "text-cyan-400" },
    md: { icon: "MD", color: "text-gray-400" },
    json: { icon: "{}", color: "text-yellow-500" },
    yaml: { icon: "YM", color: "text-pink-400" },
    yml: { icon: "YM", color: "text-pink-400" },
    html: { icon: "<>", color: "text-orange-400" },
    css: { icon: "#", color: "text-purple-400" },
    scss: { icon: "#", color: "text-pink-400" },
    sql: { icon: "SQ", color: "text-blue-300" },
    sh: { icon: "$", color: "text-green-300" },
    toml: { icon: "TM", color: "text-gray-400" },
    lock: { icon: "LK", color: "text-gray-500" },
  };
  return map[ext] || { icon: "  ", color: "text-gray-500" };
}

// Git status color
function gitStatusColor(status?: string): string {
  if (!status) return "";
  switch (status) {
    case "M":
    case "MM":
      return "text-orange-400";
    case "A":
    case "AM":
      return "text-green-400";
    case "D":
      return "text-red-400";
    case "?":
    case "??":
      return "text-gray-500";
    case "R":
      return "text-blue-400";
    default:
      return "text-orange-400";
  }
}

function basename(p: string): string {
  return p.split("/").pop() || p;
}

function dirname(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(0, idx);
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

// Pending creation state — used to show an inline input under a directory
type PendingCreate = {
  parentPath: string;
  type: "file" | "directory";
};

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  gitStatuses: Record<string, string>;
  expanded: Set<string>;
  toggleExpanded: (p: string) => void;
  renamingPath: string | null;
  setRenamingPath: (p: string | null) => void;
  pendingCreate: PendingCreate | null;
  setPendingCreate: (p: PendingCreate | null) => void;
  onCommitRename: (oldPath: string, newName: string) => Promise<void>;
  onCommitCreate: (
    parentPath: string,
    name: string,
    type: "file" | "directory",
  ) => Promise<void>;
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void;
  onMoveByDrop: (sourcePath: string, targetDir: string) => Promise<void>;
}

function FileTreeNode({
  node,
  depth,
  gitStatuses,
  expanded,
  toggleExpanded,
  renamingPath,
  setRenamingPath,
  pendingCreate,
  setPendingCreate,
  onCommitRename,
  onCommitCreate,
  onContextMenu,
  onMoveByDrop,
}: FileTreeNodeProps) {
  const openFile = useEditorStore((s) => s.openFile);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const selectedPath = useFileTreeStore((s) => s.selectedPath);
  const setSelected = useFileTreeStore((s) => s.setSelected);
  const clipboardOp = useFileTreeStore((s) => s.clipboardOp);
  const clipboardPath = useFileTreeStore((s) => s.clipboardPath);

  const isOpen = expanded.has(node.path);
  const isActive = node.type === "file" && node.path === activeFilePath;
  const isSelected = node.path === selectedPath;
  const isCutGhost = clipboardOp === "cut" && clipboardPath === node.path;
  const isRenaming = renamingPath === node.path;
  const gitStatus = gitStatuses[node.path];
  const statusColor = gitStatusColor(gitStatus);

  const [renameValue, setRenameValue] = useState(node.name);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameCommittedRef = useRef(false);

  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(node.name);
      renameCommittedRef.current = false;
      requestAnimationFrame(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus();
          // Select name without extension (VSCode behavior)
          const dot = node.name.lastIndexOf(".");
          if (dot > 0 && node.type === "file") {
            renameInputRef.current.setSelectionRange(0, dot);
          } else {
            renameInputRef.current.select();
          }
        }
      });
    }
  }, [isRenaming, node.name, node.type]);

  const handleClick = useCallback(() => {
    setSelected(node.path);
    if (node.type === "directory") {
      toggleExpanded(node.path);
    } else {
      openFile(node.path);
    }
  }, [node, toggleExpanded, openFile, setSelected]);

  const commitRename = useCallback(async () => {
    if (renameCommittedRef.current) return;
    renameCommittedRef.current = true;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === node.name) {
      setRenamingPath(null);
      return;
    }
    await onCommitRename(node.path, trimmed);
    setRenamingPath(null);
  }, [renameValue, node, onCommitRename, setRenamingPath]);

  // Drag handlers
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/marblo-filetree-path", node.path);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (node.type !== "directory") return;
    const sourcePath = e.dataTransfer.types.includes(
      "text/marblo-filetree-path",
    );
    if (!sourcePath) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dragOver) setDragOver(true);
  };

  const handleDragLeave = () => {
    if (dragOver) setDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    if (node.type !== "directory") return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const sourcePath = e.dataTransfer.getData("text/marblo-filetree-path");
    if (!sourcePath) return;
    if (sourcePath === node.path) return;
    await onMoveByDrop(sourcePath, node.path);
  };

  // Render the row
  const showInlineCreate =
    pendingCreate && pendingCreate.parentPath === node.path && isOpen;

  return (
    <div>
      <div
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSelected(node.path);
          onContextMenu(e, node);
        }}
        className={`group flex w-full items-center gap-1 px-1 py-0.5 text-[13px] ${
          isSelected
            ? "bg-blue-600/30 text-white"
            : isActive
              ? "bg-gray-700 text-white"
              : "text-gray-300 hover:bg-gray-700"
        } ${isCutGhost ? "opacity-50" : ""} ${
          dragOver ? "ring-1 ring-inset ring-blue-500" : ""
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {/* Expand/collapse arrow */}
        {node.type === "directory" ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(node.path);
              setSelected(node.path);
            }}
            className="flex flex-shrink-0 items-center"
          >
            <svg
              className={`h-3.5 w-3.5 text-gray-500 transition-transform ${
                isOpen ? "rotate-90" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}

        {/* Icon */}
        {node.type === "directory" ? (
          <svg
            className="h-4 w-4 flex-shrink-0 text-yellow-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            {isOpen ? (
              <path
                fillRule="evenodd"
                d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v1H8a3 3 0 00-2.83 2H4V6z"
                clipRule="evenodd"
              />
            ) : (
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            )}
          </svg>
        ) : (
          <span
            className={`flex-shrink-0 text-[10px] font-bold ${
              getFileIcon(node.name).color
            }`}
          >
            {getFileIcon(node.name).icon}
          </span>
        )}

        {/* Name or rename input */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setRenamingPath(null);
              }
              e.stopPropagation();
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 rounded border border-blue-500 bg-gray-900 px-1 py-0 text-[13px] text-white outline-none"
          />
        ) : (
          <button
            onClick={handleClick}
            onDoubleClick={(e) => {
              if (node.type === "directory") return;
              e.stopPropagation();
              openFile(node.path);
            }}
            className="flex flex-1 items-center gap-1 truncate text-left"
          >
            <span className={`truncate ${statusColor}`}>{node.name}</span>
            {gitStatus && (
              <span
                className={`ml-auto flex-shrink-0 text-[10px] font-bold ${statusColor}`}
              >
                {gitStatus.charAt(0)}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Inline new-file/folder input (shown when this directory is the parent) */}
      {showInlineCreate && (
        <InlineCreateInput
          depth={depth + 1}
          type={pendingCreate.type}
          onCommit={async (name) => {
            await onCommitCreate(node.path, name, pendingCreate.type);
            setPendingCreate(null);
          }}
          onCancel={() => setPendingCreate(null)}
        />
      )}

      {/* Children */}
      {node.type === "directory" && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              gitStatuses={gitStatuses}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
              renamingPath={renamingPath}
              setRenamingPath={setRenamingPath}
              pendingCreate={pendingCreate}
              setPendingCreate={setPendingCreate}
              onCommitRename={onCommitRename}
              onCommitCreate={onCommitCreate}
              onContextMenu={onContextMenu}
              onMoveByDrop={onMoveByDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface InlineCreateInputProps {
  depth: number;
  type: "file" | "directory";
  onCommit: (name: string) => Promise<void>;
  onCancel: () => void;
}

function InlineCreateInput({
  depth,
  type,
  onCommit,
  onCancel,
}: InlineCreateInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commit = useCallback(async () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = value.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    await onCommit(trimmed);
  }, [value, onCommit, onCancel]);

  return (
    <div
      className="flex items-center gap-1 px-1 py-0.5"
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
    >
      <span className="w-3.5 flex-shrink-0" />
      {type === "directory" ? (
        <svg
          className="h-4 w-4 flex-shrink-0 text-yellow-500"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
      ) : (
        <span className="flex-shrink-0 text-[10px] font-bold text-gray-500">
          {" "}
        </span>
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
          e.stopPropagation();
        }}
        onBlur={commit}
        placeholder={type === "directory" ? "폴더 이름" : "파일 이름"}
        className="flex-1 rounded border border-blue-500 bg-gray-900 px-1 py-0 text-[13px] text-white outline-none"
      />
    </div>
  );
}

export function FileTree() {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [gitStatuses, setGitStatuses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileNode | null;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const rootPath = useEditorStore((s) => s.rootPath);
  const setRootPath = useEditorStore((s) => s.setRootPath);
  const handlePathRenamed = useEditorStore((s) => s.handlePathRenamed);
  const handlePathRemoved = useEditorStore((s) => s.handlePathRemoved);
  const openFile = useEditorStore((s) => s.openFile);

  const selectedPath = useFileTreeStore((s) => s.selectedPath);
  const setSelected = useFileTreeStore((s) => s.setSelected);
  const clipboardOp = useFileTreeStore((s) => s.clipboardOp);
  const clipboardPath = useFileTreeStore((s) => s.clipboardPath);
  const copyToClipboard = useFileTreeStore((s) => s.copyToClipboard);
  const cutToClipboard = useFileTreeStore((s) => s.cutToClipboard);
  const clearClipboard = useFileTreeStore((s) => s.clearClipboard);

  const { user } = useAuth();
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const findByPathOrRemote = useProjectStore((s) => s.findByPathOrRemote);
  const createProject = useProjectStore((s) => s.createProject);

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(
    null,
  );
  const [pendingGitRemoteUrl, setPendingGitRemoteUrl] = useState<string | null>(
    null,
  );
  const newProjectInputRef = useRef<HTMLInputElement>(null);

  const loadingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build a flat lookup of all paths in the tree (for keyboard navigation + node lookup)
  const flatNodes = useMemo(() => {
    const map = new Map<string, FileNode>();
    const walk = (nodes: FileNode[]) => {
      for (const n of nodes) {
        map.set(n.path, n);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  const loadTree = useCallback(async (dirPath: string, showLoading = true) => {
    if (loadingRef.current) return;
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
      console.error("Failed to load file tree:", err);
    } finally {
      loadingRef.current = false;
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!rootPath) return;
    loadTree(rootPath, true);
    window.electronAPI.fs.watch(rootPath);

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

  useEffect(() => {
    if (showNewProject && newProjectInputRef.current) {
      newProjectInputRef.current.focus();
      newProjectInputRef.current.select();
    }
  }, [showNewProject]);

  // Auto-dismiss error toast
  useEffect(() => {
    if (!errorMessage) return;
    const t = setTimeout(() => setErrorMessage(null), 3500);
    return () => clearTimeout(t);
  }, [errorMessage]);

  const expandPath = useCallback((p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(p);
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  // Resolve which directory a new item should land in, given the current selection.
  // - No selection or selection outside tree → root
  // - Selected directory → that directory
  // - Selected file → its parent directory
  const resolveTargetDirectory = useCallback(
    (selected: string | null): string => {
      if (!rootPath) return "";
      if (!selected) return rootPath;
      const node = flatNodes.get(selected);
      if (!node) return rootPath;
      if (node.type === "directory") return node.path;
      return dirname(node.path);
    },
    [rootPath, flatNodes],
  );

  // ---------- File operation handlers ----------
  const handleCreate = useCallback(
    (type: "file" | "directory", parentDir?: string) => {
      const dir = parentDir ?? resolveTargetDirectory(selectedPath);
      if (!dir) return;
      // Make sure the parent is expanded so the input is visible
      expandPath(dir);
      setPendingCreate({ parentPath: dir, type });
    },
    [selectedPath, resolveTargetDirectory, expandPath],
  );

  const commitCreate = useCallback(
    async (parentPath: string, name: string, type: "file" | "directory") => {
      if (!rootPath) return;
      const newPath = joinPath(parentPath, name);
      try {
        if (type === "file") {
          await window.electronAPI.fs.createFile(rootPath, newPath);
        } else {
          await window.electronAPI.fs.createDirectory(rootPath, newPath);
        }
        await loadTree(rootPath, false);
        setSelected(newPath);
        if (type === "file") openFile(newPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "생성 실패";
        setErrorMessage(`생성 실패: ${msg}`);
      }
    },
    [rootPath, loadTree, setSelected, openFile],
  );

  const commitRename = useCallback(
    async (oldPath: string, newName: string) => {
      if (!rootPath) return;
      const newPath = joinPath(dirname(oldPath), newName);
      if (newPath === oldPath) return;
      try {
        await window.electronAPI.fs.rename(rootPath, oldPath, newPath);
        handlePathRenamed(oldPath, newPath);
        await loadTree(rootPath, false);
        setSelected(newPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "이름 변경 실패";
        setErrorMessage(`이름 변경 실패: ${msg}`);
      }
    },
    [rootPath, handlePathRenamed, loadTree, setSelected],
  );

  const handleDelete = useCallback(
    (target: FileNode) => {
      if (!rootPath) return;
      const isDir = target.type === "directory";
      setConfirmDialog({
        title: "삭제 확인",
        message: `'${target.name}'을(를) 영구적으로 삭제하시겠습니까?${
          isDir ? "\n폴더 안의 모든 항목이 함께 삭제됩니다." : ""
        }`,
        danger: true,
        onConfirm: async () => {
          try {
            await window.electronAPI.fs.remove(rootPath, target.path);
            handlePathRemoved(target.path);
            if (clipboardPath === target.path) clearClipboard();
            await loadTree(rootPath, false);
            if (selectedPath === target.path) setSelected(null);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "삭제 실패";
            setErrorMessage(`삭제 실패: ${msg}`);
          } finally {
            setConfirmDialog(null);
          }
        },
      });
    },
    [
      rootPath,
      handlePathRemoved,
      clipboardPath,
      clearClipboard,
      loadTree,
      selectedPath,
      setSelected,
    ],
  );

  const handlePaste = useCallback(
    async (targetDir?: string) => {
      if (!rootPath || !clipboardPath || !clipboardOp) return;
      const dir = targetDir ?? resolveTargetDirectory(selectedPath);
      if (!dir) return;
      // Prevent pasting a directory into itself or its descendant
      if (dir === clipboardPath || dir.startsWith(clipboardPath + "/")) {
        setErrorMessage("자기 자신 안으로 붙여넣을 수 없습니다");
        return;
      }
      const targetPath = joinPath(dir, basename(clipboardPath));
      try {
        if (clipboardOp === "copy") {
          await window.electronAPI.fs.copy(rootPath, clipboardPath, targetPath);
        } else {
          // cut → move via rename
          if (targetPath === clipboardPath) return;
          await window.electronAPI.fs.rename(
            rootPath,
            clipboardPath,
            targetPath,
          );
          handlePathRenamed(clipboardPath, targetPath);
          clearClipboard();
        }
        await loadTree(rootPath, false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "붙여넣기 실패";
        setErrorMessage(`붙여넣기 실패: ${msg}`);
      }
    },
    [
      rootPath,
      clipboardOp,
      clipboardPath,
      selectedPath,
      resolveTargetDirectory,
      handlePathRenamed,
      clearClipboard,
      loadTree,
    ],
  );

  const handleMoveByDrop = useCallback(
    async (sourcePath: string, targetDir: string) => {
      if (!rootPath) return;
      // Don't drop into self or descendants
      if (targetDir === sourcePath || targetDir.startsWith(sourcePath + "/"))
        return;
      // Don't drop into current parent (no-op move)
      if (dirname(sourcePath) === targetDir) return;
      const newPath = joinPath(targetDir, basename(sourcePath));
      try {
        await window.electronAPI.fs.rename(rootPath, sourcePath, newPath);
        handlePathRenamed(sourcePath, newPath);
        if (clipboardPath === sourcePath) clearClipboard();
        await loadTree(rootPath, false);
        setSelected(newPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "이동 실패";
        setErrorMessage(`이동 실패: ${msg}`);
      }
    },
    [
      rootPath,
      handlePathRenamed,
      clipboardPath,
      clearClipboard,
      loadTree,
      setSelected,
    ],
  );

  const handleRevealInFinder = useCallback((p: string) => {
    window.electronAPI.fs.revealInFinder(p);
  }, []);

  const handleCopyPath = useCallback((p: string) => {
    navigator.clipboard.writeText(p).catch(() => {
      setErrorMessage("경로 복사 실패");
    });
  }, []);

  // ---------- Context menu ----------
  const buildContextMenuItems = useCallback(
    (node: FileNode | null): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      const isDir = node?.type === "directory";
      const targetForCreate = node
        ? isDir
          ? node.path
          : dirname(node.path)
        : rootPath || "";

      items.push({
        label: "새 파일",
        shortcut: "⌘N",
        onClick: () => handleCreate("file", targetForCreate),
      });
      items.push({
        label: "새 폴더",
        shortcut: "⇧⌘N",
        onClick: () => handleCreate("directory", targetForCreate),
      });

      if (node) {
        items.push({ label: "", separator: true });
        items.push({
          label: "잘라내기",
          shortcut: "⌘X",
          onClick: () => cutToClipboard(node.path),
        });
        items.push({
          label: "복사",
          shortcut: "⌘C",
          onClick: () => copyToClipboard(node.path),
        });
      }

      items.push({
        label: "붙여넣기",
        shortcut: "⌘V",
        disabled: !clipboardPath,
        onClick: () => handlePaste(node && isDir ? node.path : undefined),
      });

      if (node) {
        items.push({ label: "", separator: true });
        items.push({
          label: "이름 변경",
          shortcut: "Enter",
          onClick: () => setRenamingPath(node.path),
        });
        items.push({
          label: "삭제",
          shortcut: "Delete",
          danger: true,
          onClick: () => handleDelete(node),
        });
        items.push({ label: "", separator: true });
        items.push({
          label: "Finder에서 보기",
          onClick: () => handleRevealInFinder(node.path),
        });
        items.push({
          label: "경로 복사",
          onClick: () => handleCopyPath(node.path),
        });
      }

      return items;
    },
    [
      rootPath,
      clipboardPath,
      handleCreate,
      cutToClipboard,
      copyToClipboard,
      handlePaste,
      handleDelete,
      handleRevealInFinder,
      handleCopyPath,
    ],
  );

  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: FileNode) => {
      setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    [],
  );

  const handleEmptyContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setSelected(null);
      setContextMenu({ x: e.clientX, y: e.clientY, node: null });
    },
    [setSelected],
  );

  // ---------- Keyboard shortcuts (when tree has focus) ----------
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // Skip if any input is focused
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const meta = e.metaKey || e.ctrlKey;

      if ((e.key === "F2" || e.key === "Enter") && selectedPath && !meta) {
        e.preventDefault();
        setRenamingPath(selectedPath);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedPath) {
        e.preventDefault();
        const node = flatNodes.get(selectedPath);
        if (node) handleDelete(node);
        return;
      }
      if (meta && e.key.toLowerCase() === "c" && selectedPath) {
        e.preventDefault();
        copyToClipboard(selectedPath);
        return;
      }
      if (meta && e.key.toLowerCase() === "x" && selectedPath) {
        e.preventDefault();
        cutToClipboard(selectedPath);
        return;
      }
      if (meta && e.key.toLowerCase() === "v") {
        e.preventDefault();
        handlePaste();
        return;
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleCreate("directory");
        return;
      }
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleCreate("file");
        return;
      }
    },
    [
      selectedPath,
      flatNodes,
      handleDelete,
      copyToClipboard,
      cutToClipboard,
      handlePaste,
      handleCreate,
    ],
  );

  // ---------- Project setup handlers (existing logic) ----------
  const handleSelectDirectory = useCallback(async () => {
    const dir = await window.electronAPI.fs.selectDirectory();
    if (!dir) return;

    setRootPath(dir);

    const remoteUrl = await window.electronAPI.fs.gitRemoteUrl(dir);
    const existing = findByPathOrRemote(dir, remoteUrl);
    if (existing) {
      setCurrentProject(existing);
      return;
    }

    const folderName = dir.split("/").pop() || "new-project";
    setNewProjectName(folderName);
    setPendingFolderPath(dir);
    setPendingGitRemoteUrl(remoteUrl);
    setShowNewProject(true);
  }, [setRootPath, findByPathOrRemote, setCurrentProject]);

  const handleCreateInlineProject = useCallback(async () => {
    if (!newProjectName.trim() || !user || !pendingFolderPath) return;
    try {
      const data: Omit<Project, "id" | "createdAt" | "updatedAt"> = {
        name: newProjectName.trim(),
        ownerId: user.uid,
        members: [user.uid],
        folderPath: pendingFolderPath,
      };
      if (pendingGitRemoteUrl) data.gitRemoteUrl = pendingGitRemoteUrl;
      const id = await createProject(data);
      setCurrentProject({
        id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (err) {
      console.error("Failed to create project:", err);
    } finally {
      setShowNewProject(false);
      setNewProjectName("");
      setPendingFolderPath(null);
      setPendingGitRemoteUrl(null);
    }
  }, [
    newProjectName,
    user,
    pendingFolderPath,
    pendingGitRemoteUrl,
    createProject,
    setCurrentProject,
  ]);

  const handleCancelInlineProject = useCallback(() => {
    setShowNewProject(false);
    setNewProjectName("");
    setPendingFolderPath(null);
    setPendingGitRemoteUrl(null);
  }, []);

  const handleRefresh = useCallback(() => {
    if (rootPath) loadTree(rootPath);
  }, [rootPath, loadTree]);

  if (!rootPath) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-4">
        <svg
          className="h-10 w-10 text-gray-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
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

  // Render top-level inline create (when target is rootPath)
  const showRootInlineCreate =
    pendingCreate && pendingCreate.parentPath === rootPath;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Inline project creation banner */}
      {showNewProject && (
        <div className="border-b border-blue-500/30 bg-blue-500/10 px-3 py-2">
          <p className="mb-1 text-[11px] font-medium text-blue-400">
            새 프로젝트
          </p>
          <div className="flex items-center gap-1">
            <input
              ref={newProjectInputRef}
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateInlineProject();
                if (e.key === "Escape") handleCancelInlineProject();
              }}
              className="flex-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
              placeholder="프로젝트 이름"
            />
            <button
              onClick={handleCreateInlineProject}
              className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white hover:bg-blue-500"
              title="생성"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-[10px] text-gray-500">
            Enter로 생성 / Esc 취소
          </p>
        </div>
      )}

      {/* Project path header + toolbar */}
      <div className="flex items-center gap-1 border-b border-gray-700 px-2 py-1">
        <span
          className="flex-1 truncate text-[11px] text-gray-400"
          title={rootPath}
        >
          {rootPath.split("/").pop()}
        </span>
        <button
          onClick={() => handleCreate("file")}
          className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
          title="새 파일 (⌘N)"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 13h6m-3-3v6m-7 4h14a2 2 0 002-2V8a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </button>
        <button
          onClick={() => handleCreate("directory")}
          className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
          title="새 폴더 (⇧⌘N)"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 11v4m-2-2h4m6 5a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 2h7a2 2 0 012 2v11z"
            />
          </svg>
        </button>
        <button
          onClick={handleRefresh}
          className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
          title="새로고침"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
        <button
          onClick={handleSelectDirectory}
          className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
          title="다른 폴더 열기"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        </button>
      </div>

      {/* Tree content */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onContextMenu={handleEmptyContextMenu}
        onClick={(e) => {
          // Click on empty area clears selection
          if (e.target === containerRef.current) setSelected(null);
        }}
        className="flex-1 overflow-y-auto py-1 pr-2 outline-none"
      >
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <span className="text-xs text-gray-500">로딩 중...</span>
          </div>
        ) : (
          <>
            {showRootInlineCreate && (
              <InlineCreateInput
                depth={0}
                type={pendingCreate.type}
                onCommit={async (name) => {
                  await commitCreate(rootPath, name, pendingCreate.type);
                  setPendingCreate(null);
                }}
                onCancel={() => setPendingCreate(null)}
              />
            )}
            {tree.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={0}
                gitStatuses={gitStatuses}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                renamingPath={renamingPath}
                setRenamingPath={setRenamingPath}
                pendingCreate={pendingCreate}
                setPendingCreate={setPendingCreate}
                onCommitRename={commitRename}
                onCommitCreate={commitCreate}
                onContextMenu={handleNodeContextMenu}
                onMoveByDrop={handleMoveByDrop}
              />
            ))}
          </>
        )}
      </div>

      {/* Error toast */}
      {errorMessage && (
        <div className="border-t border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {errorMessage}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <FileTreeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems(contextMenu.node)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Confirm dialog */}
      {confirmDialog && (
        <FileTreeConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          danger={confirmDialog.danger}
          confirmLabel="삭제"
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}
