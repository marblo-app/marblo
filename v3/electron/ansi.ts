/**
 * ANSI escape / 제어 시퀀스를 제거하고 라인 단위 표시에 적합한 텍스트로
 * 정규화한다. MiniTerminal 의 경량 <pre> 렌더링 용도.
 *
 * 처리 대상:
 *  - CSI 시퀀스: ESC [ <params> <intermediate> <final>   (컬러/커서/SGR 등)
 *  - OSC 시퀀스: ESC ] ... (BEL | ESC \)                 (윈도우 타이틀 등)
 *  - DCS/SOS/PM/APC: ESC P/X/^/_ ... ESC \
 *  - 화면 전체 리셋: ESC [ 2 J / ESC [ H 등은 CSI 처리로 함께 제거
 *  - 그 외 단일-바이트 ESC 시퀀스: ESC ( / ESC ) / ESC = / ESC > 등
 *  - BEL(0x07), VT(0x0B), FF(0x0C) 등 비-인쇄 제어 문자
 *
 * 보존:
 *  - 일반 가시 문자, 공백, 탭(\t)
 *  - 줄바꿈(\n) — 호출 측이 라인 단위로 split 한다고 가정
 *  - CR(\r) — caller(ptyMirrorStore) 가 같은 줄 덮어쓰기 의미로 사용
 */

// Single regex covering the most common ANSI families. We strip OSC/DCS/SOS/PM/APC
// with their terminator (BEL or ESC \), then CSI with parameter/final byte,
// then any leftover ESC <single byte> sequences.
/* eslint-disable no-control-regex -- ANSI/control sanitizing intentionally matches ESC, BEL, and C0 bytes. */
const OSC_OR_STRING = /\x1b[\]PX^_][\s\S]*?(?:\x07|\x1b\\)/g;
const CSI = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;
// ESC <intermediate(0x20-0x2f)>* <final(0x30-0x7e)> — covers nF/Fp/Fs/C1
// sequences like ESC ( B, ESC =, ESC c, ESC D, etc. Applied AFTER OSC/CSI
// stripping so it never swallows their opening byte.
const SHORT_ESC = /\x1b[\x20-\x2f]*[\x30-\x7e]/g;
// 비-인쇄 제어 문자 (\t, \n, \r 은 보존)
const STRIP_CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
/* eslint-enable no-control-regex */

export function stripAnsi(input: string): string {
  if (!input) return "";
  return input
    .replace(OSC_OR_STRING, "")
    .replace(CSI, "")
    .replace(SHORT_ESC, "")
    .replace(STRIP_CTRL, "");
}

/**
 * 라인 표시용 정규화. 한 줄을 받아 ANSI 제거 + CR 덮어쓰기 처리까지
 * 한 번에 처리. CR 이 있으면 마지막 CR 뒤 텍스트만 살린다 (progress bar).
 */
export function normalizeLine(input: string): string {
  if (!input) return "";
  const stripped = stripAnsi(input);
  const lastCr = stripped.lastIndexOf("\r");
  return lastCr >= 0 ? stripped.slice(lastCr + 1) : stripped;
}
