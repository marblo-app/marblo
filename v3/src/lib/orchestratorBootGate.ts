/**
 * 오케스트레이터 PTY 의 **부트 출력 게이트** — 비기너 대화창 전용.
 *
 * 비기너의 "마블로와 대화하기" 패널은 채팅 UI 가 아니라 오케 PTY 를 그대로 그리는
 * xterm 이다(`BeginnerShell` → `OrchestratorPanel fill` → `TerminalView`). 그래서
 * 새 폴더를 열면 첫 화면에 CLI 배너(`>_ OpenAI Codex (v…)`, `permissions: YOLO
 * mode`), 우리가 주입한 시스템 프롬프트의 에코(`You are the Marblo Orchestrator…`,
 * `/var/folders/…/marblo-fallback` 경로), `Called marblo.get_agent_skill(...)` 와 그
 * 반환값(스킬 파일 본문 전체)이 통째로 떴다 — 티켓 fDceJJvz3eam2PMNOWyB. 시스템
 * 프롬프트에 "부트 진단을 첫 응답으로 보여주지 마라" 가 이미 있는데도 나오는 이유는
 * 모델이 어겨서가 아니라 **모델이 말하기도 전의 PTY 원시 스트림**이기 때문이다.
 * 프롬프트로는 못 막는 자리라, 렌더러의 write 경계(`TerminalView`)에서 가른다.
 *
 * ── 가르는 기준 ──────────────────────────────────────────────────────────
 * 사용자에게 보일 것은 **오케가 사람에게 한 말**부터다. 그 앞의 것(배너·주입 프롬프트
 * 에코·tool call 원문과 반환값)은 xterm 에 쓰지 않고 버린다. 그래서 이 게이트는
 * "노이즈를 지우는 필터" 가 아니라 "첫 발화까지 닫혀 있는 문" 이다 — 지우기 규칙은
 * 빠뜨리면 새고, 문은 빠뜨릴 게 없다.
 *
 *   probing ─(배너 보임)─▶ armed ─(첫 어시스턴트 줄)─▶ open(그 줄부터 통과)
 *      │                     ├─(부트 에코 뒤 조용함)─▶ open(이후만 통과)
 *      ├─(배너 없이 한도)──▶ open(버퍼 전부 통과)      └─(상한 시간)─▶ open
 *      └─(한 바이트도 안 옴)▶ open(통과분 없음)
 *
 * ★★ **닫힌 상태에는 반드시 마감 시한이 있어야 한다**(티켓 vnJWQrrfdLoXPR13rx1B).
 * 종전엔 안전망 3개(`probeMaxChars`/`probeMaxMs`/`maxArmedMs`)가 전부 **출력이 온
 * 뒤에야** 무장됐다 — 셋 다 `feed()` 안에서만 켜진다. 그래서 PTY 가 0바이트를 주면
 * (이미 대화 중인 세션으로 리마운트돼 replay 링이 비어 오는 경우) 타이머가 **하나도**
 * 돌지 않아 `probing` 에 영원히 갇혔고, `BootGateOverlay` 가 터미널을 영구히 덮었다.
 * 그래서 `probing` 에는 **생성/`reset()` 시점부터** 도는 침묵 시한을 둔다. 이제 모든
 * 닫힌 상태가 시한을 가진다: 가시 문자 전 = 침묵 시한, 가시 문자 후 = `probeMaxMs`,
 * armed = `maxArmedMs`.
 *
 * ★★ 그리고 그 시한은 **PTY 가 뜬 시각부터** 잰다 — 이 마운트가 아니라
 * (티켓 04mJqRvSi0QDCboyxzKF). 마운트 기준으로 재면 몇 분째 일하고 있는 오케로
 * 화면이 다시 뜰 때(마블로 → 비기너 전환) 재생 링의 지나간 배너를 지금 일어나는
 * 부팅으로 오인해 `armed` 60초를 처음부터 다시 센다. 실측으로 60.2초를 꽉 채운 뒤
 * 빈 터미널이 열렸다. 자세한 근거는 `POST_BOOT_GRACE_MS` 주석.
 *
 * - `probing`: 스트림이 부트(배너)로 시작하는지 본다. 오케 PTY 의 replay 링은 4M
 *   자를 보관하므로 리마운트에도 부트가 다시 온다 — 그러면 armed. 링이 중간부터
 *   오는 경우(배너 없음)는 이미 지나간 대화이므로 **전부 통과**한다(과도한 거름 금지).
 * - `armed`: 줄 단위로 분류해 첫 **어시스턴트 발화** 줄을 기다린다. 문법은 하네스별
 *   셀 접두(Claude Code `⏺ `, Codex `• `, Gemini `✦ `)이고 tool call 셀(`⏺ Bash(`,
 *   `• Called …`, `⎿`, `└`)은 제외한다. 그 줄이 든 청크는 **그 줄부터** 통과시켜
 *   인사말이 잘리지 않게 한다.
 * - 폴백(문법을 모르는 하네스): 우리가 친 부트 프롬프트의 에코(사용자 셀)를 본 뒤
 *   스트림이 `QUIET_MS` 조용하면 턴이 끝난 것으로 보고 연다. 이때 인사말은 잃지만
 *   배너·프롬프트·툴 출력은 이미 지나간 뒤라 새지 않는다. 마지막 안전망은
 *   `MAX_ARMED_MS` 상한 — 어떤 경우에도 골격 뒤에 영영 갇히지 않는다.
 * - 침묵 시한: 한 바이트도 안 온 채 시간이 다하면 연다. 온 게 없으니 **샐 것도 없다**
 *   — 통과분이 빈 문자열이라 부트 출력이 새는 경로가 아니다. 위험은 "그 뒤에 올
 *   배너" 뿐이고, 그래서 시한을 **세션 상태로 가른다**(아래).
 * - ★타이머보다 나은 신호 — `sessionId`(= `orch-<sess>-<spawn ms>`)는 PTY **프로세스**
 *   와 1:1 이다(`orchestrator-manager`: 새 스폰마다 `Date.now()` 로 새 sid, 살아 있는
 *   세션에 붙을 땐 `reused: true` 로 **같은** sid). 그러니 "이 sid 의 게이트가 한 번
 *   부트를 지나 열린 적 있다" = "이 PTY 는 다시 부팅하지 않는다" 이고, 그때의 침묵은
 *   부팅 중이 아니라 **그냥 조용한 대화**다. 그 sid 는 짧은 시한
 *   (`SILENT_OPEN_BOOTED_MS`)으로 곧장 풀고, 처음 보는 sid 는 느리게 뜨는 CLI 의
 *   배너를 앞지르지 않도록 넉넉한 시한(`SILENT_OPEN_MS`)만 백스톱으로 둔다.
 *   기록은 부트를 **본** 개방(assistant-line/no-banner/quiet-after-echo/max-armed)
 *   에만 남긴다 — `forced`·`silent` 는 부트를 본 적이 없어 근거가 못 된다.
 * - `open()`: 패널이 강제로 연다(로그인·첫 실행 다이얼로그로 멈춰 사용자가 원시
 *   화면에 답해야 할 때 — `orchestratorHaltKeepsTerminal`).
 *
 * ★마블로(엑스퍼트) 모드는 이 게이트를 만들지 않는다 — `TerminalView` 에
 * `outputGate` 가 없으면 종전과 바이트 단위로 같은 경로다. 거기서는 원시 출력이
 * 진단에 쓰인다.
 *
 * 시간·타이머는 주입 가능(`now`/`setTimer`)해서 테스트가 실시간 없이 돈다.
 * I/O 없음 — `tests/unit/orchestrator-boot-gate.test.ts` 가 실제 codex 0.149.0
 * PTY 녹화(`tests/fixtures/pty`)를 그대로 먹여 검증한다.
 */
