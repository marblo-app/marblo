#!/usr/bin/env node
// 컴포저(입력 버퍼)를 가진 TUI 의 **최소 충실 모형** — 티켓 igGI6QpXkEfrkkKN3rU0.
//
// WHY 이 fixture 가 필요한가:
//   답 전달(answer_question → pendingInstructions → writeAndSubmit)이 실제로
//   에이전트에게 **무엇을 넘겼는지** 를 재려면, 화면 스크레이핑이 아니라
//   "제출된 페이로드" 를 직접 봐야 한다. 진짜 Claude Code 를 띄우면 (a) 비결정적이고
//   (b) 제출 페이로드를 관측할 방법이 없다. 그래서 Ink 계열 컴포저의 **관측 가능한
//   계약**만 모형화한다:
//
//     1. 입력은 컴포저 버퍼에 **누적**된다(붙여넣기는 기존 초안 뒤에 삽입된다).
//     2. bracketed paste(ESC[200~ … ESC[201~) 구간 안의 CR 은 제출이 아니라
//        **본문 개행**이다. ← pty-manager 가 paste 마커를 쓰는 이유 그 자체.
//     3. 구간 밖의 CR 이 비어있지 않은 컴포저를 제출한다.
//     4. 턴이 시작되면 상태줄("esc to interrupt")을 그린다.
//     5. ★컴포저를 **화면에 그린다** — CR 로 같은 줄을 덮어쓰며, 개행 없이.
//        (티켓 RtyOMpOArfI7a5JNSzsg 에서 추가) 주입 직전 컴포저 판정이 읽는 것이
//        바로 이 픽셀이므로, 이걸 안 그리는 fixture 는 그 판정을 재지 못한다.
//        실측 클로드 준비 화면이 `❯ ` 한 줄을 CR 로 덮어쓰는 것과 같은 모양이다
//        (`tests/fixtures/pty/claude-composer-after-consent.json`). ★전면 TUI 의
//        raw 버퍼에 개행이 없다는 함정을 여기서 그대로 재현한다.
//     6. `--dialog` 는 확인 다이얼로그를 **그린다**(종전엔 키만 삼켰다). 실측
//        클로드 선택창(`claude-first-run-consent.json`)과 같은 모양이다.
//
//   ★1번이 이 티켓의 핵심 가정이다. 실제 Ink/readline 컴포저는 붙여넣기를
//   커서 위치에 **삽입**하지 기존 내용을 지우지 않는다. 이 모형은 그 동작을
//   그대로 따른다 — 즉 아래 하네스가 재는 것은 "우리 전달 경로가 그런 컴포저를
//   만났을 때 무슨 일이 나는가" 이지 "Claude Code 가 이렇게 동작한다" 가 아니다.
//
// 관측 프로토콜(stdout, 하네스가 파싱한다):
//   <<<SUBMIT:{json문자열}>>>   컴포저가 제출됐다. json 은 제출된 전문.
//   <<<EMPTYSUBMIT>>>          빈 컴포저에 CR 이 왔다(무해한 no-op).
//   <<<DIALOG:{json문자열}>>>  다이얼로그가 키 하나로 확정됐다.
//   <<<COMPOSER:{json문자열}>>> 컴포저 버퍼가 바뀌었다. json 은 **현재 전문**.
//                              초안이 바이트 단위로 살아 있는지 재는 데 쓴다
//                              (화면 스크레이핑으로 어림하지 않는다).
//
// 플래그:
//   --busy        상시 "esc to interrupt" 를 그린다(턴 중인 에이전트).
//   --ignore-cr   구간 밖 CR 을 **무시**한다(paste 버퍼에 CR 이 접혀 들어가
//                 제출이 안 되는 실제 레이스의 모형).
//   --dialog      첫 키 하나를 다이얼로그 선택으로 소비한다([y/n] 확인창).
"use strict";

const args = new Set(process.argv.slice(2));
const BUSY = args.has("--busy");
const IGNORE_CR = args.has("--ignore-cr");
const DIALOG = args.has("--dialog");

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

let composer = "";
let pasting = false;
let pending = "";
let dialogOpen = DIALOG;

const out = (s) => process.stdout.write(s);

/** 턴 시작 상태줄 — pty-manager 의 SUBMIT_SIGNAL 이 찾는 바로 그 문자열. */
const statusLine = () => out("\r\nesc to interrupt\r\n");

/**
 * ★컴포저를 화면에 그린다 — **개행 없이**, CR 로 같은 줄을 덮어쓰며.
 *
 * 이 한 줄이 주입 직전 판정(`electron/composer-gate.ts`)이 읽는 전부다. 실측
 * 클로드 준비 화면도 같은 모양으로 그린다 — `\x1b[39m❯ \x1b[7m \x1b[5G\x1b[27m\x1b[K`
 * (`tests/fixtures/pty/claude-composer-after-consent.json`).
 *
 * 여러 줄짜리 버퍼는 개행을 `⏎` 로 접어 **한 줄**로 그린다. 실제 TUI 는 여러 줄로
 * 펼치지만, 이 모형이 지켜야 하는 성질은 "raw 버퍼에 개행이 없다" 쪽이다 — 정규식
 * `.` 이 화면을 가로지르는 그 함정을 재현하는 것이 이 fixture 의 일이다.
 */
