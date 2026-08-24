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
}

function handleChar(ch) {
  // 다이얼로그가 열려 있으면 첫 키 하나가 선택으로 소비된다 — 그 키가 우리가
  // 보낸 답변의 첫 글자라도 마찬가지다. 이게 [y/n] 위험의 전부다.
  if (dialogOpen && ch !== "\r" && ch !== "\n") {
    dialogOpen = false;
    out(`<<<DIALOG:${JSON.stringify(ch)}>>>\r\n`);
    return;
  }
  if (ch === "\r" || ch === "\n") {
    // ★paste 구간 안의 CR 은 제출이 아니라 본문 개행이다.
    if (pasting) {
      composer += "\n";
      return;
    }
    if (dialogOpen) {
      dialogOpen = false;
      out(`<<<DIALOG:${JSON.stringify("\\r")}>>>\r\n`);
      return;
    }
    submit();
    return;
  }
  composer += ch;
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