import { normalizeLine } from "./ansi";

export type BootGateState = "probing" | "armed" | "open";

export type BootGateOpenReason =
  | "assistant-line"
  | "no-banner"
  | "quiet-after-echo"
  | "max-armed"
  | "silent"
  | "forced";

export type TranscriptLineKind =
  | "blank"
  | "busy"
  | "banner"
  | "chrome"
  | "user"
  | "tool"
  | "assistant"
  | "other";

/** 배너 없이 이만큼의 가시 문자가 지나면 부트가 아니다 — 전부 통과. */
export const PROBE_MAX_CHARS = 4_000;
/** 첫 가시 문자 뒤 이만큼 지나도 배너가 없으면 부트가 아니다 — 전부 통과. */
export const PROBE_MAX_MS = 2_500;
/** 부트 에코를 본 뒤 스트림이 이만큼 조용하면 턴이 끝난 것으로 본다. */
export const QUIET_AFTER_ECHO_MS = 2_500;
/** armed 상한. 문법도 폴백도 안 걸리면 이 뒤엔 무조건 연다(이후 출력만 통과). */
export const MAX_ARMED_MS = 60_000;
/**
 * probing 상한 — **한 바이트도 안 온 채** 이만큼 지나면 연다(처음 보는 sid).
 * `MAX_ARMED_MS` 와 같은 크기다: 둘 다 "어떤 경우에도 골격 뒤에 영영 갇히지 않는다"
 * 는 같은 약속의 다른 상태 버전이고, 여기서 짧게 잡으면 느리게 뜨는 CLI(콜드 스타트·
 * 바이너리 해석)의 배너를 앞질러 열어 부트가 샌다.
 */
