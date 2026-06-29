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
  // Session-expired notice written into the xterm buffer (after app restart)
  "terminal.session.expired": "세션이 만료되었습니다.",
  "terminal.session.expiredReason": "앱 재시작으로 PTY 세션이 종료되었습니다.",
  "terminal.session.restartHint":
    "Agents 탭에서 Restart 버튼으로 재시작하세요.",
};
