import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
  KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useEditorStore } from "../../stores/editorStore";
import { useProjectStore } from "../../stores/projectStore";
import type { Project } from "../../types/project";
import { useFileTreeStore } from "../../stores/fileTreeStore";
import { useWorktreeStore } from "../../stores/worktreeStore";
import { useNavigationStore } from "../../stores/navigationStore";
import {
  describeRootView,
  filterWorktreesByProject,
  calculateWorktreeMenuPosition,
  resolveRootSwitch,
  resolveLocalMainPath,
  isStrayWorktreeContainerRoot,
  treeSignature,
} from "../../lib/fileTreeView";
import type { WorktreeMenuPosition } from "../../lib/fileTreeView";
import type { RootSwitchTarget } from "../../lib/fileTreeView";
import {
  folderLabel,
  loadRecentFolders,
  saveRecentFolder,
} from "../../lib/recentFolders";
import { useAuth } from "../../hooks/useAuth";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import { useUiStore } from "../../stores/uiStore";
import { checkProjectCreate, ProjectLimitError } from "../../lib/planLimits";
import { useTranslation, t as translate } from "../../lib/i18n";
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
  // Handle both POSIX (/) and Windows (\) separators, and trailing separators,
  // so a native Windows path like C:\Users\me\proj yields "proj" not the full path.
  return (
    p
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || p
  );
}

function dirname(p: string): string {
  // Find the last POSIX (/) or Windows (\) separator. lastIndexOf("/") alone
  // returns -1 on a native Windows path (C:\a\b), which would make dirname yield
  // the whole path and break paste/move/create-relative file operations.
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
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
  const requestJump = useNavigationStore((s) => s.requestJump);
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
      // Single click opens the file AND brings the Code tab forward, so the
      // editor is visible even when another main tab (Board/Agents/…) is active.
      openFile(node.path);
      requestJump({ type: "code" });
    }
  }, [node, toggleExpanded, openFile, requestJump, setSelected]);

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
    // OS file drop (Finder → directory): copy semantics
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!dragOver) setDragOver(true);
      return;
    }
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
    // OS file drop (Finder → directory): import into this folder
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const srcPaths = Array.from(e.dataTransfer.files)
        .map((f) => window.electronAPI.fs.getPathForFile(f))
        .filter(Boolean);
      const rootPath = useEditorStore.getState().rootPath;
      if (rootPath && srcPaths.length) {
        await window.electronAPI.fs.importPaths({
          rootPath,
          destDir: node.path,
          srcPaths,
        });
      }
      return; // fs watcher가 트리 자동 갱신
    }
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
              requestJump({ type: "code" });
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
  const { t } = useTranslation();
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
        placeholder={
          type === "directory"
            ? t("sidebar.tree.folderName")
            : t("sidebar.tree.fileName")
        }
        className="flex-1 rounded border border-blue-500 bg-gray-900 px-1 py-0 text-[13px] text-white outline-none"
      />
    </div>
  );
}

interface WorktreeSwitchProps {
  /** Jump-to-main target path; null when already on main. */
  toMain: string | null;
  /** Task worktrees the tree root can switch to. */
  toTasks: RootSwitchTarget[];
  open: boolean;
  setOpen: (open: boolean) => void;
  menuRef: React.RefObject<HTMLDivElement>;
  portalMenuRef: React.RefObject<HTMLDivElement>;
  onSwitch: (path: string) => void;
}

// Compact header control: jump the file tree root to the MAIN worktree, or to a
// task worktree. A single alternative renders as a direct icon button; multiple
// task worktrees collapse into a small dropdown so the header stays tidy.
function WorktreeSwitch({
  toMain,
  toTasks,
  open,
  setOpen,
  menuRef,
  portalMenuRef,
  onSwitch,
}: WorktreeSwitchProps) {
  const { t } = useTranslation();
  if (toMain) {
    // On a task worktree → primary action is "back to main". Extra task
    // worktrees (if any) are still reachable via the dropdown below.
    return (
      <div className="relative flex items-center" ref={menuRef}>
        <button
          onClick={() => onSwitch(toMain)}
          className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
          title={t("sidebar.tree.toMain")}
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
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
        </button>
        {toTasks.length > 0 && (
          <WorktreeMenuButton
            tasks={toTasks}
            open={open}
            setOpen={setOpen}
            portalMenuRef={portalMenuRef}
            onSwitch={onSwitch}
          />
        )}
      </div>
    );
  }

  // On main / project / folder → offer the task worktree(s).
  if (toTasks.length === 1) {
    const target = toTasks[0];
    const targetTitle = `${target.label}${
      target.taskId ? ` · ${target.taskId}` : ""
    }\n${target.path}`;
    return (
      <button
        onClick={() => onSwitch(target.path)}
        className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
        title={targetTitle}
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
            d="M8 7l4-4m0 0l4 4m-4-4v18"
            transform="rotate(90 12 12)"
          />
        </svg>
      </button>
    );
  }

  return (
    <div className="relative flex items-center" ref={menuRef}>
      <WorktreeMenuButton
        tasks={toTasks}
        open={open}
        setOpen={setOpen}
        portalMenuRef={portalMenuRef}
        onSwitch={onSwitch}
        title={t("sidebar.tree.toTask")}
      />
    </div>
  );
}