export const SILENT_OPEN_MS = 60_000;
/**
 * 같은 상한 — 단 **이 sid 가 이미 부트를 지난 것으로 기록된** 경우. 그 PTY 는 다시
 * 부팅하지 않으므로 앞지를 배너가 없다. 사장님이 겪은 리마운트 고착이 이 경로로
 * 60초가 아니라 2.5초에 풀린다.
 */
export const SILENT_OPEN_BOOTED_MS = 2_500;
/**
 * ★부트 예산은 **PTY 가 뜬 시각**부터 잰다 — 마운트 시각이 아니다
 * (티켓 04mJqRvSi0QDCboyxzKF).
 *
 * 종전엔 `maxArmedMs` 가 `arm()` 에서, 즉 **이 마운트가 배너를 본 순간**부터
 * 돌았다. 그래서 몇 분째 일하고 있는 오케로 화면이 다시 뜨면(마블로 → 비기너
 * 전환) 재생 링의 **지나간 배너**를 지금 일어나는 부팅으로 오인해 armed 로
 * 들어가고, 거기서 나가는 길 셋이 전부 막힌다:
 *   - 어시스턴트 줄 — 오케가 아직 사람에게 말한 적이 없으면 링에 없다
 *   - quiet-after-echo(2.5초) — 일하는 TUI 는 상태줄(`esc to interrupt`)을
 *     0.5초마다 다시 그려서 이 타이머를 매번 되감는다
 *   - `maxArmedMs` — **60초**
 * 실측(`tests/playwright/unit/beginner-boot-gate-remount.spec.ts`): 전환 후
 * `data-gate-state="armed"` 로 60.2초를 꽉 채운 뒤 빈 터미널로 열렸다.
 *
 * 고치는 자리는 "얼마나 기다리나" 가 아니라 "언제부터 재나" 다. 이 게이트의
 * 계약이 이미 답을 갖고 있다 — **부팅은 `MAX_ARMED_MS` 안에 끝난다**(그게 저
 * 상한의 뜻이다). 그러면 그보다 오래 산 PTY 는 정의상 부팅을 지난 것이고,
 * 그 배너는 역사다. 그래서 닫힌 상태의 시한을 `PTY 스폰 + 예산` 으로 잡는다:
 *   - 스폰 직후의 첫 마운트 → 예산이 통째로 남아 있다. 종전과 같다(문 그대로).
 *   - 몇 분 뒤의 리마운트  → 예산은 이미 지났다. 아래 유예만 주고 연다.
 * 임의의 상수를 새로 고르지 않는다는 것이 이 규칙의 값이다.
 *
 * 유예를 두는 이유: 리마운트의 재생 링은 **한 덩이**로 오므로(`pty:replay` 가
 * join 해서 준다) 어시스턴트 줄 탐색은 이 타이머가 돌기 전에 이미 끝난다.
 * 유예는 그 직후 도착하는 **라이브** 첫 청크에 인사말이 실려 오는 경우만 받는다.
 */
