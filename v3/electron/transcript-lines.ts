/**
 * TUI 화면 **줄 분류기** — 렌더러(부트 게이트)와 메인 프로세스(컴포저 판정)가
 * 공유하는 단일 출처.
 *
 * 원래 이 코드는 `src/lib/orchestratorBootGate.ts` 안에 있었다. 티켓
 * RtyOMpOArfI7a5JNSzsg 에서 **메인 프로세스**(`PtyManager`)가 답을 주입하기 직전에
 * 같은 판정을 해야 해서 여기로 옮겼다. 옮긴 이유는 하나다 — **복제하지 않으려고.**
 * 화면을 읽는 규칙이 둘로 갈리면 한쪽이 고쳐질 때 다른 쪽이 조용히 낡는다.
 * (방향이 `electron/` 인 것은 `electron/tsconfig.json` 의 `rootDir: "."` 때문이다:
 *  메인은 `src/` 를 못 읽고, 렌더러는 vite 가 `electron/` 을 번들해 준다. 이미
 *  `src/lib/stuckLane.ts` → `electron/agent-stall-policy` 등이 그 방향이다.)
 *
 * `orchestratorBootGate.ts` 는 여기서 재수출하므로 기존 import 는 전부 그대로 산다.
 *
 * ★정규식은 전부 **실측 바이트**(`tests/fixtures/pty`) 기준이다. 클로드는 단어
 * 사이를 커서 이동으로 칠해 공백이 사라지므로(`❯1.No,exit`) 공백은 `\s*` 로 쓴다.
 */
import { normalizeLine } from "./ansi";

export type TranscriptLineKind =
  | "blank"
  | "busy"
  | "banner"
  | "chrome"
  | "user"
  | "tool"
  | "assistant"
  | "other";


/** 진행 중 상태줄 — Claude/Codex `esc to interrupt`, Gemini `esc to cancel`. */
const BUSY_RE = /esc\s*to\s*(interrupt|cancel)/i;

/**
 * CLI 부트 배너. 실측 바이트 기준(`tests/fixtures/pty`):
 *  - codex 0.149.0: `│ >_ OpenAI Codex (v0.149.0) │`, `model:`, `directory:`,
 *    `permissions: YOLO mode`, `Tip: …`
 *  - claude 2.1.238: `╭───Claude Codev2.1.238───╮`(커서 이동으로 칠해 공백이 없다),
 *    `Welcome back!`, `Tips for getting started`, `WARNING: Claude Code running in
 *    Bypass Permissions mode`, `⏵⏵ bypass permissions on`
 *  - gemini: ASCII 아트 + `Tips for getting started`
 * ★공백은 전부 `\s*` — 클로드는 커서 이동으로 칠해 공백이 사라진다(fixture README).
 */