interface WorktreeMenuButtonProps {
  tasks: RootSwitchTarget[];
  open: boolean;
  setOpen: (open: boolean) => void;
  portalMenuRef: React.RefObject<HTMLDivElement>;
  onSwitch: (path: string) => void;
  title?: string;
}

function WorktreeMenuButton({
  tasks,
  open,
  setOpen,
  portalMenuRef,
  onSwitch,
  title,
}: WorktreeMenuButtonProps) {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<WorktreeMenuPosition | null>(null);

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    setPosition(
      calculateWorktreeMenuPosition(
        button.getBoundingClientRect(),
        window.innerWidth,
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  const menu =
    open && position
      ? createPortal(
          <div
            ref={portalMenuRef}
            className="z-50 w-[min(80vw,360px)] min-w-[260px] overflow-hidden rounded border border-gray-700 bg-gray-800 py-1 shadow-lg"
            style={{
              position: "fixed",
              left: `${position.left}px`,
              top: `${position.top}px`,
            }}
          >
            {tasks.map((t) => (
              <button
                key={t.path}
                onClick={() => onSwitch(t.path)}
                className="flex w-full min-w-0 items-center gap-2 px-2 py-1 text-left text-[12px] text-gray-300 hover:bg-gray-700"
                title={`${t.label}${t.taskId ? ` · ${t.taskId}` : ""}\n${
                  t.path
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{t.label}</span>
                {t.taskId && (
                  <span className="ml-auto flex-shrink-0 rounded bg-purple-500/20 px-1 text-[9px] font-bold uppercase tracking-wide text-purple-300">
                    {t.taskId}
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
        title={title ?? t("sidebar.tree.toOtherTask")}
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
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {menu}
    </>
  );
}

export function FileTree() {
  const { t } = useTranslation();
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
  const requestJump = useNavigationStore((s) => s.requestJump);

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
  const currentProject = useProjectStore((s) => s.currentProject);
  const projects = useProjectStore((s) => s.projects);
  const projectsHydrated = useProjectStore((s) => s.projectsHydrated);

  // Plan gate for project creation (Free = 1 project). The gate is evaluated at
  // click-time against the live project count; when blocked it opens the global
  // upgrade modal (uiStore) — the same modal the agent-limit path uses.
  const getPlan = useSubscriptionStore((s) => s.getPlan);

  // Returns true when another project may be created under the current plan;
  // otherwise opens the global UpgradeModal and returns false. Used to gate
  // every create entry point (zero-click auto-register, inline banner, register
  // choice) before touching Firestore.
  const ensureProjectQuota = useCallback((): boolean => {
    const check = checkProjectCreate(getPlan(), projects.length);
    if (!check.allowed) {
      useUiStore.getState().showUpgrade("projects", "pro");
      return false;
    }
    return true;
  }, [getPlan, projects.length]);

  const worktrees = useWorktreeStore((s) => s.worktrees);
  const refreshWorktrees = useWorktreeStore((s) => s.refresh);
  const currentProjectWorktrees = useMemo(
    () => filterWorktreesByProject(worktrees, currentProject?.id),
    [worktrees, currentProject?.id],
  );

  // Explicit "what am I looking at" descriptor for the header. A worktree's
  // basename is often a generated id, so we surface branch/taskId + full path.
  const rootView = useMemo(
    () =>
      describeRootView(
        rootPath,
        currentProjectWorktrees,
        currentProject?.folderPath ?? null,
      ),
    [rootPath, currentProjectWorktrees, currentProject?.folderPath],
  );

  // What the header's root-switch control should offer (jump to main, or pick a
  // task worktree). Null when there's no main worktree or no alternative root.
  const rootSwitch = useMemo(
    () =>
      resolveRootSwitch(
        rootPath,
        currentProjectWorktrees,
        currentProject?.folderPath ?? null,
      ),
    [rootPath, currentProjectWorktrees, currentProject?.folderPath],
  );

  // Defensive guard: the tree root is the shared ~/.marblo/worktrees container
  // (or a project bucket inside it) rather than a concrete checkout, so the tree
  // would spill sibling worktrees of other projects/tasks. Nudge back to this
  // machine's main checkout instead of silently rendering the stray tree.
  const strayRoot = useMemo(
    () =>
      isStrayWorktreeContainerRoot(
        rootPath,
        currentProjectWorktrees,
        currentProject?.folderPath ?? null,
      ),
    [rootPath, currentProjectWorktrees, currentProject?.folderPath],
  );

  const [showWorktreeMenu, setShowWorktreeMenu] = useState(false);
  const worktreeMenuRef = useRef<HTMLDivElement>(null);
  const worktreePortalMenuRef = useRef<HTMLDivElement>(null);

  // "Open Folder" (read-only browse) — recents list + dropdown state. The list
  // is persisted in localStorage so a user can quickly re-open a folder.
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [showRecentMenu, setShowRecentMenu] = useState(false);
  // The menu is rendered in a body portal (like the worktree switch) so the
  // narrow, overflow-hidden sidebar can't clip it. recentMenuRef = trigger
  // zone, recentPortalMenuRef = the portalled menu, recentButtonRef = the
  // chevron we anchor the menu to.
  const recentMenuRef = useRef<HTMLDivElement>(null);
  const recentPortalMenuRef = useRef<HTMLDivElement>(null);
  const recentButtonRef = useRef<HTMLButtonElement>(null);
  const [recentMenuPosition, setRecentMenuPosition] =
    useState<WorktreeMenuPosition | null>(null);
  useEffect(() => {
    setRecentFolders(loadRecentFolders());
  }, []);

  const updateRecentMenuPosition = useCallback(() => {
    const button = recentButtonRef.current;
    if (!button) return;
    setRecentMenuPosition(
      calculateWorktreeMenuPosition(
        button.getBoundingClientRect(),
        window.innerWidth,
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (!showRecentMenu) return;
    updateRecentMenuPosition();
  }, [showRecentMenu, updateRecentMenuPosition]);

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(
    null,
  );
  const [pendingGitRemoteUrl, setPendingGitRemoteUrl] = useState<string | null>(
    null,
  );
  // When an unregistered folder is picked we present a choice (register as a
  // project vs. read-only browse) instead of jumping straight to the register
  // banner. Holds the picked path + its git remote until the user chooses.
  const [folderChoice, setFolderChoice] = useState<{
    path: string;
    remoteUrl: string | null;
  } | null>(null);
  const newProjectInputRef = useRef<HTMLInputElement>(null);

  // Monotonic load token: only the most recent load may apply its result, so a
  // rapid worktree switch (or a forced refresh issued mid-load) can never be
  // clobbered by a slower, older read. This replaces the old `loadingRef` guard
  // that silently *dropped* concurrent loads — the source of stale trees on
  // worktree switch and of "refresh did nothing".
  const loadSeqRef = useRef(0);
  // Signature of the last applied tree+status, so watcher/poll reloads that
  // return identical data don't trigger needless re-renders / flicker.
  const lastSignatureRef = useRef<string>("");
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
    const seq = ++loadSeqRef.current;
    if (showLoading) setLoading(true);
    try {
      const [nodes, statuses] = await Promise.all([
        window.electronAPI.fs.readTree(dirPath),
        window.electronAPI.fs.gitStatus(dirPath),
      ]);
      // A newer load (worktree switch / forced refresh) superseded us — discard
      // this stale result so it can't overwrite fresher data.
      if (seq !== loadSeqRef.current) return;
      const signature = treeSignature(nodes, statuses);
      if (signature !== lastSignatureRef.current) {
        lastSignatureRef.current = signature;
        setTree(nodes);
        setGitStatuses(statuses);
      }
    } catch (err) {
      if (seq === loadSeqRef.current)
        console.error("Failed to load file tree:", err);
    } finally {
      if (seq === loadSeqRef.current && showLoading) setLoading(false);
    }
  }, []);

  // Keep the worktree list fresh so the header can name the current root.
  useEffect(() => {
    refreshWorktrees().catch(() => {});
  }, [refreshWorktrees]);

  useEffect(() => {
    if (!rootPath) return;
    // New root → forget the previous tree's signature so the first load always
    // applies, even if it happens to match stale React state.
    lastSignatureRef.current = "";
    loadTree(rootPath, true);
    window.electronAPI.fs.watch(rootPath);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => loadTree(rootPath, false), 400);
    };
    window.electronAPI.fs.onFileChange(handler);

    // Fallbacks for changes native fs.watch can miss — notably files written by
    // another process (an agent's git ops inside this worktree). A window-focus
    // refresh covers "I switched away and the agent worked"; a slow poll is the
    // safety net. Snapshot dedupe keeps both no-ops cheap when nothing changed.
    const onFocus = () => loadTree(rootPath, false);
    window.addEventListener("focus", onFocus);
    const poll = setInterval(() => loadTree(rootPath, false), 5000);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", onFocus);
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

  // Close the worktree-switch menu on outside click / Escape.
  useEffect(() => {
    if (!showWorktreeMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = worktreeMenuRef.current?.contains(target);
      const insidePortal = worktreePortalMenuRef.current?.contains(target);
      if (!insideTrigger && !insidePortal) {
        setShowWorktreeMenu(false);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setShowWorktreeMenu(false);
    };
    const onViewportChange = () => setShowWorktreeMenu(false);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [showWorktreeMenu]);

  // Close the recent-folders menu on outside click / Escape. The menu lives in
  // a body portal, so outside-click must treat both the trigger zone and the
  // portalled menu as "inside" (else clicking the menu would close it).
  useEffect(() => {
    if (!showRecentMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = recentMenuRef.current?.contains(target);
      const insidePortal = recentPortalMenuRef.current?.contains(target);
      if (!insideTrigger && !insidePortal) {
        setShowRecentMenu(false);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setShowRecentMenu(false);
    };
    const onViewportChange = () => setShowRecentMenu(false);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [showRecentMenu]);

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
        if (type === "file") {
          openFile(newPath);
          requestJump({ type: "code" });
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : translate("sidebar.tree.createFail");
        setErrorMessage(translate("sidebar.tree.createFailMsg", { msg }));
      }
    },
    [rootPath, loadTree, setSelected, openFile, requestJump],
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
        const msg =
          err instanceof Error
            ? err.message
            : translate("sidebar.tree.renameFail");
        setErrorMessage(translate("sidebar.tree.renameFailMsg", { msg }));
      }
    },
    [rootPath, handlePathRenamed, loadTree, setSelected],
  );

  const handleDelete = useCallback(
    (target: FileNode) => {
      if (!rootPath) return;
      const isDir = target.type === "directory";
      setConfirmDialog({
        title: translate("sidebar.tree.deleteTitle"),
        message:
          translate("sidebar.tree.deleteMsg", { name: target.name }) +
          (isDir ? translate("sidebar.tree.deleteDirSuffix") : ""),
        danger: true,
        onConfirm: async () => {
          try {
            await window.electronAPI.fs.remove(rootPath, target.path);
            handlePathRemoved(target.path);
            if (clipboardPath === target.path) clearClipboard();
            await loadTree(rootPath, false);
            if (selectedPath === target.path) setSelected(null);
          } catch (err) {
            const msg =
              err instanceof Error
                ? err.message
                : translate("sidebar.tree.deleteFail");
            setErrorMessage(translate("sidebar.tree.deleteFailMsg", { msg }));
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
        setErrorMessage(translate("sidebar.tree.pasteSelf"));
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
        const msg =
          err instanceof Error
            ? err.message
            : translate("sidebar.tree.pasteFail");
        setErrorMessage(translate("sidebar.tree.pasteFailMsg", { msg }));
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
        const msg =
          err instanceof Error
            ? err.message
            : translate("sidebar.tree.moveFail");
        setErrorMessage(translate("sidebar.tree.moveFailMsg", { msg }));
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
      setErrorMessage(translate("sidebar.tree.copyPathFail"));
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
        label: translate("sidebar.tree.newFile"),
        shortcut: "⌘N",
        onClick: () => handleCreate("file", targetForCreate),
      });
      items.push({
        label: translate("sidebar.tree.newFolder"),
        shortcut: "⇧⌘N",
        onClick: () => handleCreate("directory", targetForCreate),
      });

      if (node) {
        items.push({ label: "", separator: true });
        items.push({
          label: translate("sidebar.tree.cut"),
          shortcut: "⌘X",
          onClick: () => cutToClipboard(node.path),
        });
        items.push({
          label: translate("sidebar.tree.copy"),
          shortcut: "⌘C",
          onClick: () => copyToClipboard(node.path),
        });
      }

      items.push({
        label: translate("sidebar.tree.paste"),
        shortcut: "⌘V",
        disabled: !clipboardPath,
        onClick: () => handlePaste(node && isDir ? node.path : undefined),
      });

      if (node) {
        items.push({ label: "", separator: true });
        items.push({
          label: translate("sidebar.tree.rename"),
          shortcut: "Enter",
          onClick: () => setRenamingPath(node.path),
        });
        items.push({
          label: translate("sidebar.tree.delete"),
          shortcut: "Delete",
          danger: true,
          onClick: () => handleDelete(node),
        });
        items.push({ label: "", separator: true });
        items.push({
          label: translate("sidebar.tree.revealInFinder"),
          onClick: () => handleRevealInFinder(node.path),
        });
        items.push({
          label: translate("sidebar.tree.copyPath"),
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

  const startInlineProjectCreation = useCallback(
    (path: string, remoteUrl: string | null) => {
      const folderName = basename(path) || "new-project";
      setNewProjectName(folderName);
      setPendingFolderPath(path);
      setPendingGitRemoteUrl(remoteUrl);
      setFolderChoice(null);
      setShowNewProject(true);
    },
    [],
  );

  // Zero-click first-project registration: the picked folder immediately
  // becomes a project (name = folder basename) with no confirm banner. This is
  // the new-user path — useOrchestratorAutoLaunch keys off currentProject's
  // folderPath and auto-starts the orchestrator, so it reads as
  // "pick folder → orchestrator boots". If the CLI isn't installed/logged in,
  // CliSetupGate + the spawn guard take over the auth flow. Requires a signed-in
  // user (createProject needs ownerId); returns false so the caller can fall
  // back to the inline banner when there's no user or the write fails.
  const autoRegisterFirstProject = useCallback(
    async (dir: string, remoteUrl: string | null): Promise<boolean> => {
      if (!user) return false;
      try {
        const data: Omit<Project, "id" | "createdAt" | "updatedAt"> = {
          name: basename(dir) || "new-project",
          ownerId: user.uid,
          members: [user.uid],
          folderPath: dir,
        };
        if (remoteUrl) data.gitRemoteUrl = remoteUrl;
        const id = await createProject(data);
        setRootPath(dir);
        setCurrentProject({
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return true;
      } catch (err) {
        // Plan limit hit (shouldn't happen on the first project, but the store
        // is the choke point) → surface the upgrade path, treat as "handled" so
        // the caller doesn't fall through to the inline banner.
        if (err instanceof ProjectLimitError) {
          useUiStore.getState().showUpgrade("projects", "pro");
          return true;
        }
        console.error("Failed to auto-register first project:", err);
        return false;
      }
    },
    [user, createProject, setRootPath, setCurrentProject],
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

    if (projectsHydrated && projects.length === 0) {
      // First user (no projects yet): register with one click — the folder
      // pick alone. Fall back to the inline confirm banner if not signed in or
      // the auto-register write fails.
      if (await autoRegisterFirstProject(dir, remoteUrl)) return;
      startInlineProjectCreation(dir, remoteUrl);
      return;
    }

    // Unregistered folder for an existing user: don't auto-open the register
    // banner. Offer a choice — register as a project (existing flow), or just
    // browse read-only. (Zero-click is intentionally first-user only.)
    setFolderChoice({ path: dir, remoteUrl });
  }, [
    setRootPath,
    findByPathOrRemote,
    setCurrentProject,
    projectsHydrated,
    projects.length,
    autoRegisterFirstProject,
    startInlineProjectCreation,
  ]);

  // Shared "open a project" entry point — the board / agents no-project empty
  // states dispatch `marblo:select-folder` so their CTA runs the exact same
  // folder-pick + auto-register flow as the sidebar's "Select folder" button,
  // instead of duplicating (and drifting from) that logic.
  useEffect(() => {
    const onSelectFolder = () => void handleSelectDirectory();
    window.addEventListener("marblo:select-folder", onSelectFolder);
    return () =>
      window.removeEventListener("marblo:select-folder", onSelectFolder);
  }, [handleSelectDirectory]);

  // "Register as a project" branch of the folder-choice banner → hand off to
  // the existing inline new-project banner with the picked folder prefilled.
  const handleChooseRegister = useCallback(() => {
    if (!folderChoice) return;
    // Free plan already at its project cap → offer upgrade instead of opening
    // the register banner. (Browse read-only stays available.)
    if (!ensureProjectQuota()) {
      setFolderChoice(null);
      return;
    }
    startInlineProjectCreation(folderChoice.path, folderChoice.remoteUrl);
  }, [folderChoice, ensureProjectQuota, startInlineProjectCreation]);

  // "Browse (read-only)" branch → the root was already switched to the folder in
  // handleSelectDirectory, so we only remember it in recents. No project bind.
  const handleChooseBrowse = useCallback(() => {
    if (!folderChoice) return;
    setRecentFolders(saveRecentFolder(folderChoice.path));
    setFolderChoice(null);
  }, [folderChoice]);

  const handleCreateInlineProject = useCallback(async () => {
    if (!newProjectName.trim() || !user || !pendingFolderPath) return;
    // Gate before writing: Free plan at its project cap → upgrade path instead.
    if (!ensureProjectQuota()) {
      setShowNewProject(false);
      setNewProjectName("");
      setPendingFolderPath(null);
      setPendingGitRemoteUrl(null);
      return;
    }
    try {
      const data: Omit<Project, "id" | "createdAt" | "updatedAt"> = {
        name: newProjectName.trim(),
        ownerId: user.uid,
        members: [user.uid],
        folderPath: pendingFolderPath,
      };
      if (pendingGitRemoteUrl) data.gitRemoteUrl = pendingGitRemoteUrl;
      const id = await createProject(data);
      setRootPath(pendingFolderPath);
      setCurrentProject({
        id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (err) {
      // Choke-point gate raced ahead of us (e.g. concurrent create) → upgrade.
      if (err instanceof ProjectLimitError) {
        useUiStore.getState().showUpgrade("projects", "pro");
      } else {
        console.error("Failed to create project:", err);
      }
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
    ensureProjectQuota,
    createProject,
    setRootPath,
    setCurrentProject,
  ]);

  const handleCancelInlineProject = useCallback(() => {
    setShowNewProject(false);
    setNewProjectName("");
    setPendingFolderPath(null);
    setPendingGitRemoteUrl(null);
  }, []);

  // Switch the tree root to another worktree (main or task). Selection is
  // cleared because paths from the previous root no longer exist in the new one.
  const handleSwitchRoot = useCallback(
    (path: string) => {
      setShowWorktreeMenu(false);
      if (path === rootPath) return;
      setSelected(null);
      setRootPath(path);
    },
    [rootPath, setRootPath, setSelected],
  );

  // Reset the tree root to this machine's main checkout — the canonical local
  // main path (git-realpath'd worktree entry, else the project folder). Used by
  // the stray-container guard so "home" always lands on a valid local root
  // instead of a foreign/stale path.
  const handleResetToMain = useCallback(() => {
    const mainPath = resolveLocalMainPath(
      currentProjectWorktrees,
      currentProject?.folderPath ?? null,
    );
    if (!mainPath || mainPath === rootPath) return;
    setSelected(null);
    setRootPath(mainPath);
  }, [
    currentProjectWorktrees,
    currentProject?.folderPath,
    rootPath,
    setRootPath,
    setSelected,
  ]);

  // ---------- Open Folder (v1: read-only browse, no project/task binding) ----
  // Switch the tree root to an arbitrary local folder. Unlike
  // handleSelectDirectory above, this does NOT create/bind a project or look up
  // git — it's a plain "browse this folder" entry point. Reuses the existing
  // fs.selectDirectory IPC (showOpenDialog → openDirectory).
  const openFolderPath = useCallback(
    (path: string) => {
      if (!path || path === rootPath) {
        setRecentFolders(saveRecentFolder(path));
        return;
      }
      setSelected(null);
      setRootPath(path);
      setRecentFolders(saveRecentFolder(path));
    },
    [rootPath, setRootPath, setSelected],
  );

  // Recent-folder click on the unified "Open Folder" dropdown: browse the path
  // read-only — but if it's a registered project, switch to it (bind) so the
  // header reflects the project, matching the main button's behavior.
  const handleOpenRecent = useCallback(
    async (path: string) => {
      setShowRecentMenu(false);
      const remoteUrl = await window.electronAPI.fs.gitRemoteUrl(path);
      const existing = findByPathOrRemote(path, remoteUrl);
      openFolderPath(path);
      if (existing) setCurrentProject(existing);
    },
    [openFolderPath, findByPathOrRemote, setCurrentProject],
  );

  const handleRefresh = useCallback(() => {
    if (!rootPath) return;
    // Force a real re-read that bypasses dedupe, so the user always gets the
    // latest on-disk state (and visible loading feedback) even if the cached
    // signature happens to match. The seq-guard in loadTree means this beats
    // any in-flight watcher/poll reload rather than being dropped.
    lastSignatureRef.current = "";
    loadTree(rootPath, true);
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
        <p className="mt-2 text-xs text-gray-500">
          {t("sidebar.tree.openProject")}
        </p>
        <button
          onClick={handleSelectDirectory}
          className="mt-2 rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
        >
          {t("sidebar.tree.selectFolder")}
        </button>
      </div>
    );
  }

  // Render top-level inline create (when target is rootPath)
  const showRootInlineCreate =
    pendingCreate && pendingCreate.parentPath === rootPath;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Folder-open choice banner — shown when an unregistered folder is
          picked: register it as a project, or just browse it read-only. */}
      {folderChoice && (
        <div className="border-b border-blue-500/30 bg-blue-500/10 px-3 py-2">
          <p className="mb-1 text-[11px] font-medium text-blue-400">
            {t("sidebar.tree.openFolder")}
          </p>
          <p
            className="mb-2 truncate text-[10px] text-gray-400"
            title={folderChoice.path}
          >
            {folderChoice.path}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={handleChooseRegister}
              className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white hover:bg-blue-500"
            >
              {t("sidebar.tree.registerProject")}
            </button>
            <button
              onClick={handleChooseBrowse}
              className="rounded bg-gray-700 px-2 py-1 text-[11px] text-gray-200 hover:bg-gray-600"
            >
              {t("sidebar.tree.browseReadonly")}
            </button>
            <button
              onClick={() => setFolderChoice(null)}
              className="ml-auto rounded px-2 py-1 text-[11px] text-gray-400 hover:text-gray-200"
              title={t("sidebar.tree.cancel")}
            >
              {t("sidebar.tree.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Inline project creation banner */}
      {showNewProject && (
        <div className="border-b border-blue-500/30 bg-blue-500/10 px-3 py-2">
          <p className="mb-1 text-[11px] font-medium text-blue-400">
            {t("sidebar.tree.newProject")}
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
              placeholder={t("sidebar.tree.projectNamePlaceholder")}
            />
            <button
              onClick={handleCreateInlineProject}
              className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white hover:bg-blue-500"
              title={t("sidebar.tree.create")}
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
            {t("sidebar.tree.createHint")}
          </p>
        </div>
      )}

      {/* Project path header + toolbar */}
      <div className="flex flex-col border-b border-gray-700">
        <div className="flex items-center gap-1 px-2 pt-1">
          <span
            className="truncate text-[11px] font-medium text-gray-300"
            title={rootView?.fullPath ?? rootPath}
          >
            {rootView?.label ?? basename(rootPath)}
          </span>
          {rootView?.kind === "worktree" && (
            <span
              className="flex-shrink-0 rounded bg-purple-500/20 px-1 text-[9px] font-bold uppercase tracking-wide text-purple-300"
              title={t("sidebar.tree.activeWorktree")}
            >
              {rootView.detail ? `WT · ${rootView.detail}` : "WT"}
            </span>
          )}
          {rootView?.kind === "project" && (
            <span
              className="flex-shrink-0 rounded bg-gray-600/40 px-1 text-[9px] font-bold uppercase tracking-wide text-gray-400"
              title={t("sidebar.tree.projectRoot")}
            >
              ROOT
            </span>
          )}
          <span className="flex-1" />
          {/* Open Folder — single unified entry point: pick a folder (registers
              or browses, via the choice banner), with a recents dropdown. Its
              own zone, divided from the worktree switch and file-ops below. */}
          <div ref={recentMenuRef} className="relative flex items-center">
            <button
              onClick={handleSelectDirectory}
              className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
              title={t("sidebar.tree.openFolder")}
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
            {recentFolders.length > 0 && (
              <button
                ref={recentButtonRef}
                onClick={() => setShowRecentMenu((v) => !v)}
                className={`rounded p-0.5 hover:bg-gray-700 hover:text-gray-300 ${
                  showRecentMenu ? "text-gray-300" : "text-gray-500"
                }`}
                title={t("sidebar.tree.recentFolders")}
                aria-haspopup="menu"
                aria-expanded={showRecentMenu}
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
            )}
            {/* Body portal + position:fixed (left-anchored, viewport-clamped via
                calculateWorktreeMenuPosition) so the menu can't be clipped by
                the narrow, overflow-hidden sidebar — same fix as #146/#147 for
                the worktree switch. */}
            {showRecentMenu &&
              recentFolders.length > 0 &&
              recentMenuPosition &&
              createPortal(
                <div
                  ref={recentPortalMenuRef}
                  className="z-50 max-h-64 w-[min(80vw,360px)] min-w-[224px] overflow-auto rounded border border-gray-700 bg-gray-800 py-1 shadow-lg"
                  style={{
                    position: "fixed",
                    left: `${recentMenuPosition.left}px`,
                    top: `${recentMenuPosition.top}px`,
                  }}
                  role="menu"
                >
                  <div className="px-2 pb-1 text-[9px] font-bold uppercase tracking-wide text-gray-500">
                    {t("sidebar.tree.recentFolders")}
                  </div>
                  {recentFolders.map((path) => (
                    <button
                      key={path}
                      onClick={() => handleOpenRecent(path)}
                      className="block w-full truncate px-2 py-1 text-left text-[11px] text-gray-300 hover:bg-gray-700"
                      title={path}
                      role="menuitem"
                    >
                      {folderLabel(path)}
                      <span className="ml-1 text-[9px] text-gray-500">
                        {path}
                      </span>
                    </button>
                  ))}
                </div>,
                document.body,
              )}
          </div>
          <span className="mx-0.5 h-3.5 w-px bg-gray-700" />
          {rootSwitch && (
            <>
              <WorktreeSwitch
                toMain={rootSwitch.toMain}
                toTasks={rootSwitch.toTasks}
                open={showWorktreeMenu}
                setOpen={setShowWorktreeMenu}
                menuRef={worktreeMenuRef}
                portalMenuRef={worktreePortalMenuRef}
                onSwitch={handleSwitchRoot}
              />
              <span className="mx-0.5 h-3.5 w-px bg-gray-700" />
            </>
          )}
          <button
            onClick={() => handleCreate("file")}
            className="rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
            title={t("sidebar.tree.newFileShortcut")}
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
            title={t("sidebar.tree.newFolderShortcut")}
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
            title={t("sidebar.tree.refresh")}
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
        </div>
        {/* Full path of the root currently being viewed — makes a worktree
            switch unmistakable (basenames are often generated ids). */}
        <div
          className="truncate px-2 pb-1 text-[10px] text-gray-500"
          title={rootView?.fullPath ?? rootPath}
        >
          {rootView?.fullPath ?? rootPath}
        </div>
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
            <span className="text-xs text-gray-500">
              {t("sidebar.tree.loading")}
            </span>
          </div>
        ) : strayRoot ? (
          // Stray worktrees-container root → don't render other projects'
          // worktrees; guide the user back to a real checkout instead.
          <div className="flex flex-col items-start gap-2 px-3 py-4">
            <p className="text-[12px] font-medium text-amber-400">
              {t("sidebar.tree.strayRootTitle")}
            </p>
            <p className="text-[11px] leading-relaxed text-gray-400">
              {t("sidebar.tree.strayRootDesc")}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={handleResetToMain}
                className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white hover:bg-blue-500"
              >
                {t("sidebar.tree.strayRootToMain")}
              </button>
              <button
                onClick={handleSelectDirectory}
                className="rounded bg-gray-700 px-2 py-1 text-[11px] text-gray-200 hover:bg-gray-600"
              >
                {t("sidebar.tree.strayRootPick")}
              </button>
            </div>
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
          confirmLabel={t("sidebar.tree.delete")}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}