export const POST_BOOT_GRACE_MS = 2_500;
/** 이보다 이른 값은 PTY 스폰 시각일 수 없다(2020-01-01). sid 파싱 위생. */
const MIN_PLAUSIBLE_SPAWN_MS = 1_577_836_800_000;

/**
 * sid 에서 PTY 스폰 시각을 읽는다. 형식은 `orchestrator-manager` 가 정한
 * `orch-<sessionId>-<Date.now()>` 이고, 이 파일 헤더가 이미 그 1:1 성질에
 * 기대고 있다. 못 읽으면 `null` — 그 경우 예산은 종전대로 마운트 기준이다
 * (즉 이 규칙은 **추가 안전망**이지 기존 시한을 대체하지 않는다).
 */
export function parsePtySpawnedAt(sessionId: string | null): number | null {
  if (!sessionId) return null;
  const m = /-(\d{13,})$/.exec(sessionId);
  if (!m) return null;
  const at = Number(m[1]);
  if (!Number.isFinite(at) || at < MIN_PLAUSIBLE_SPAWN_MS) return null;
  return at;
}
/** 줄바꿈 없이 쌓이는 뷰포트 리드로우 꼬리의 상한(문자). 분류엔 마지막 부분만 필요하다. */
const PENDING_TAIL_MAX_CHARS = 16_384;

// ── 줄 분류 ───────────────────────────────────────────────────────────────
// 스트립된 한 줄(ANSI 제거·CR 덮어쓰기 반영)을 받는다. 순서가 곧 우선순위다.

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
  /^\s*[❯›]\s*$/, // 빈 프롬프트 화살표
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
    const kind = classifyTranscriptLine(normalizeLine(segment));
    if (KIND_PRIORITY[kind] > KIND_PRIORITY[best]) best = kind;
    if (best === "banner") break;
  }
  return best;
}

// ── "이 sid 는 부트를 지났다" 기록 ─────────────────────────────────────────
// 렌더러 프로세스 수명 동안의 메모리. sid 는 PTY 프로세스와 1:1 이라(위 헤더 주석)
// 한 번 부트를 지난 sid 가 다시 부팅하는 경로는 없다. 프로세스가 죽고 다시 뜨면
// `orch-<sess>-<Date.now()>` 로 **다른** sid 가 되므로 이 기록에 걸리지 않는다 —
// 즉 이 기록이 남아 있다고 새 부트를 잘못 통과시키는 경우는 없다.
//
// 창을 새로고침하면 이 기억은 사라진다. 그때는 `SILENT_OPEN_MS` 백스톱이 받는다 —
// 늦게 풀릴 뿐 갇히지는 않는다.
const BOOT_SEEN_MAX = 64;
const bootSeenSids: string[] = [];

export function hasPtyBootSeen(sessionId: string): boolean {
  return bootSeenSids.includes(sessionId);
}