const BANNER_RES: RegExp[] = [
  /OpenAI\s*Codex\s*\(v/i,
  /Claude\s*Code\s*v\d/i,
  /Welcome\s*back!/i,
  /Tips\s*for\s*getting\s*started/i,
  /What's\s*new/i,
  /Bypass\s*Permissions\s*mode/i,
  /bypass\s*permissions\s*on/i,
  /YOLO\s*mode/i,
  /^\s*│?\s*(model|directory|permissions):\s/i,
  /^\s*Tip:\s/i,
  /Transcript\s*saving\s*is\s*off/i,
];

/**
 * ★**빈 컴포저**의 양성 증거 — 화살표만 있고 뒤가 비어 있는 프롬프트 줄.
 * 실측: 클로드 준비 화면은 `\x1b[39m❯ \x1b[7m \x1b[5G\x1b[27m\x1b[K` 로 그려서
 * 정규화하면 `❯ ` 만 남는다(`tests/fixtures/pty/claude-composer-after-consent.json`).
 *
 * `CHROME_RES`(부트 게이트가 "사람의 말도 모델의 말도 아니다" 로 거르는 목록)와
 * 컴포저 판정이 **같은 패턴을 공유한다** — 둘이 갈리면 한쪽만 낡는다.
 */
export const EMPTY_PROMPT_RE = /^\s*[❯›]\s*$/;

/** 컴포저·상태바·상자 테두리 — 사람의 말도 모델의 말도 아니다. */
const CHROME_RES: RegExp[] = [
  /Ask\s*Codex\s*to\s*do\s*anything/i,
  /\?\s*for\s*shortcuts/i,
  /tab\s*to\s*queue/i,
  /context\s*left/i,
  /shift\+tab\s*to\s*cycle/i,
  /Not\s*logged\s*in/i,
  /Worked\s*for\s*\d/i,
  /^\s*[─│╭╮╰╯┃━┌┐└┘├┤═║╔╗╚╝╠╣\s]*$/, // 상자 선만 있는 줄
  EMPTY_PROMPT_RE, // 빈 프롬프트 화살표
];

/**
 * 사용자 셀 — Claude `> text`, Codex `› text`(또는 `▌ text`). 우리가 주입한 부트
 * 프롬프트의 에코가 여기로 분류된다(`You are the Marblo Orchestrator Agent…`).
 */
const USER_RE = /^\s*[›>▌]\s+\S/;

/**
 * tool call 셀과 그 출력.
 *  - Claude: `⏺ Bash(cmd)`, `⏺ Read(file)`, `⏺ marblo - get_agent_skill (MCP)(…)`,
 *    결과 `⎿ …`
 *  - Codex: `• Called marblo.get_agent_skill({…})`, `• Ran …`, `• Explored`,
 *    `• Updated Plan`, 결과 `└ …`
 * 동사 목록은 닫힌 집합이 아니다 — 모르는 동사는 어시스턴트로 오인될 수 있지만
 * (그 툴 출력 한 덩이가 보일 뿐), 배너·프롬프트 에코는 그보다 앞이라 새지 않는다.
 */
const CODEX_TOOL_VERBS =
  "Called|Ran|Running|Explored|Exploring|Read|Reading|Searched|Searching|Listed|Listing|Edited|Editing|Added|Adding|Updated|Updating|Proposed|Working|Worked|Thinking|Booting|Viewed|Viewing|Wrote|Writing|Created|Creating|Deleted|Deleting|Moved|Moving|Renamed|Renaming|Executed|Executing|Interacted|Waited|Waiting|Resumed|Sent|Loading|Reasoning|Opened|Opening|Fetched|Fetching|Checked|Checking|Applied|Applying|Reverted|Reverting|Plan|Change";
const TOOL_RES: RegExp[] = [
  new RegExp(`^\\s*•\\s+(?:${CODEX_TOOL_VERBS})\\b`, "i"),
  /^\s*⏺\s+[A-Za-z_][\w.-]*\s*\(/, // ⏺ Bash(…)
  /^\s*⏺\s+[\w.-]+\s+-\s+[\w.-]+\s+\(MCP\)/i, // ⏺ marblo - tool (MCP)(…)
  /^\s*[⎿└├]\s/, // 결과 블록
];

/** 어시스턴트 발화 셀 — Claude `⏺ `, Codex `• `, Gemini `✦ `. 열 0 에서만 인정. */
const ASSISTANT_RE = /^[⏺•✦]\s+\S/;

export function classifyTranscriptLine(stripped: string): TranscriptLineKind {
  const line = stripped.replace(/\s+$/, "");
  if (line.trim().length === 0) return "blank";
  if (BANNER_RES.some((re) => re.test(line))) return "banner";
  if (BUSY_RE.test(line)) return "busy";
  if (CHROME_RES.some((re) => re.test(line))) return "chrome";
  if (USER_RE.test(line)) return "user";
  if (TOOL_RES.some((re) => re.test(line))) return "tool";
  if (ASSISTANT_RE.test(line)) return "assistant";
  return "other";
}

/**
 * ★원시 줄 하나에 TUI 가 **여러 조각**을 싣는다. 인라인 TUI(codex/ratatui)는
 * 히스토리 줄을 `\n` + 텍스트로 끼워 넣은 뒤, 줄바꿈 없이 커서를 절대좌표로
 * 옮겨(`CSI r`, `CSI 21;1H`) 컴포저·상태줄을 다시 그린다. `\n` 으로만 자르면
 * "• 안녕하세요 …  › Ask Codex to do anything" 이 한 줄이 되어 인사말이 컴포저
 * 크롬으로 오인된다(실측: 한 줄짜리 인사말이 게이트를 못 열었다).
 *
 * 그래서 **세로·절대 커서 이동**(`H`/`f`/`d`/`A`/`B`/`E`/`F`, 화면 지움 `J`, 스크롤
 * 영역 `r`, 역인덱스 `ESC M`, alt-screen 전환)을 조각 경계로 삼아 조각마다 분류하고
 * 가장 높은 우선순위를 줄의 종류로 삼는다. 가로 이동(`CSI G`/`C`/`D`)은 경계가
 * 아니다 — 클로드는 단어 사이를 `CSI 6G` 로 칠해서(`bypass\x1b[6Gpermissions`)
 * 거기서 자르면 배너 마커가 쪼개진다(fixture README).
 */
/* eslint-disable no-control-regex -- 커서 이동 시퀀스를 경계로 삼는다 */
const SEGMENT_BOUNDARY_RE =
  /\x1b\[[0-9;]*[HfJrABEFd]|\x1bM|\x1b\[\?1049[hl]|\x1b\[\?2026[hl]/g;
/* eslint-enable no-control-regex */

/**
 * ★조각 하나를 분류용 텍스트로. **꼬리 CR 을 떼고** 정규화한다.
 *
 * 실측(`tests/fixtures/pty/claude-composer-after-consent.json`)에서 클로드는
 * 컴포저를 `…❯ \x1b[7m \x1b[5G\x1b[27m\x1b[K\r` 로 그린다 — 조각 **끝**에 CR 이
 * 붙는다(다음 조각을 0열부터 그리려고). `normalizeLine` 의 "마지막 CR 뒤만
 * 남긴다" 규칙에 그 꼬리 CR 이 걸리면 조각 전체가 빈 문자열이 되어, 있는 화살표를
 * 못 본다. 부트 게이트가 줄 끝에서 하던 처리(`raw.replace(/\r+$/, "")`)와 같은
 * 처리를 **조각 단위**로도 해야 한다는 뜻이다. 조각 중간의 CR 은 진짜 덮어쓰기라
 * 손대지 않는다.
 */
function segmentText(segment: string): string {
  return normalizeLine(segment.replace(/\r+$/, ""));
}

/** 조각이 여럿일 때 줄의 종류 — 높은 것이 이긴다. */
const KIND_PRIORITY: Record<TranscriptLineKind, number> = {
  banner: 7,
  assistant: 6,
  user: 5,
  tool: 4,
  busy: 3,
  chrome: 2,
  other: 1,
  blank: 0,
};

/** 원시(ANSI 포함) 줄 하나 → 종류. 조각별 `classifyTranscriptLine` 의 최대값. */
export function classifyTranscriptRaw(raw: string): TranscriptLineKind {
  let best: TranscriptLineKind = "blank";
  for (const segment of raw.split(SEGMENT_BOUNDARY_RE)) {
    if (!segment) continue;
    const kind = classifyTranscriptLine(segmentText(segment));
    if (KIND_PRIORITY[kind] > KIND_PRIORITY[best]) best = kind;
    if (best === "banner") break;
  }
  return best;
}

// ── 컴포저 판정 (티켓 RtyOMpOArfI7a5JNSzsg) ────────────────────────────────
//
// 왜 별도 종류가 필요한가: 부트 게이트가 쓰는 `TranscriptLineKind` 는 "이 줄을
// 사용자에게 보여줄 것인가" 를 가른다. 컴포저 판정이 묻는 것은 다른 질문이다 —
// **지금 이 PTY 에 글자를 밀어 넣어도 되는가.** 두 질문의 답이 갈리는 자리가
// 실제로 있다: `❯ 1. Yes` 는 게이트에겐 그냥 chrome/other 지만, 주입하는 쪽에는
// "첫 글자가 선택으로 소비된다" 는 치명적 신호다(#1160 S5).
//
// ★이 판정은 **양성 증거만** 쓴다. 모르면 `null` 을 돌려주고, 부르는 쪽이
//   `indeterminate` 로 떨어뜨린다(#1157·#1160 의 3분기 규율).

/** 한 줄이 컴포저에 대해 말해 주는 것. 아무것도 안 말해 주면 `null`. */
export type ComposerLineKind = "empty" | "text" | "dialog";

/**
 * 확인 다이얼로그의 양성 증거.
 *
 * 실측(`tests/fixtures/pty/claude-first-run-consent.json`,
 * `claude-folder-trust.json`)에서 클로드의 선택창은 이렇게 그려진다 — 공백이
 * 커서 이동으로 사라진 뒤의 모습이다:
 *
 *   ❯1.No,exit
 *   2.Yes,Iaccept
 *   Entertoconfirm·Esctocancel
 *
 * ★`Esc to cancel` 은 쓰지 않는다 — 그것은 제미나이의 **진행 중 상태줄**이기도
 *   해서(`BUSY_RE`) 일하는 에이전트를 다이얼로그로 오인한다.
 */
const DIALOG_RES: RegExp[] = [
  /^\s*[❯›]\s*\d+\s*\./, // 선택자가 붙은 번호 항목 — `❯1.No,exit`
  /Enter\s*to\s*confirm/i, // 클로드 선택창 푸터
  /\[\s*y\s*\/\s*n\s*\]/i, // `[y/n]`
  /\(\s*y(?:es)?\s*\/\s*n(?:o)?\s*\)/i, // `(y/n)` · `(yes/no)`
  /Do\s*you\s*want\s*to\s*(proceed|continue|allow|trust)/i,
  /Do\s*you\s*trust\s*this\s*folder/i,
];

/**
 * 자리표시자(placeholder) = **빈** 컴포저. 자리표시자는 정의상 내용이 없을 때만
 * 그려진다. 실측 코덱스 준비 화면: `› Ask Codex to do anything`
 * (`tests/fixtures/pty/codex-ready-composer.json`).
 */
const PLACEHOLDER_RES: RegExp[] = [
  /^\s*[❯›]?\s*Ask\s*Codex\s*to\s*do\s*anything/i,
  /^\s*[❯›]?\s*Try\s*"/i, // 제미나이 자리표시자
];

/**
 * 내용이 든 컴포저.
 *
 * ★화살표 집합을 `[❯›]` 로 **좁힌 것이 핵심**이다. `USER_RE` 는 `[›>▌]` 까지
 *   받는데, 클로드의 지나간 사용자 셀(`> 아까 보낸 말`)이 거기 걸린다. 그걸
 *   컴포저로 읽으면 대화 기록이 있는 모든 세션이 영원히 `occupied` 가 된다.
 *   `❯`/`›` 는 컴포저 프롬프트고, `>` 는 트랜스크립트 셀이다(실측 기준).
 */
const COMPOSER_TEXT_RE = /^\s*[❯›]\s+\S/;

/** 정규화된 한 줄 → 컴포저에 대한 증거. 아무 말도 없으면 `null`. */
export function classifyComposerLine(stripped: string): ComposerLineKind | null {
  const line = stripped.replace(/\s+$/, "");
  if (line.trim().length === 0) return null;
  // 다이얼로그가 가장 먼저다 — `❯1.Yes` 는 `COMPOSER_TEXT_RE` 에도 걸리는데,
  // 그때 "초안이 있다" 로 부르면 사유가 틀린다(둘 다 '쓰지 않는다' 이긴 하다).
  if (DIALOG_RES.some((re) => re.test(line))) return "dialog";
  if (PLACEHOLDER_RES.some((re) => re.test(line))) return "empty";
  if (EMPTY_PROMPT_RE.test(line)) return "empty";
  if (COMPOSER_TEXT_RE.test(line)) return "text";
  return null;
}

/**
 * 원시(ANSI 포함) 줄 하나 → 컴포저 증거.
 *
 * ★함정(티켓 본문): 전면 TUI 의 PTY raw 버퍼에는 개행이 없다. 코덱스는 히스토리
 *   줄을 끼워 넣은 뒤 커서를 절대좌표로 옮겨(`CSI 14;1H`) 컴포저를 다시 그린다 —
 *   `\n` 으로만 자르면 컴포저와 상태줄과 인사말이 한 줄이 되어 정규식 `.` 이 화면을
 *   가로지른다. 그래서 `classifyTranscriptRaw` 와 **같은** 조각 경계
 *   (`SEGMENT_BOUNDARY_RE`)로 자르고 조각마다 본다.
 *
 * 조각이 여럿이면 **마지막** 증거가 이긴다 — 한 줄 안에서도 나중에 그려진 것이
 * 지금 화면이다(우선순위 최대값을 쓰는 `classifyTranscriptRaw` 와 다른 점).
 */
export function classifyComposerRaw(raw: string): ComposerLineKind | null {
  let last: ComposerLineKind | null = null;
  for (const segment of raw.split(SEGMENT_BOUNDARY_RE)) {
    if (!segment) continue;
    const kind = classifyComposerLine(segmentText(segment));
    if (kind !== null) last = kind;
  }
  return last;
}
