/**
 * Korean — `githubGuide.*` namespace. 앱 안에서 읽는 GitHub 연결 안내
 * (티켓 kzxsRzC37uVvYftpVZO4). ../en/githubGuide.ts 에 같은 키를 추가할 것.
 *
 * ★재료는 `v3/docs/github-app-registration-values-2026-08-21.md` 다. 그건
 * **개발자 문서**이고, 여기 있는 건 그걸 **사용자가 읽는 말**로 옮긴 것이다.
 *
 * ★문구 규율 — 과장하지 않는다:
 *  - 권한 상태(read / write)에 따라 실제로 되는 게 다르다. `writeGranted` 가
 *    거짓인 구간에서 "이제 다 됩니다" 라고 쓰면 그건 거짓말이다. 그 구간의
 *    문구는 "받는 건 됩니다 / 미는 건 아직" 이라고 정확히 말한다.
 *  - 서버가 사유를 뭉개는 상태에서는 단정하지 않고 `*.also` 로 갈래를 준다.
 *  - 슬러그·설치 URL 은 문구에 없다. 서버가 만들어 준다(하드코딩 금지).
 */
export const githubGuide = {
  // ── 공통 전제 ──────────────────────────────────────────────────────────
  "githubGuide.loading.title": "GitHub 연결 상태 확인 중",
  "githubGuide.loading.body":
    "이 프로젝트의 GitHub 설치 상태를 확인하고 있습니다.",
  "githubGuide.loading.next": "잠시만 기다려 주세요.",

  "githubGuide.unsupported.title": "이 화면에서는 확인할 수 없습니다",
  "githubGuide.unsupported.body":
    "GitHub 연결 상태는 마블로 데스크톱 앱에서만 확인할 수 있습니다.",
  "githubGuide.unsupported.next": "데스크톱 앱에서 이 프로젝트를 열어 주세요.",

  "githubGuide.error.title": "상태를 확인하지 못했습니다",
  "githubGuide.error.body":
    "GitHub 설치 상태를 불러오지 못했습니다. 연결이 끊겼거나 일시적인 오류입니다. 확인하지 못한 것을 '연결됨' 으로 보여 드리지는 않습니다.",
  "githubGuide.error.next": "네트워크를 확인한 뒤 [다시 확인] 을 눌러 주세요.",

  "githubGuide.notConfigured.title": "GitHub 연결이 아직 준비되지 않았습니다",
  "githubGuide.notConfigured.body":
    "이 버전에는 GitHub App 연결이 아직 설정되지 않았습니다. 그동안에도 코드 받기는 각자 GitHub 로그인으로 계속 됩니다.",
  "githubGuide.notConfigured.nextOwner":
    "지금 하실 일은 없습니다. 준비되면 이 화면에 설치 버튼이 나타납니다.",
  "githubGuide.notConfigured.nextMember":
    "지금 하실 일은 없습니다. 코드를 받지 못하면 프로젝트 오너에게 알려 주세요.",

  // ── 오너 화면 ──────────────────────────────────────────────────────────
  "githubGuide.owner.title": "팀원이 저장소를 받게 하려면",
  "githubGuide.owner.subtitle":
    "한 번만 설치하면 됩니다. 그 뒤로는 보드에서 역할만 주면 팀원이 코드를 받습니다.",
  "githubGuide.owner.stepsTitle": "오너가 하는 일은 두 가지입니다",
  "githubGuide.owner.step1": "GitHub 에서 마블로 App 을 설치합니다 (한 번).",
  "githubGuide.owner.step2": "마블로 보드에서 팀원에게 역할을 줍니다.",
  "githubGuide.owner.stepNote":
    "GitHub 에서 팀원을 콜라보레이터로 초대할 필요는 없습니다.",

  "githubGuide.owner.whyPermission": "왜 이 권한을 요구하나요",
  "githubGuide.owner.whyPermissionBody":
    "저장소를 받고 브랜치를 올리는 데만 씁니다. 누가 무엇에 접근하는지는 GitHub 이 아니라 마블로 역할이 정합니다.",
  "githubGuide.owner.scopeHint":
    "설치 화면에서 [Only select repositories] 를 고르고 이 프로젝트 저장소만 선택하세요. [All repositories] 는 조직 전체를 넘기게 됩니다.",

  "githubGuide.owner.statusLabel": "현재 상태",
  "githubGuide.owner.installCta": "GitHub 에서 App 설치하기",
  "githubGuide.owner.installOpening": "브라우저를 여는 중…",
  "githubGuide.owner.recheckCta": "다시 확인",
  "githubGuide.owner.checking": "확인 중…",
  "githubGuide.owner.returnHint":
    "브라우저에서 설치를 마치고 이 창으로 돌아오면 자동으로 다시 확인합니다.",
  "githubGuide.owner.installFailed": "설치를 시작하지 못했습니다: {error}",
  "githubGuide.owner.installConfirmed":
    "설치를 확인했습니다. 팀원은 앱에 GitHub 로 로그인만 하면 코드를 받습니다.",

  "githubGuide.owner.noRepoUrl.title": "먼저 저장소를 연결하세요",
  "githubGuide.owner.noRepoUrl.body":
    "이 프로젝트에 GitHub 저장소 주소가 아직 없습니다. 붙일 저장소가 없으면 App 을 설치해도 팀원이 받을 코드가 없습니다.",
  "githubGuide.owner.noRepoUrl.next":
    "[저장소 연결] 로 이 프로젝트의 GitHub 저장소를 먼저 연결하세요.",

  "githubGuide.owner.notInstalled.title": "아직 설치되지 않았습니다",
  "githubGuide.owner.notInstalled.body":
    "이 프로젝트에 마블로 App 이 연결되어 있지 않습니다. 지금은 팀원이 각자 GitHub 로그인으로 코드를 받아야 합니다.",
  "githubGuide.owner.notInstalled.next":
    "아래 [GitHub 에서 App 설치하기] 를 눌러 이 프로젝트 저장소에 설치하세요.",

  "githubGuide.owner.repoMismatch.title":
    "설치는 됐지만 이 저장소가 빠져 있습니다",
  "githubGuide.owner.repoMismatch.body":
    "마블로 App 설치는 살아 있는데 이 프로젝트의 저장소를 열지 못합니다. 설치할 때 이 저장소를 고르지 않았거나, 저장소를 다른 계정·조직으로 옮겼을 때 이렇게 됩니다.",
  "githubGuide.owner.repoMismatch.next":
    "설치 화면을 열어 이 저장소를 선택 목록에 추가하세요. 저장소를 조직으로 옮기셨다면 그 조직에 다시 설치해야 합니다.",

  "githubGuide.owner.readOnly.title": "지금은 코드 받기만 됩니다",
  "githubGuide.owner.readOnly.body":
    "설치가 아직 읽기 권한만 승인한 상태입니다. 팀원이 코드를 받는 것은 지금도 되지만, 앱에서 브랜치를 올리는 것은 아직 되지 않습니다.",
  "githubGuide.owner.readOnly.next":
    "설치 화면에서 GitHub 이 요청하는 새 권한을 승인해 주세요. 승인 전까지 코드 받기는 그대로 동작합니다.",

  "githubGuide.owner.ready.title": "설치 완료",
  "githubGuide.owner.ready.body":
    "이 프로젝트 저장소에 마블로 App 이 연결되어 있고, 코드 받기와 브랜치 올리기가 모두 됩니다.",
  "githubGuide.owner.ready.next":
    "남은 일은 보드에서 팀원에게 역할을 주는 것뿐입니다. 팀원이 GitHub 에서 할 일은 없습니다.",

  // ── 팀원 화면 ──────────────────────────────────────────────────────────
  // ★이 화면의 핵심 메시지는 상태와 무관하게 항상 이 머리글이다.
  "githubGuide.member.title": "GitHub 에서 하실 일은 없습니다",
  "githubGuide.member.subtitle":
    "이 앱에 본인 GitHub 계정으로 로그인만 하면 됩니다. 그게 전부입니다.",
  "githubGuide.member.noInviteTitle": "초대 메일을 기다리지 마세요",
  "githubGuide.member.noInviteBody":
    "GitHub 에서 저장소 초대 메일이 오지 않습니다. 오지 않는 게 정상입니다. 접근 권한은 마블로에서 받은 역할을 따릅니다.",
  "githubGuide.member.loginCta":
    "GitHub 계정 연결은 [설정 → 연결] 에서 합니다.",

  "githubGuide.member.noRepoUrl.title": "이 프로젝트에 저장소가 없습니다",
  "githubGuide.member.noRepoUrl.body":
    "이 프로젝트에 GitHub 저장소 주소가 아직 등록되지 않았습니다. 받을 코드가 아직 없습니다.",
  "githubGuide.member.noRepoUrl.next":
    "프로젝트 오너에게 저장소를 연결해 달라고 요청하세요.",

  "githubGuide.member.notInstalled.title":
    "오너가 아직 GitHub App 을 설치하지 않았습니다",
  "githubGuide.member.notInstalled.body":
    "이 프로젝트에 마블로 App 이 아직 연결되어 있지 않아 자동으로 코드를 받을 수 없습니다. 이건 여러분이 아니라 오너 쪽에서 푸는 문제입니다.",
  "githubGuide.member.notInstalled.next":
    "프로젝트 오너가 [프로젝트] 탭에서 GitHub App 을 설치할 때까지 기다려 주세요.",
  "githubGuide.member.notInstalled.also":
    "오너가 설치를 마쳤는데도 이 안내가 그대로라면, 오너에게 (1) 나에게 역할이 부여됐는지, (2) 팀 협업이 포함된 요금제인지 확인해 달라고 하세요.",

  "githubGuide.member.repoMismatch.title": "오너가 이 저장소를 추가해야 합니다",
  "githubGuide.member.repoMismatch.body":
    "마블로 App 은 설치되어 있지만 이 프로젝트의 저장소가 그 설치에 포함되어 있지 않습니다.",
  "githubGuide.member.repoMismatch.next":
    "프로젝트 오너에게 설치 목록에 이 저장소를 추가해 달라고 요청하세요.",

  "githubGuide.member.readOnly.title":
    "코드 받기는 됩니다 — 올리기는 아직입니다",
  "githubGuide.member.readOnly.body":
    "지금 설치는 읽기 권한만 승인된 상태입니다. 코드를 받아 작업하는 것은 되지만, 앱에서 브랜치를 올리는 것은 아직 되지 않습니다.",
  "githubGuide.member.readOnly.next":
    "프로젝트 오너에게 GitHub 에서 새 권한을 승인해 달라고 요청하세요. 그전까지는 코드 받기와 로컬 작업을 계속하시면 됩니다.",

  "githubGuide.member.viewer.title": "보기 전용 역할입니다",
  "githubGuide.member.viewer.body":
    "현재 역할이 viewer 입니다. 코드를 받아 보는 것은 되지만, 앱에서 브랜치를 올리는 것은 되지 않습니다.",
  "githubGuide.member.viewer.next":
    "코드를 올려야 한다면 프로젝트 오너에게 member 이상 역할을 요청하세요.",

  "githubGuide.member.ready.title": "준비 완료",
  "githubGuide.member.ready.body":
    "이 프로젝트의 코드를 받고 브랜치를 올릴 수 있습니다. GitHub 에서 따로 하실 일은 없습니다.",
  "githubGuide.member.ready.next":
    "[프로젝트] 탭의 [저장소 연결] 로 이 컴퓨터에 저장소를 받은 뒤 시작하세요.",

  // ── 레거시 경로(App 이 없을 때만 보인다) ───────────────────────────────
  // ★App 이 붙으면 이 안내는 틀린 말이 되므로 ProjectTab 이 감춘다.
  "githubGuide.legacyCollaborator.notice":
    "이 프로젝트는 비공개 저장소와 연결되어 있습니다. GitHub App 이 연결되기 전까지는, 초대한 팀원이 코드를 받으려면 GitHub 콜라보레이터로도 추가해야 합니다.",
  "githubGuide.legacyCollaborator.link": "협업자 페이지 열기",

  // ── 공통 라벨 ──────────────────────────────────────────────────────────
  "githubGuide.nextLabel": "다음에 할 일",
  "githubGuide.roleLabel": "내 역할",
  "githubGuide.badge.ok": "연결됨",
  "githubGuide.badge.warn": "일부 제한",
  "githubGuide.badge.blocked": "연결 안 됨",
  "githubGuide.badge.neutral": "확인 중",
};
