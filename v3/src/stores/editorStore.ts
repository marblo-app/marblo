import { create } from "zustand";

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  language: string;
  isModified: boolean;
}

/** Surfaced to the user when a save fails to reach disk (data-loss risk). */
export interface SaveError {
  path: string;
  name: string;
  message: string;
}

interface EditorState {
  rootPath: string | null;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  showDiff: boolean;
  saveError: SaveError | null;

  setRootPath: (path: string | null) => void;
  openFile: (filePath: string) => Promise<void>;
  closeFile: (filePath: string) => void;
  closeAllFiles: () => void;
  setActiveFile: (filePath: string) => void;
  updateContent: (filePath: string, content: string) => void;
  saveFile: (filePath: string) => Promise<void>;
  clearSaveError: () => void;
  toggleDiff: () => void;
  setShowDiff: (show: boolean) => void;
  // FileTree sync — call after file operations on disk
  handlePathRenamed: (fromPath: string, toPath: string) => void;
  handlePathRemoved: (targetPath: string) => void;
}

function getLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    cc: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    md: "markdown",
    json: "json",
    // Notebooks render as cells via <NotebookView>; "json" is what its
    // unparseable-file fallback (and the diff view) highlights the file as.
    ipynb: "json",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    dockerfile: "dockerfile",
    toml: "toml",
    ini: "ini",
    env: "plaintext",
    txt: "plaintext",
    gitignore: "plaintext",
  };
  return map[ext] || "plaintext";
}

function getFileName(filePath: string): string {
  // Split on both POSIX (/) and Windows (\) separators so tab titles show the
  // bare filename for native Windows paths.
  return filePath.split(/[\\/]/).pop() || filePath;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  rootPath: null,
  openFiles: [],
  activeFilePath: null,
  showDiff: false,
  saveError: null,

  setRootPath: (path: string | null) => {
    set({ rootPath: path });
  },

  closeAllFiles: () => {
    set({ openFiles: [], activeFilePath: null, showDiff: false });
  },

  openFile: async (filePath: string) => {
    const { openFiles } = get();

    // Already open — just activate
    const existing = openFiles.find((f) => f.path === filePath);
    if (existing) {
      set({ activeFilePath: filePath });
      return;
    }

    try {
      const content = await window.electronAPI.fs.readFile(
        get().rootPath ?? "",
        filePath,
      );
      const name = getFileName(filePath);
      const language = getLanguage(name);

      set({
        openFiles: [
          ...openFiles,
          {
            path: filePath,
            name,
            content,
            originalContent: content,
            language,
            isModified: false,
          },
        ],
        activeFilePath: filePath,
      });
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  },

  closeFile: (filePath: string) => {
    const { openFiles, activeFilePath } = get();
    const newFiles = openFiles.filter((f) => f.path !== filePath);
    let newActive = activeFilePath;

    if (activeFilePath === filePath) {
      const idx = openFiles.findIndex((f) => f.path === filePath);
      if (newFiles.length > 0) {
        newActive = newFiles[Math.min(idx, newFiles.length - 1)].path;
      } else {
        newActive = null;
      }
    }

    set({ openFiles: newFiles, activeFilePath: newActive });
  },

  setActiveFile: (filePath: string) => {
    set({ activeFilePath: filePath });
  },

  updateContent: (filePath: string, content: string) => {
    const { openFiles } = get();
    set({
      openFiles: openFiles.map((f) =>
        f.path === filePath
          ? { ...f, content, isModified: content !== f.originalContent }
          : f,
      ),
    });
  },

  saveFile: async (filePath: string) => {
    const { openFiles } = get();
    const file = openFiles.find((f) => f.path === filePath);
    if (!file || !file.isModified) return;

    try {
      await window.electronAPI.fs.writeFile(
        get().rootPath ?? "",
        filePath,
        file.content,
      );
      set({
        // Re-read openFiles: content may have changed during the async write.
        openFiles: get().openFiles.map((f) =>
          f.path === filePath
            ? {
                ...f,
                originalContent: file.content,
                isModified: f.content !== file.content,
              }
            : f,
        ),
        saveError: null,
      });
    } catch (err) {
      // A swallowed save error means the user's edit silently never reached
      // disk — surface it so it can't be mistaken for a successful save.
      console.error("Failed to save file:", err);
      set({
        saveError: {
          path: filePath,
          name: getFileName(filePath),
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  },

  clearSaveError: () => {
    set({ saveError: null });
  },

  toggleDiff: () => {
    set((s) => ({ showDiff: !s.showDiff }));
  },

  // Explicit set, for callers that need a known end state rather than a flip —
  // the worktree diff auto-open must land on "diff shown" regardless of what
  // the toggle happened to be. Skips the set when unchanged.
  setShowDiff: (show: boolean) => {
    set((s) => (s.showDiff === show ? s : { showDiff: show }));
  },

  handlePathRenamed: (fromPath: string, toPath: string) => {
    const { openFiles, activeFilePath } = get();
    const updated = openFiles.map((f) => {
      if (f.path === fromPath) {
        const newName = getFileName(toPath);
        return {
          ...f,
          path: toPath,
          name: newName,
          language: getLanguage(newName),
        };
      }
      // Directory rename: f.path starts with fromPath + '/'
      if (f.path.startsWith(fromPath + "/")) {
        const newPath = toPath + f.path.slice(fromPath.length);
        return { ...f, path: newPath };
      }
      return f;
    });
    const newActive =
      activeFilePath === fromPath
        ? toPath
        : activeFilePath && activeFilePath.startsWith(fromPath + "/")
          ? toPath + activeFilePath.slice(fromPath.length)
          : activeFilePath;
    set({ openFiles: updated, activeFilePath: newActive });
  },

  handlePathRemoved: (targetPath: string) => {
    const { openFiles, activeFilePath } = get();
    const remaining = openFiles.filter(
      (f) => f.path !== targetPath && !f.path.startsWith(targetPath + "/"),
    );
    let newActive = activeFilePath;
    const activeWasRemoved =
      activeFilePath === targetPath ||
      (activeFilePath !== null && activeFilePath.startsWith(targetPath + "/"));
    if (activeWasRemoved) {
      newActive =
        remaining.length > 0 ? remaining[remaining.length - 1].path : null;
    }
    set({ openFiles: remaining, activeFilePath: newActive });
  },
}));
