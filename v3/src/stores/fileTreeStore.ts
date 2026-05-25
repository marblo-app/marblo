import { create } from "zustand";

export type ClipboardOp = "copy" | "cut" | null;

interface FileTreeState {
  selectedPath: string | null;
  clipboardOp: ClipboardOp;
  clipboardPath: string | null;

  setSelected: (path: string | null) => void;
  copyToClipboard: (path: string) => void;
  cutToClipboard: (path: string) => void;
  clearClipboard: () => void;
}

export const useFileTreeStore = create<FileTreeState>((set) => ({
  selectedPath: null,
  clipboardOp: null,
  clipboardPath: null,

  setSelected: (path) => set({ selectedPath: path }),
  copyToClipboard: (path) => set({ clipboardOp: "copy", clipboardPath: path }),
  cutToClipboard: (path) => set({ clipboardOp: "cut", clipboardPath: path }),
  clearClipboard: () => set({ clipboardOp: null, clipboardPath: null }),
}));
