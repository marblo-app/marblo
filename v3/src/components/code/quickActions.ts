import { stripAnsi } from "../../lib/ansi";

/**
 * 코드탭 경량 퀵액션의 **순수 로직** — 설계는 `docs/CODE-QUICK-ACTIONS.md`.
 *
 * 커서식 연속 자동완성이 아니라 **온디맨드 1회**다: 사용자가 선택하고 버튼을
 * 누른 그 순간에만, 이미 연결된 CLI(Claude Code / Codex)를 헤드리스로 한 번
 * 돌린다. 새 모델도, 자동완성 엔진도, 새 IPC 도 없다.
 *
 * 판단이 필요한 것은 전부 여기 모아 노드 환경에서 단위 테스트한다 —
 * 훅(`useCodeQuickAction`)과 컴포넌트에는 배선만 남는다.
 */

/** MVP 액션 2종. 주석/테스트 추가는 이 테이블에 행을 더하는 자리다. */
export type QuickActionId = "explain" | "fix";

/** 헤드리스 계약이 확인된 CLI. grok/antigravity 는 후속(§3.5). */
export type QuickActionCli = "claude" | "codex";

/**
 * 선호 순서. claude 가 앞인 이유는 시작하기 ①단계의 required 행이라
 * 사실상 모든 사용자가 이걸 갖고 있고, `claude:version` 으로 **해석된 절대
 * 경로**를 쓸 수 있어 구버전 바이너리에 가려질 위험이 없기 때문이다.
 */
export const QUICK_ACTION_CLI_ORDER: QuickActionCli[] = ["claude", "codex"];

export interface QuickActionCliCandidate {
  model: QuickActionCli;
  /** 설치 + 인증이 모두 끝났는가 (`cliSetupStore` 프로브 결과). */
  ready: boolean;
}

/**
 * 준비된 CLI 하나를 고른다. 하나도 없으면 null — 호출 측은 조용히 실패하지
 * 말고 원클릭 설치·사인인으로 유도해야 한다(§2.3).
 */
export function pickQuickActionCli(
  candidates: readonly QuickActionCliCandidate[],
): QuickActionCli | null {
  for (const model of QUICK_ACTION_CLI_ORDER) {
    if (candidates.some((c) => c.model === model && c.ready)) return model;
  }
  return null;
}

/**
 * 선택 길이 상한. 넘으면 `explain` 은 잘라 보내고(잘림 표시), `fix` 는
 * **거부한다** — 잘린 선택으로 만든 치환은 원래 범위와 어긋나 코드를 깬다.
 */
export const MAX_SELECTION_LINES = 200;

/** 선택 앞뒤로 함께 보내는 파일 컨텍스트 줄 수. */
export const CONTEXT_WINDOW_LINES = 30;

/** 헤드리스 1회 실행의 상한. 넘으면 PTY 를 kill 한다. */
export const QUICK_ACTION_TIMEOUT_MS = 120_000;

export function exceedsSelectionLimit(lineCount: number): boolean {
  return lineCount > MAX_SELECTION_LINES;
}

export interface QuickActionPromptInput {
  action: QuickActionId;
  filePath: string;
  /** Monaco 언어 id (`typescript`, `python`, …). 펜스 언어로도 쓴다. */
  language: string;
  /** 파일 전체 줄 (1-based 줄번호를 index+1 로 매핑). */
  fileLines: string[];
  /** 선택 시작/끝 줄 (1-based, 포함). */
  startLine: number;
  endLine: number;
  /** 답변 언어. 앱 로케일을 그대로 따른다. */
  locale: "ko" | "en";
}

export interface BuiltQuickActionPrompt {
  prompt: string;
  /** 선택이 상한을 넘어 잘렸는가 (`explain` 에서만 발생). */
  truncated: boolean;
}

/**
 * 언어 id 정규화. Monaco 의 언어 id 는 고정 집합이지만, 이 문자열은 프롬프트의
 * **펜스 줄**에 그대로 들어가므로 백틱·줄바꿈이 섞이면 펜스가 조기 종료된다.
 * 안전한 모양만 통과시키고 나머지는 버린다(표시용일 뿐이라 잃을 게 없다).
 */
