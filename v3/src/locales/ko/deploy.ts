/**
 * Korean — `deploy.*` namespace (Deploy tab: GCP Cloud Run deploy surface).
 * One namespace per file so parallel i18n PRs don't collide on a monolith.
 * Keys keep their fully-qualified dotted form.
 *
 * Not translated (agent/data boundary): prompts injected into the PTY for the
 * orchestrator (deploy request / GCP connect request) are agent input, and
 * deployment records (serviceName/image/startedAt/triggeredBy) are data.
 */
export const deploy = {
  "deploy.selectProject": "프로젝트를 선택해주세요",
  "deploy.subtitle": "GCP Cloud Run 배포 관리",
  "deploy.requestDeploy": "배포 요청",
  "deploy.gcpConnection": "GCP 연결",
  "deploy.notConnected": "연결되지 않음",
  "deploy.connect": "연결 설정",
  "deploy.history": "배포 이력",
  "deploy.loading": "로딩 중...",
  "deploy.empty": "아직 배포 이력이 없습니다",
  // Empty-state hint wraps an inline `/tf-deploy` token (before/after split).
  "deploy.emptyHintBefore": "오케스트레이터에게 ",
  "deploy.emptyHintAfter": "로 배포를 요청하세요",
  // Quick guide
  "deploy.guide.title": "시작하기",
  // Step 1 wraps a quoted example prompt (before/quoted/after split).
  "deploy.guide.step1Before": "오케스트레이터를 시작하고 ",
  "deploy.guide.step1Quoted": '"GCP 프로젝트 연결해줘"',
  "deploy.guide.step1After": "라고 요청",
  // Step 2 trails a `gcloud auth login` code token.
  "deploy.guide.step2After": " + 프로젝트 ID / 리전 설정",
  // Step 3 wraps a `/tf-deploy` token (before/after split).
  "deploy.guide.step3Before": "",
  "deploy.guide.step3After": "로 Cloud Run 배포 요청",
};