function paintComposer() {
  // 버퍼 전문을 마커로도 흘린다. 초안이 바이트 단위로 살아 있는지는 화면
  // 스크레이핑으로 어림하지 않고 이 값으로 잰다.
  out(`<<<COMPOSER:${JSON.stringify(composer)}>>>\r\n`);
  out(`\r\x1b[2K\x1b[39m❯ ${composer.replace(/\n/g, "⏎")}`);
}

/**
 * 확인 다이얼로그를 그린다. 실측 클로드 선택창과 같은 모양 —
 * `tests/fixtures/pty/claude-first-run-consent.json` 의
 * `❯1.No,exit` / `2.Yes,Iaccept` / `Entertoconfirm·Esctocancel`.
 * (클로드는 커서 이동으로 칠해 공백이 사라지지만, 여기서는 공백을 그대로 둔다 —
 *  판정 정규식이 `\s*` 라 둘 다 걸린다는 것을 유닛 테스트가 실측 바이트로 잠근다.)
 */
function paintDialog() {
  out("\r\nDo you want to proceed?\r\n");
  out("❯ 1. Yes\r\n");
  out("  2. No\r\n");
  out("\r\nEnter to confirm · Esc to cancel\r\n");
}

function submit() {
  if (IGNORE_CR) return; // CR 이 삼켜지는 레이스 모형: 아무 일도 안 일어난다.
  if (composer.length === 0) {
    out(`<<<EMPTYSUBMIT>>>\r\n`);
    return;
  }
  const payload = composer;
  composer = "";
  out(`<<<SUBMIT:${JSON.stringify(payload)}>>>\r\n`);
  statusLine(); // 제출 = 턴 시작. 실제 TUI 와 같이 상태줄을 그린다.
  paintComposer(); // 제출하면 컴포저는 빈다 — 실제 TUI 처럼 다시 그린다.
}

function handleChar(ch) {
  // 다이얼로그가 열려 있으면 첫 키 하나가 선택으로 소비된다 — 그 키가 우리가
  // 보낸 답변의 첫 글자라도 마찬가지다. 이게 [y/n] 위험의 전부다.
  if (dialogOpen && ch !== "\r" && ch !== "\n") {
    dialogOpen = false;
    out(`<<<DIALOG:${JSON.stringify(ch)}>>>\r\n`);
    paintComposer(); // 다이얼로그가 닫히면 컴포저가 돌아온다.
    return;
  }
  if (ch === "\r" || ch === "\n") {
    // ★paste 구간 안의 CR 은 제출이 아니라 본문 개행이다.
    if (pasting) {
      composer += "\n";
      paintComposer();
      return;
    }
    if (dialogOpen) {
      dialogOpen = false;
      out(`<<<DIALOG:${JSON.stringify("\\r")}>>>\r\n`);
      paintComposer();
      return;
    }
    submit();
    return;
  }
  composer += ch;
  paintComposer();
}

/** marker 의 진짜 접두사(아직 완성되지 않은 이스케이프)인가. */
function isPartial(s, marker) {
  return s.length < marker.length && marker.startsWith(s);
}

function feed(chunk) {
  pending += chunk;
  for (;;) {
    if (pending.length === 0) return;
    if (pending.startsWith(PASTE_START)) {
      pasting = true;
      pending = pending.slice(PASTE_START.length);
      continue;
    }
    if (pending.startsWith(PASTE_END)) {
      pasting = false;
      pending = pending.slice(PASTE_END.length);
      continue;
    }
    // 청크 경계가 이스케이프 시퀀스를 갈랐을 수 있다 — 더 올 때까지 기다린다.
    if (isPartial(pending, PASTE_START) || isPartial(pending, PASTE_END))
      return;
    const ch = pending[0];
    pending = pending.slice(1);
    handleChar(ch);
  }
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", feed);

if (BUSY) {
  // 턴 중인 에이전트의 상태줄 리페인트. pty-manager 의 SUBMIT_SIGNAL 이
  // 우리 CR 과 **무관하게** 계속 매칭되는 상황을 만든다.
  setInterval(statusLine, 150).unref?.();
  setInterval(() => {}, 1 << 30); // 프로세스 유지
} else {
  setInterval(() => {}, 1 << 30);
}

out(`<<<READY>>>\r\n`);
// 첫 화면. 실제 CLI 도 준비되면 컴포저(또는 뜬 다이얼로그)를 그린다 — 안 그리면
// 주입 직전 판정이 읽을 것이 없어 `indeterminate` 가 된다.
if (dialogOpen) paintDialog();
else paintComposer();