function safeLanguage(language: string): string {
  return /^[a-z0-9+#-]{1,20}$/i.test(language) ? language : "";
}

function sliceLines(lines: string[], from: number, to: number): string[] {
  // 1-based 포함 구간 → 0-based slice. 범위를 벗어난 요청은 잘라낸다.
  const lo = Math.max(1, from);
  const hi = Math.min(lines.length, to);
  return lo > hi ? [] : lines.slice(lo - 1, hi);
}

function numbered(lines: string[], firstLineNo: number): string {
  return lines.map((l, i) => `${firstLineNo + i}\t${l}`).join("\n");
}

/**
 * 프롬프트 1개를 조립한다. 액션별 출력 규약이 여기 박혀 있다 —
 * `fix` 는 **펜스 코드블록 하나만** 요구하고(그래야 기계적으로 치환 가능),
 * `explain` 은 산문을 요구한다.
 */
export function buildQuickActionPrompt(
  input: QuickActionPromptInput,
): BuiltQuickActionPrompt {
  const { action, filePath, language, fileLines, locale } = input;
  const startLine = Math.max(1, input.startLine);
  const endLine = Math.max(startLine, input.endLine);

  const selected = sliceLines(fileLines, startLine, endLine);
  const truncated = selected.length > MAX_SELECTION_LINES;
  const selectedShown = truncated
    ? selected.slice(0, MAX_SELECTION_LINES)
    : selected;

  const before = sliceLines(
    fileLines,
    startLine - CONTEXT_WINDOW_LINES,
    startLine - 1,
  );
  const after = sliceLines(
    fileLines,
    endLine + 1,
    endLine + CONTEXT_WINDOW_LINES,
  );

  const fence = safeLanguage(language);
  const answerLang = locale === "en" ? "English" : "Korean";

  const parts: string[] = [];
  parts.push(
    action === "explain"
      ? "You are a code reading assistant embedded in an editor. Explain the SELECTED code."
      : "You are a code fixing assistant embedded in an editor. Rewrite the SELECTED code.",
  );
  parts.push(`File: ${filePath}`);
  parts.push(`Language: ${fence || "unknown"}`);
  parts.push(`Selected lines: ${startLine}-${endLine}`);

  if (before.length > 0) {
    parts.push(
      `--- context before (lines ${startLine - before.length}-${startLine - 1}) ---\n${numbered(
        before,
        startLine - before.length,
      )}`,
    );
  }
  parts.push(
    `--- SELECTED (lines ${startLine}-${startLine + selectedShown.length - 1}) ---\n${numbered(
      selectedShown,
      startLine,
    )}`,
  );
  if (truncated) {
    parts.push(
      `(the selection was truncated at ${MAX_SELECTION_LINES} lines; ${
        selected.length - MAX_SELECTION_LINES
      } more lines follow)`,
    );
  }
  if (after.length > 0) {
    parts.push(
      `--- context after (lines ${endLine + 1}-${endLine + after.length}) ---\n${numbered(
        after,
        endLine + 1,
      )}`,
    );
  }

  if (action === "explain") {
    parts.push(
      [
        `Answer in ${answerLang}. Be concise: at most 8 short lines.`,
        "Say what the selected code does, then note anything surprising, risky, or broken.",
        "Plain prose and short bullets only — do not restate the code, do not propose a full rewrite.",
        "Do not read or modify any file. Everything you need is above.",
      ].join(" "),
    );
  } else {
    parts.push(
      [
        "Rewrite ONLY the selected lines so they are correct and idiomatic; keep the surrounding code working.",
        "Preserve the original indentation of the first selected line so the result can be pasted back verbatim.",
        "Do not read or modify any file — return the replacement as text.",
        "",
        "Output format (strict): a SINGLE fenced code block containing the full replacement for the selected lines, and nothing else.",
        "No explanation before or after the block.",
        "",
        `\`\`\`${fence}`,
        "<replacement lines here>",
        "```",
      ].join("\n"),
    );
  }

  return { prompt: parts.join("\n\n"), truncated };
}

/**
 * 헤드리스 1회 실행 argv. `pty.spawn(file, args)` 는 셸을 거치지 않으므로
 * 프롬프트에 줄바꿈·따옴표·백틱이 있어도 그대로 안전하게 전달된다.
 *
 * - claude: `--print` → stdout 이 답변 평문.
 * - codex : `exec --json` → JSONL 이벤트. `--sandbox read-only` 로 파일 수정을
 *   원천 차단하고, `--color never` 로 ANSI 를, `--skip-git-repo-check` 로
 *   비-git 폴더에서의 거부를 없앤다.
 */
export function headlessArgs(cli: QuickActionCli, prompt: string): string[] {
  return cli === "claude"
    ? ["--print", prompt]
    : [
        "exec",
        "--json",
        "--color",
        "never",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        prompt,
      ];
}

/** PTY 는 개행을 CRLF 로 돌려준다. ANSI 를 걷고 개행을 정규화한다. */
function normalizePtyText(raw: string): string {
  return stripAnsi(raw).replace(/\r\n/g, "\n").replace(/\r/g, "");
}

/**
 * CLI 별 stdout → 답변 텍스트.
 *
 * codex 의 사람용 stdout 은 헤더 블록·프롬프트 에코·"tokens used" 가 섞여 있어
 * 꼬리를 자르는 식의 파싱은 버전이 바뀌면 깨진다. 그래서 `--json` 의 구조화된
 * 이벤트에서 `agent_message` 만 뽑는다. JSON 이 아닌 줄(경고·진행 표시)은
 * 조용히 건너뛴다.
 */
export function parseHeadlessOutput(cli: QuickActionCli, raw: string): string {
  const text = normalizePtyText(raw);
  if (cli === "claude") return text.trim();

  const messages: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const item = (event as { item?: { type?: string; text?: string } })?.item;
    if (item?.type === "agent_message" && typeof item.text === "string") {
      messages.push(item.text);
    }
  }
  return messages.join("\n\n").trim();
}

