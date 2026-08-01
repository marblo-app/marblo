import { create } from "zustand";

export type ClipboardOp = "copy" | "cut" | null;

/**
 * "숨김 항목 표시" 토글 (티켓 D8yiihCWgDMd3AU7xkEy).
 *
 * 파이썬 프로젝트에서는 `.venv` 가 보여야 하고, 나머지 프로젝트에서는 트리가
 * 깨끗해야 한다 — 그래서 **프로젝트 단위**로 기억한다. 기본값은 항상 false 라
 * 켜지 않은 프로젝트의 트리는 이전과 완전히 동일하다.
 *
 * 키는 프로젝트 id 를, 프로젝트에 안 묶인 폴더(둘러보기)라면 그 폴더 경로를
 * 쓴다 — 호출자가 정한다.
 */
const SHOW_HIDDEN_KEY = "marblo:v3:fileTree:showHidden";

type ShowHiddenMap = Record<string, boolean>;

function readShowHiddenMap(): ShowHiddenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SHOW_HIDDEN_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out: ShowHiddenMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeShowHiddenMap(map: ShowHiddenMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SHOW_HIDDEN_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled — 표시 상태는 세션 안에서만 유지되고 끝 */
  }
}

interface FileTreeState {
  selectedPath: string | null;
  clipboardOp: ClipboardOp;
  clipboardPath: string | null;
  /**
   * 프로젝트별 "숨김 항목(.venv 등)·루트 gitignore 항목까지 나열" 여부.
   * 없는 키는 false — 즉 기본은 언제나 감춤.
   */
  showHiddenByScope: ShowHiddenMap;

  setSelected: (path: string | null) => void;
  copyToClipboard: (path: string) => void;
  cutToClipboard: (path: string) => void;
  clearClipboard: () => void;
  setShowHidden: (scope: string, value: boolean) => void;
  toggleShowHidden: (scope: string) => void;
}

/** 이 스코프에서 숨김 항목을 표시할지 (없으면 false). */
export function isShowHidden(map: ShowHiddenMap, scope: string): boolean {
  return map[scope] === true;
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
  selectedPath: null,
  clipboardOp: null,
  clipboardPath: null,
  showHiddenByScope: readShowHiddenMap(),

  setSelected: (path) => set({ selectedPath: path }),
  copyToClipboard: (path) => set({ clipboardOp: "copy", clipboardPath: path }),
  cutToClipboard: (path) => set({ clipboardOp: "cut", clipboardPath: path }),
  clearClipboard: () => set({ clipboardOp: null, clipboardPath: null }),
  setShowHidden: (scope, value) => {
    if (!scope) return;
    const current = get().showHiddenByScope;
    if (isShowHidden(current, scope) === value) return;
    const next = { ...current, [scope]: value };
    writeShowHiddenMap(next);
    set({ showHiddenByScope: next });
  },
  toggleShowHidden: (scope) =>
    get().setShowHidden(scope, !isShowHidden(get().showHiddenByScope, scope)),
}));