function rememberPtyBootSeen(sessionId: string): void {
  if (bootSeenSids.includes(sessionId)) return;
  bootSeenSids.push(sessionId);
  // 창당 오케 PTY 는 하나지만 재시작마다 sid 가 늘어난다 — 오래된 것부터 버린다.
  while (bootSeenSids.length > BOOT_SEEN_MAX) bootSeenSids.shift();
}

/** 테스트 전용 — 기록을 지운다. */
export function forgetPtyBootSeen(sessionId: string): void {
  const at = bootSeenSids.indexOf(sessionId);
  if (at >= 0) bootSeenSids.splice(at, 1);
}

/** 부트를 **본** 개방만 근거가 된다. `forced`/`silent` 는 본 적이 없다. */
const REASONS_PROVING_BOOT: ReadonlySet<BootGateOpenReason> = new Set([
  "assistant-line",
  "no-banner",
  "quiet-after-echo",
  "max-armed",
]);

// ── 게이트 ────────────────────────────────────────────────────────────────

export interface BootGateOptions {
  /**
   * 이 게이트가 지키는 PTY sid(`orch-…`). 주면 "이 sid 는 부트를 지났다" 기록을
   * 읽고 쓴다 — 리마운트의 침묵을 60초가 아니라 2.5초에 푼다.
   */
  sessionId?: string;
  /** epoch ms. 기본 `Date.now`. */
  now?: () => number;
  /** 타이머. 기본 `setTimeout`; 반환값은 취소 함수. */
  setTimer?: (fn: () => void, ms: number) => () => void;
  probeMaxChars?: number;
  probeMaxMs?: number;
  quietAfterEchoMs?: number;
  maxArmedMs?: number;
  silentOpenMs?: number;
  silentOpenBootedMs?: number;
  postBootGraceMs?: number;
  /**
   * PTY 스폰 시각(epoch ms). 기본값은 `sessionId` 에서 읽는다
   * (`parsePtySpawnedAt`). 테스트는 sid 를 꾸미지 않고 이걸로 나이를 준다.
   */
  ptySpawnedAt?: number | null;
}