/**
 * `fix` 응답에서 치환할 코드를 꺼낸다. 규약대로 펜스 블록 하나면 그 안쪽,
 * 여러 개면 **가장 긴 것**(모델이 설명용 짧은 예시를 곁들이는 경우)을 쓴다.
 * 펜스가 없으면 null — 호출 측은 원문을 그대로 보여줘야 한다. 억지로 전체를
 * 코드로 취급하면 산문을 파일에 붙여넣는 사고가 난다.
 */
export function extractReplacementCode(text: string): string | null {
  const blocks: string[] = [];
  const fence = /^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) blocks.push(match[1]);
  if (blocks.length === 0) return null;

  let best = blocks[0];
  for (const b of blocks) if (b.length > best.length) best = b;
  // 펜스 안쪽의 마지막 개행은 펜스 문법의 일부지 코드가 아니다.
  return best.replace(/\n$/, "");
}

export type DiffRowKind = "context" | "add" | "del";

export interface DiffRow {
  kind: DiffRowKind;
  text: string;
}

/** LCS DP 를 포기하는 크기. 선택 상한(200줄)에서는 도달하지 않는다. */
const DIFF_CELL_BUDGET = 250_000;

/**
 * 줄 단위 diff (LCS). 인라인 diff 위젯이 그리는 -/+ 행의 소스.
 *
 * 응답이 비정상적으로 길어 DP 가 커지면 정확한 diff 를 포기하고 "전부 삭제 →
 * 전부 추가" 블록으로 떨어진다. 느려지거나 멈추느니 덜 예쁜 diff 가 낫다.
 */
export function diffLines(
  oldLines: readonly string[],
  newLines: readonly string[],
): DiffRow[] {
  const n = oldLines.length;
  const m = newLines.length;
  if (n === 0 && m === 0) return [];
  if (n * m > DIFF_CELL_BUDGET) {
    return [
      ...oldLines.map((text): DiffRow => ({ kind: "del", text })),
      ...newLines.map((text): DiffRow => ({ kind: "add", text })),
    ];
  }

  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        oldLines[i] === newLines[j]
          ? lcs[(i + 1) * width + (j + 1)] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + (j + 1)]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ kind: "context", text: oldLines[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + (j + 1)]) {
      rows.push({ kind: "del", text: oldLines[i] });
      i++;
    } else {
      rows.push({ kind: "add", text: newLines[j] });
      j++;
    }
  }
  while (i < n) rows.push({ kind: "del", text: oldLines[i++] });
  while (j < m) rows.push({ kind: "add", text: newLines[j++] });
  return rows;
}

/** diff 요약 — 위젯 헤더의 "+n −m". */
export function summarizeDiff(rows: readonly DiffRow[]): {
  added: number;
  removed: number;
  unchanged: boolean;
} {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.kind === "add") added++;
    else if (r.kind === "del") removed++;
  }
  return { added, removed, unchanged: added === 0 && removed === 0 };
}
