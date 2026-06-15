/**
 * Dangerous-command detection for the PTY stdin write chokepoint.
 *
 * Marblo runs every agent in YOLO mode (--dangerously-skip-permissions /
 * approval=never), so the harness's own "are you sure?" confirm for
 * destructive commands is fully disabled. Workers are sandboxed by worktree
 * isolation, but the orchestrator drives the main checkout, so a destructive
 * command injected into its PTY would run unguarded.
 *
 * This module is a PURE function — no I/O, no Electron, no side effects — so it
 * is trivially unit-testable. Callers (pty-manager / orchestrator-manager) wire
 * the result into warning logs / events and, for the non-isolated orchestrator
 * path, an optional block policy.
 */

export type DangerSeverity = "high" | "medium";

export interface DangerMatch {
  /** Whether any dangerous pattern matched the text. */
  matched: boolean;
  /** Human-readable name of the matched pattern (empty when no match). */
  pattern: string;
  /** Severity of the matched pattern. Meaningless when `matched` is false. */
  severity: DangerSeverity;
}

interface DangerPattern {
  name: string;
  severity: DangerSeverity;
  test: (text: string) => boolean;
}

/**
 * Return the flag clusters that immediately follow a given command token.
 * e.g. for "rm -rf -v ./x" and command "rm" → [" -rf -v"].
 * Only contiguous leading flag groups are captured so we don't pick up flags
 * belonging to a later, unrelated command on the same line.
 */
function flagsFor(text: string, command: string): string[] {
  const re = new RegExp(`\\b${command}\\b((?:\\s+-{1,2}[\\w-]+)+)`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function hasFlag(flags: string, short: string, long: string): boolean {
  // short: a single letter that may be bundled (e.g. -rf contains r and f).
  // long: the --word form.
  if (new RegExp(`--${long}\\b`, "i").test(flags)) return true;
  // A single-dash cluster that contains the letter (not part of a --word).
  return new RegExp(`(?:^|\\s)-[a-z]*${short}[a-z]*\\b`, "i").test(flags);
}

/** `rm -rf` (and `rm -fr`, `rm -r -f`, `rm --recursive --force`). */
function isRmRf(text: string): boolean {
  return flagsFor(text, "rm").some(
    (flags) => hasFlag(flags, "r", "recursive") && hasFlag(flags, "f", "force"),
  );
}

/** `git push --force` / `git push -f` (incl. --force-with-lease). */
function isForcePush(text: string): boolean {
  const re = /\bgit\s+push\b([^\n;|&]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const rest = m[1];
    if (/--force(?:-with-lease)?\b/i.test(rest)) return true;
    if (/(?:^|\s)-[a-z]*f[a-z]*\b/i.test(rest)) return true;
  }
  return false;
}

const PATTERNS: DangerPattern[] = [
  { name: "rm -rf", severity: "high", test: isRmRf },
  { name: "git push --force", severity: "high", test: isForcePush },
  {
    name: "npm publish",
    severity: "high",
    test: (t) => /\bnpm\s+publish\b/i.test(t),
  },
  {
    name: "drop table",
    severity: "high",
    test: (t) => /\bdrop\s+table\b/i.test(t),
  },
  {
    name: "curl | bash",
    severity: "high",
    test: (t) =>
      /\b(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i.test(t),
  },
  {
    name: "mkfs",
    severity: "high",
    test: (t) => /\bmkfs(?:\.\w+)?\b/i.test(t),
  },
  {
    name: "dd of=",
    severity: "high",
    test: (t) => /\bdd\b[^\n]*\bof=/i.test(t),
  },
  {
    name: "vercel --prod",
    severity: "medium",
    test: (t) => /\bvercel\b[^\n]*--prod\b/i.test(t),
  },
  {
    name: "chmod 777",
    severity: "medium",
    test: (t) => /\bchmod\b[^\n]*\b0?777\b/i.test(t),
  },
  {
    name: "sudo",
    severity: "medium",
    test: (t) => /\bsudo\b/i.test(t),
  },
];

const NO_MATCH: DangerMatch = {
  matched: false,
  pattern: "",
  severity: "medium",
};

/**
 * Scan `text` for known dangerous shell command patterns.
 *
 * Returns the first match in priority order (high-severity patterns first).
 * Designed for zero false positives on benign commands such as
 * `git status`, `rm file.txt`, and `npm test`.
 */
export function detectDangerousCommand(text: string): DangerMatch {
  if (!text) return NO_MATCH;
  for (const p of PATTERNS) {
    if (p.test(text)) {
      return { matched: true, pattern: p.name, severity: p.severity };
    }
  }
  return NO_MATCH;
}
