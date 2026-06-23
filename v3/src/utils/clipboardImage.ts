// Clipboard image paste helpers.
//
// Pasting an image into a chat input used to drop only the OS-provided
// filename text (or nothing), so the agent (Claude Code) never saw the image.
// These helpers turn a clipboard image into an absolute file path on disk that
// the agent can open with its Read tool:
//   - a bitmap image (screenshot, copy-from-editor) is written to a temp PNG by
//     the main process (clipboard:getImagePath) and we inject that path;
//   - image file(s) copied from the OS file manager resolve to their real
//     absolute paths (clipboard:getFilePaths).
//
// Both IPC handlers already live in electron/main.ts, so this is renderer-only.

import type React from "react";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|tiff?|avif|ico)$/i;

function isImagePath(p: string): boolean {
  return IMAGE_EXT.test(p);
}

/**
 * Synchronous check: does this paste event carry an image (bitmap or image
 * file) rather than plain text? Used to decide whether to intercept the paste
 * — plain-text pastes are left untouched so existing behavior is preserved.
 */
export function clipboardEventHasImage(e: React.ClipboardEvent): boolean {
  const dt = e.clipboardData;
  if (!dt) return false;
  // Bitmap image item (screenshot, copy-from-image-editor, copy-image-from-web)
  for (const item of Array.from(dt.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) return true;
  }
  // Image file(s) copied from the OS file manager
  for (const file of Array.from(dt.files)) {
    if (file.type.startsWith("image/") || isImagePath(file.name)) return true;
  }
  return false;
}

/**
 * Resolve any image currently on the clipboard to absolute path(s) on disk that
 * an agent can Read. Returns [] when the clipboard holds no image.
 */
export async function resolveClipboardImagePaths(): Promise<string[]> {
  const clip = window.electronAPI?.clipboard;
  if (!clip) return [];

  // 1) Bitmap image → main process saves a temp PNG and returns its path.
  try {
    const imgPath = await clip.getImagePath();
    if (imgPath) return [imgPath];
  } catch {
    /* ignore — fall through to file paths */
  }

  // 2) Image file(s) copied from the file manager → real absolute paths.
  try {
    const files = await clip.getFilePaths();
    const images = files.filter(isImagePath);
    if (images.length > 0) return images;
  } catch {
    /* ignore */
  }

  return [];
}

/**
 * Compute the result of inserting `insert` at the current caret of a controlled
 * <input>/<textarea>, padding with spaces so the path stays whitespace-
 * delimited from surrounding text. Returns the new value and the caret offset
 * to restore after React re-renders.
 */
export function insertAtCaret(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  insert: string,
): { value: string; caret: number } {
  const current = el?.value ?? "";
  if (!el || el.selectionStart == null) {
    const sep = current && !/\s$/.test(current) ? " " : "";
    const next = current + sep + insert;
    return { value: next, caret: next.length };
  }

  const start = el.selectionStart;
  const end = el.selectionEnd ?? start;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const padBefore = before && !/\s$/.test(before) ? " " : "";
  const padAfter = after && !/^\s/.test(after) ? " " : "";
  const piece = padBefore + insert + padAfter;
  return { value: before + piece + after, caret: start + piece.length };
}

/**
 * Resolve clipboard content for an xterm paste: prefer text (the common case,
 * one cheap IPC round-trip) and fall back to image path(s) only when there is
 * no text — so a pasted screenshot is injected as a Readable absolute path.
 */
export async function resolveClipboardForTerminal(): Promise<string | null> {
  const clip = window.electronAPI?.clipboard;
  if (!clip) return null;

  try {
    const text = await clip.readText();
    if (text) return text;
  } catch {
    /* ignore — fall through to image */
  }

  const paths = await resolveClipboardImagePaths();
  return paths.length > 0 ? paths.join(" ") : null;
}
