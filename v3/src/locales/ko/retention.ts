/**
 * Korean — `retention.*` namespace.
 *
 * 지금 담긴 것은 "왜 멈췄나" 단일 문항 하나뿐이다. 판정·선택지 어휘는
 * `lib/pauseReasonPrompt.ts` 에 있고 여기에는 **보이는 글자만** 있다.
 *
 * ★문면 규율 — 이 화면은 답을 얻으려고 사람을 압박하지 않는다.
 *  · 구걸하지 않는다: "부탁드립니다", "5초만", "큰 도움이 됩니다" 금지.
 *  · 죄책감을 주지 않는다: "왜 안 쓰셨어요", "아쉽습니다" 같은 서운함 금지.
 *  · 보상으로 사지 않는다: 이 문항에는 리워드가 없다(있으면 답이 왜곡된다).
 *  · 안 답할 자유를 **먼저** 적는다: 선택지보다 위에 "답하지 않아도 됩니다".
 *  · 다시 안 묻겠다고 약속하고, 그 약속을 코드가 지킨다.
 */
export const retention = {
  "retention.pauseReason.eyebrow": "질문 하나",
  "retention.pauseReason.title":
    "{days}일 만이네요. 그 사이 마블로를 쓰지 않은 이유에 가장 가까운 것은?",
  "retention.pauseReason.optOut":
    "답하지 않아도 됩니다. 이 질문은 다시 나오지 않습니다.",

  "retention.pauseReason.option.noNeed": "바빴거나 마블로로 할 일이 없었다",
  "retention.pauseReason.option.otherTool": "다른 도구로 같은 일을 했다",
  "retention.pauseReason.option.setupFriction": "설정·연결이 번거로웠다",
  "retention.pauseReason.option.outputQuality": "결과물이 기대에 못 미쳤다",
  "retention.pauseReason.option.cost": "비용이 부담됐다",
  "retention.pauseReason.option.other": "그 밖의 이유",

  "retention.pauseReason.noteLabel": "덧붙일 말 (선택)",
  "retention.pauseReason.notePlaceholder": "한 줄이면 충분합니다.",
  "retention.pauseReason.noteScope": "고른 항목과 이 한 줄만 전송됩니다.",

  "retention.pauseReason.send": "보내기",
  "retention.pauseReason.sending": "보내는 중...",
  "retention.pauseReason.close": "닫기",
  "retention.pauseReason.dismiss": "질문 닫기",
  "retention.pauseReason.noteFailed":
    "덧붙인 말은 전달되지 않았습니다. 고른 항목은 기록됐습니다.",
};
