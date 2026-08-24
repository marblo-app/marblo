/**
 * Korean — `terminal.*` namespace (Terminal panel: tabs, xterm view session
 * notices, PM feedback input). One namespace per file so parallel i18n PRs
 * don't collide on a monolith. Keys keep their fully-qualified dotted form.
 *
 * Not translated: agent/CLI stdout rendered inside xterm, the "+ New Terminal"
 * / "Terminal N" labels (English-by-design), and the `[PM 피드백]` activity
 * prefix written to the backend (data record, not UI shell).
 */
export const terminal = {
  // PM feedback toggle (terminal tab bar)
  "terminal.feedback.toggleTitle": "PM 피드백",
  "terminal.feedback.label": "피드백",
  // Feedback input panel
  "terminal.feedback.recent": "최근 피드백",
  "terminal.feedback.historyTitle": "피드백 히스토리",
  "terminal.feedback.placeholder": "PM 피드백을 에이전트에게 전달합니다",
  "terminal.feedback.send": "전송",
  "terminal.feedback.refused.composerOccupied":
    "상대 컴포저에 미제출 초안이 있어 보내지 않았습니다 — 정리되면 다시 시도하세요",
  "terminal.feedback.refused.awaitingChoice":
    "상대가 확인 다이얼로그에 멈춰 있어 보내지 않았습니다",
  "terminal.feedback.refused.generic":
    "보내지 않았습니다 — 잠시 후 다시 시도하세요",
  // Session-expired notice written into the xterm buffer (after app restart).
  // ★이 문구는 "내 기기가 띄운 세션이 끝났다" 일 때만 쓴다 — 판정은
  // lib/terminalSessionOwnership. 남의 기기 것/에이전트 없음은 아래 별도 문구다.
  "terminal.session.expired": "세션이 만료되었습니다.",
  "terminal.session.expiredReason": "앱 재시작으로 PTY 세션이 종료되었습니다.",
  "terminal.session.restartHint":
    "Agents 탭에서 Restart 버튼으로 재시작하세요.",
  // ② 다른 팀원의 기기에서 실행 중 — 고장이 아니라 정상이다. 복구 안내 없음.
  "terminal.session.remoteUser": "다른 팀원의 에이전트입니다.",
  "terminal.session.remoteUserReason":
    "이 에이전트는 다른 팀원의 기기에서 실행 중입니다 — 터미널은 그 기기에서만 보입니다.",
  // ② 같은 계정의 다른 기기 — 역시 여기서 복구할 게 없다.
  "terminal.session.remoteMachine": "다른 기기에서 실행 중입니다.",
  "terminal.session.remoteMachineReason":
    "이 에이전트는 이 기기가 아닌 다른 기기에서 실행 중입니다 — 터미널은 그 기기에서만 보입니다.",
  // ②의 공통 마무리: "티켓은 보이는데 터미널만 안 보이는 게 정상" 이라는 말.
  "terminal.session.remoteHint":
    "티켓과 진행 기록은 그대로 보입니다. 여기서 재시작할 것은 없습니다.",
  // ③ 이 터미널을 뒷받침하는 에이전트 doc 자체가 없다.
  "terminal.session.agentMissing": "연결된 에이전트를 찾을 수 없습니다.",
  "terminal.session.agentMissingReason":
    "에이전트가 삭제되었거나 다른 프로젝트로 옮겨졌습니다.",
  "terminal.session.agentMissingHint": "이 터미널 탭은 닫아도 됩니다.",
};
