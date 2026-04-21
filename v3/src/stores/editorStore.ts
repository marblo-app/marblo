import { create } from 'zustand';

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  language: string;
  isModified: boolean;
}

interface EditorState {
  rootPath: string | null;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  showDiff: boolean;

  setRootPath: (path: string) => void;
  openFile: (filePath: string) => Promise<void>;
  closeFile: (filePath: string) => void;
  setActiveFile: (filePath: string) => void;
  updateContent: (filePath: string, content: string) => void;
  saveFile: (filePath: string) => Promise<void>;
  toggleDiff: () => void;
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c', h: 'c',
    cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    md: 'markdown',
    json: 'json',
    yaml: 'yaml', yml: 'yaml',
    xml: 'xml',
    html: 'html', htm: 'html',
    css: 'css',
    scss: 'scss', sass: 'scss',
    less: 'less',
    sql: 'sql',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    dockerfile: 'dockerfile',
    toml: 'toml',
    ini: 'ini',
    env: 'plaintext',
    txt: 'plaintext',
    gitignore: 'plaintext',
  };
  return map[ext] || 'plaintext';
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  rootPath: null,
  openFiles: [],
  activeFilePath: null,
  showDiff: false,

  setRootPath: (path: string) => {
    set({ rootPath: path });
  },

  openFile: async (filePath: string) => {
    const { openFiles } = get();

    // Already open — just activate
    const existing = openFiles.find(f => f.path === filePath);
    if (existing) {
      set({ activeFilePath: filePath });
      return;
    }

    try {
      const content = await window.electronAPI.fs.readFile(filePath);
      const name = getFileName(filePath);
      const language = getLanguage(name);

      set({
        openFiles: [...openFiles, {
          path: filePath,
          name,
          content,
          originalContent: content,
          language,
          isModified: false,
        }],
        activeFilePath: filePath,
      });
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  },

  closeFile: (filePath: string) => {
    const { openFiles, activeFilePath } = get();
    const newFiles = openFiles.filter(f => f.path !== filePath);
    let newActive = activeFilePath;

    if (activeFilePath === filePath) {
      const idx = openFiles.findIndex(f => f.path === filePath);
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
      openFiles: openFiles.map(f =>
        f.path === filePath
          ? { ...f, content, isModified: content !== f.originalContent }
          : f
      ),
    });
  },

  saveFile: async (filePath: string) => {
    const { openFiles } = get();
    const file = openFiles.find(f => f.path === filePath);
    if (!file || !file.isModified) return;

    try {
      await window.electronAPI.fs.writeFile(filePath, file.content);
      set({
        openFiles: openFiles.map(f =>
          f.path === filePath
            ? { ...f, originalContent: f.content, isModified: false }
            : f
        ),
      });
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  },

  toggleDiff: () => {
    set(s => ({ showDiff: !s.showDiff }));
  },
}));