export interface PtyOutputGate {
  readonly state: BootGateState;
  readonly openReason: BootGateOpenReason | null;
  /** 게이트가 무장(armed)된 시각(epoch ms) — 로딩 골격의 `since`. */
  readonly armedAt: number | null;
  /** 터미널로 나갈 텍스트를 받을 곳. `null` 이면 열릴 때까지 버퍼에 쌓인다. */
  setSink(sink: ((text: string) => void) | null): void;
  /** PTY 원시 청크 하나. 통과분은 sink 로 간다(동기 또는 타이머 뒤). */
  feed(chunk: string): void;
  /** 강제로 연다(멈춤 다이얼로그 등). 그때까지의 버퍼는 버린다 — 부트는 안 보여준다. */
  open(reason?: BootGateOpenReason): void;
  /** 새 마운트(replay 가 처음부터 다시 온다). 상태·버퍼·타이머를 처음으로(dispose 뒤에도 되살린다). */
  reset(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

const defaultSetTimer = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export class OrchestratorBootGate implements PtyOutputGate {
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => () => void;
  private readonly probeMaxChars: number;
  private readonly probeMaxMs: number;
  private readonly quietAfterEchoMs: number;
  private readonly maxArmedMs: number;
  private readonly sessionId: string | null;
  private readonly silentOpenMs: number;
  private readonly silentOpenBootedMs: number;
  private readonly postBootGraceMs: number;
  /** PTY 프로세스가 뜬 시각. 닫힌 상태의 시한을 여기서부터 잰다(위 상수 주석). */
  private readonly ptySpawnedAt: number | null;

  private _state: BootGateState = "probing";
  private _openReason: BootGateOpenReason | null = null;
  private _armedAt: number | null = null;
  private sink: ((text: string) => void) | null = null;
  private listeners = new Set<() => void>();

  /** probing 동안 쌓아 둔 원시 청크 — 배너가 없으면 전부 통과, 있으면 버린다. */
  private probeBuffer: string[] = [];
  /** 열린 뒤 sink 가 아직 없을 때 쌓아 두는 통과분. */
  private outBuffer: string[] = [];
  private visibleChars = 0;
  private firstVisibleAt: number | null = null;
  /** 마지막 `\n` 뒤의 원시 꼬리(한 줄이 여러 청크에 걸쳐 올 수 있다). */
  private pendingRaw = "";
  private sawUserLine = false;
  private cancelProbeTimer: (() => void) | null = null;
  private cancelQuietTimer: (() => void) | null = null;
  private cancelMaxTimer: (() => void) | null = null;
  private cancelSilentTimer: (() => void) | null = null;
  private disposed = false;

  constructor(options: BootGateOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? defaultSetTimer;
    this.probeMaxChars = options.probeMaxChars ?? PROBE_MAX_CHARS;
    this.probeMaxMs = options.probeMaxMs ?? PROBE_MAX_MS;
    this.quietAfterEchoMs = options.quietAfterEchoMs ?? QUIET_AFTER_ECHO_MS;
    this.maxArmedMs = options.maxArmedMs ?? MAX_ARMED_MS;
    this.sessionId = options.sessionId ?? null;
    this.silentOpenMs = options.silentOpenMs ?? SILENT_OPEN_MS;
    this.silentOpenBootedMs =
      options.silentOpenBootedMs ?? SILENT_OPEN_BOOTED_MS;
    this.postBootGraceMs = options.postBootGraceMs ?? POST_BOOT_GRACE_MS;
    this.ptySpawnedAt =
      options.ptySpawnedAt !== undefined
        ? options.ptySpawnedAt
        : parsePtySpawnedAt(this.sessionId);
    // ★생성 시점부터 돈다 — 이 게이트의 유일한 "출력과 무관한" 시한이다.
    this.armSilentTimer();
  }

  get state(): BootGateState {
    return this._state;
  }

  get openReason(): BootGateOpenReason | null {
    return this._openReason;
  }

  get armedAt(): number | null {
    return this._armedAt;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }

  setSink(sink: ((text: string) => void) | null): void {
    this.sink = sink;
    if (sink && this.outBuffer.length > 0) {
      const pending = this.outBuffer.join("");
      this.outBuffer = [];
      sink(pending);
    }
  }

  private emit(text: string): void {
    if (!text) return;
    if (this.sink) this.sink(text);
    else this.outBuffer.push(text);
  }

  private clearTimers(): void {
    this.cancelProbeTimer?.();
    this.cancelQuietTimer?.();
    this.cancelMaxTimer?.();
    this.cancelSilentTimer?.();
    this.cancelProbeTimer = null;
    this.cancelQuietTimer = null;
    this.cancelMaxTimer = null;
    this.cancelSilentTimer = null;
  }

  /**
   * 닫힌 상태의 남은 시한. 예산(`budgetMs`)은 **PTY 스폰 시각**부터 소진된다
   * (`POST_BOOT_GRACE_MS` 주석). 스폰 시각을 모르면 종전대로 예산 전액을 이
   * 마운트 기준으로 준다 — 이 규칙은 시한을 **줄이기만** 하고, 없던 시한을
   * 만들거나 기존 시한을 늘리지 않는다.
   *
   * 바닥은 `postBootGraceMs` 다: 예산이 이미 다 지난 PTY 라도 재생 링을 다
   * 먹고 그 직후의 라이브 첫 청크까지는 받아야 인사말을 놓치지 않는다.
   */
  private remainingClosedBudget(budgetMs: number): number {
    if (this.ptySpawnedAt === null) return budgetMs;
    const spent = this.now() - this.ptySpawnedAt;
    // 시계가 뒤로 갔거나 sid 가 미래면(있을 수 없지만) 예산을 깎지 않는다.
    if (!Number.isFinite(spent) || spent <= 0) return budgetMs;
    return Math.max(this.postBootGraceMs, budgetMs - spent);
  }

  /**
   * 침묵 시한 — `probing` 이면서 **가시 문자를 한 번도 못 본** 동안만 유효하다.
   * 가시 문자가 하나라도 오면 `probeMaxMs` 가, armed 로 가면 `maxArmedMs` 가
   * 이어받는다(둘 다 `clearTimers` 로 이걸 끈다). 그래서 닫힌 상태에 시한이
   * 없는 구간이 남지 않는다.
   */
  private armSilentTimer(): void {
    const ms =
      this.sessionId && hasPtyBootSeen(this.sessionId)
        ? this.silentOpenBootedMs
        : this.remainingClosedBudget(this.silentOpenMs);
    this.cancelSilentTimer = this.setTimer(() => {
      if (this.disposed) return;
      if (this._state !== "probing" || this.firstVisibleAt !== null) return;
      // 온 게 없으니 통과분도 없다 — 부트가 새는 경로가 아니다.
      this.transitionOpen("silent", "");
    }, ms);
  }

  reset(): void {
    this.clearTimers();
    // dispose 뒤에도 같은 세션의 TerminalView 가 다시 마운트될 수 있다(StrictMode 의
    // mount→unmount→mount, 탭 재부착). 새 마운트는 reset 으로 시작하므로 여기서 되살린다.
    this.disposed = false;
    this._state = "probing";
    this._openReason = null;
    this._armedAt = null;
    this.probeBuffer = [];
    this.outBuffer = [];
    this.visibleChars = 0;
    this.firstVisibleAt = null;
    this.pendingRaw = "";
    this.sawUserLine = false;
    // 새 마운트도 닫힌 채로 시작한다 — 시한 없이 두면 이 티켓의 고착이 그대로 재현된다.
    this.armSilentTimer();
    this.notify();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.listeners.clear();
    this.sink = null;
    this.probeBuffer = [];
    this.outBuffer = [];
  }

  /**
   * 강제 개방. probing 중(배너를 본 적 없음)이면 숨길 게 없으니 버퍼를 통과시키고,
   * armed(부트 확인됨)면 버퍼는 버린다 — 멈춤 다이얼로그에 답하러 열어도 부트
   * 배너·프롬프트 에코는 보여주지 않는다. 현재 화면은 리페인트 넛지가 되살린다.
   */
  open(reason: BootGateOpenReason = "forced"): void {
    if (this._state === "open") return;
    const passthrough =
      this._state === "probing" ? this.probeBuffer.join("") : "";
    this.transitionOpen(reason, passthrough);
  }

  private transitionOpen(
    reason: BootGateOpenReason,
    passthrough: string,
  ): void {
    this.clearTimers();
    this._state = "open";
    this._openReason = reason;
    if (this.sessionId && REASONS_PROVING_BOOT.has(reason)) {
      rememberPtyBootSeen(this.sessionId);
    }
    this.probeBuffer = [];
    this.pendingRaw = "";
    this.notify();
    this.emit(passthrough);
  }

  private arm(): void {
    this.clearTimers();
    this._state = "armed";
    this._armedAt = this.now();
    this.probeBuffer = [];
    this.cancelMaxTimer = this.setTimer(
      () => {
        if (this.disposed || this._state !== "armed") return;
        this.transitionOpen("max-armed", "");
      },
      // ★마운트 기준이 아니라 PTY 스폰 기준. 몇 분째 일하고 있는 오케로
      //   전환했을 때 지나간 배너 때문에 60초를 다시 세지 않는다.
      this.remainingClosedBudget(this.maxArmedMs),
    );
    this.notify();
  }

  /**
   * PTY 청크 하나를 줄 단위로 걷는다. 한 청크 안에서 probing→armed→open 이 다
   * 일어날 수 있다(replay 가 부트부터 인사말까지 한 번에 올 때).
   */
  feed(chunk: string): void {
    if (this.disposed || !chunk) return;
    if (this._state === "open") {
      this.emit(chunk);
      return;
    }
    if (this._state === "probing") this.probeBuffer.push(chunk);

    const parts = chunk.split("\n");
    const tailBefore = this.pendingRaw;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const raw = i === 0 ? tailBefore + parts[0] : parts[i];
      // ★실제 바이트는 `\r\n` 으로 끝난다. `normalizeLine` 의 CR 규칙(마지막 CR
      // 뒤만 남김 — 진행바용)에 줄 끝 CR 이 걸리면 줄 전체가 빈 줄이 된다. 분류용
      // 텍스트에서만 꼬리 CR 을 떼고, 통과시키는 원시 바이트는 손대지 않는다.
      const forClassify = raw.replace(/\r+$/, "");
      const kind = classifyTranscriptRaw(forClassify);

      if (this._state === "probing") {
        const visible = normalizeLine(forClassify).trim().length;
        if (visible > 0 && this.firstVisibleAt === null) {
          this.firstVisibleAt = this.now();
          // 여기서부터는 `probeMaxMs` 가 소유한다.
          this.cancelSilentTimer?.();
          this.cancelSilentTimer = null;
          this.cancelProbeTimer = this.setTimer(() => {
            if (this.disposed || this._state !== "probing") return;
            this.transitionOpen("no-banner", this.probeBuffer.join(""));
          }, this.probeMaxMs);
        }
        // 미완 꼬리는 다음 청크에서 다시 세므로 완결된 줄만 센다.
        if (!isLast) this.visibleChars += visible;
        if (kind === "banner") {
          this.arm();
          // 배너 줄은 버리고, 같은 청크의 나머지 줄은 armed 규칙으로 이어 본다.
        } else if (this.visibleChars >= this.probeMaxChars) {
          this.transitionOpen("no-banner", this.probeBuffer.join(""));
          return;
        }
      } else {
        // armed
        if (kind === "user") this.sawUserLine = true;
        if (kind === "assistant") {
          // ★그 줄부터 통과 — 인사말의 첫 글자가 잘리면 안 된다. 앞 조각(이전 줄의
          // 끝·뷰포트 리드로우·스크롤 영역 설정)은 버린다. 빈 xterm 의 (0,0) 에서
          // 시작해도 TUI 는 절대좌표로 그리고, 열린 직후 TerminalView 가 리페인트
          // 넛지를 보내 컴포저를 다시 그린다.
          const passthrough =
            i === 0 ? tailBefore + chunk : parts.slice(i).join("\n");
          this.transitionOpen("assistant-line", passthrough);
          return;
        }
      }

      if (isLast) this.pendingRaw = this.capTail(raw);
    }

    if (this._state === "armed") this.scheduleQuietFallback();
  }

  /**
   * 폴백 — 부트 에코(사용자 셀)를 본 뒤 스트림이 조용하면 턴이 끝났다. 에코를 보기
   * 전의 조용함은 세지 않는다: 컴포저가 뜨고 메인이 프롬프트를 치기까지의 틈에서
   * 열면 바로 그 에코가 샌다.
   */
  private scheduleQuietFallback(): void {
    this.cancelQuietTimer?.();
    this.cancelQuietTimer = null;
    if (!this.sawUserLine) return;
    this.cancelQuietTimer = this.setTimer(() => {
      if (this.disposed || this._state !== "armed") return;
      this.transitionOpen("quiet-after-echo", "");
    }, this.quietAfterEchoMs);
  }

  /** 줄바꿈 없이 길게 오는 뷰포트 리드로우 꼬리를 자른다 — 분류엔 최근 부분이면 된다. */
  private capTail(raw: string): string {
    return raw.length > PENDING_TAIL_MAX_CHARS
      ? raw.slice(raw.length - PENDING_TAIL_MAX_CHARS)
      : raw;
  }
}
