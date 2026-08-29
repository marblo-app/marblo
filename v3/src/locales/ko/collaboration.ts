/**
 * Korean — `collab.*` namespace. 팀 협업의 저장소 연결(Clone & 연결) 모달
 * (티켓 r8VggohxLGciDVXV2rf6). ../en/collaboration.ts 에 같은 키를 추가할 것.
 */
export const collaboration = {
  "collab.firstShared.eyebrow": "공유 프로젝트",
  "collab.firstShared.body":
    "공유 보드, 완료 이력, 액티비티 스트림을 볼 수 있습니다. 소스 코드는 마블로가 복사하지 않습니다. 각자 이 기기에 코드를 두고 git 으로 변경을 주고받습니다.",
  "collab.firstShared.feature.board": "보드",
  "collab.firstShared.feature.history": "완료 이력",
  "collab.firstShared.feature.activity": "액티비티",
  "collab.firstShared.localCode.title": "코드는 이 기기에 둡니다",
  "collab.firstShared.localCode.body":
    "파일 작업 전에 아래 저장소 설정으로 들어가세요. 같은 설정은 [프로젝트] 탭의 [저장소 연결] 버튼에서도 다시 열 수 있습니다.",
  "collab.firstShared.conflictHint":
    "충돌을 줄이려면 수정 전에 pull 하고, 보드에서 작업 소유자를 분명히 한 뒤, 공유 git remote 로 변경을 올리세요.",
  "collab.firstShared.repoStatus.noRepo.title":
    "등록된 저장소 주소가 없습니다",
  "collab.firstShared.repoStatus.noRepo.body":
    "저장소 설정을 열어 팀 저장소 URL 을 입력하거나 기존 clone 폴더를 연결하세요. URL 을 모르면 프로젝트 오너에게 저장소 연결을 요청하세요.",
  "collab.firstShared.repoStatus.notDownloaded.title":
    "저장소를 받을 준비가 됐습니다",
  "collab.firstShared.repoStatus.notDownloaded.body":
    "이 프로젝트에는 저장소 주소가 있지만, 아직 이 컴퓨터에 코드가 없습니다.",
  "collab.firstShared.repoStatus.downloading.title":
    "저장소를 받는 중입니다",
  "collab.firstShared.repoStatus.downloading.body":
    "마블로가 저장소를 clone 하고 로컬 경로를 기록하는 동안 이 창을 열어 두세요.",
  "collab.firstShared.repoStatus.downloaded.title":
    "이미 이 컴퓨터에 저장소가 있습니다",
  "collab.firstShared.repoStatus.downloaded.body":
    "이 기기에 프로젝트 폴더가 연결되어 있습니다. 코드·워크트리 탭에서 바로 작업할 수 있습니다.",
  "collab.firstShared.cta.noRepo": "저장소 설정 열기",
  "collab.firstShared.cta.notDownloaded": "저장소 받기",
  "collab.firstShared.cta.downloading": "받는 중…",
  "collab.firstShared.gotIt": "확인",

  "collab.repoConnect.title": "저장소 연결",
  "collab.repoConnect.description":
    "이 프로젝트의 코드가 아직 이 컴퓨터에 없습니다. 팀 저장소를 clone 해 연결하면 코드·워크트리 탭을 사용할 수 있습니다.",
  "collab.repoConnect.manualDescription":
    "이 프로젝트에 저장소 주소가 아직 등록되지 않았습니다. 팀 저장소 주소를 붙여넣어 clone 하거나, 이미 clone 해 둔 폴더를 연결하세요.",
  "collab.repoConnect.status.noRepo.title": "저장소 주소가 필요합니다",
  "collab.repoConnect.status.noRepo.body":
    "이 프로젝트에는 저장소 URL 이 아직 없습니다. 팀 저장소 URL 을 입력하거나 기존 clone 폴더를 연결하면 마블로가 이 프로젝트에 기억합니다.",
  "collab.repoConnect.status.readyToDownload.title":
    "이 컴퓨터에 받을 준비가 됐습니다",
  "collab.repoConnect.status.readyToDownload.body":
    "마블로가 이 프로젝트의 저장소를 알고 있습니다. 받을 위치를 고른 뒤 이 기기에 clone 하고 연결하세요.",
  "collab.repoConnect.status.downloading.title": "저장소를 받는 중입니다",
  "collab.repoConnect.status.downloading.body":
    "마블로가 저장소를 clone 하고 있습니다. 끝나면 로컬 폴더를 이 프로젝트에 연결합니다.",
  "collab.repoConnect.status.downloaded.title": "저장소가 연결되었습니다",
  "collab.repoConnect.status.downloaded.body":
    "이 기기에 프로젝트 로컬 폴더가 있습니다. 코드·워크트리 탭을 사용할 수 있습니다.",
  "collab.repoConnect.repoLabel": "프로젝트 저장소",
  "collab.repoConnect.urlPlaceholder": "https://github.com/org/repo.git",
  "collab.repoConnect.locationLabel": "Clone 위치",
  "collab.repoConnect.changeLocation": "위치 변경",
  "collab.repoConnect.cloneAndConnect": "Clone & 연결",
  "collab.repoConnect.cloning": "Clone 중…",
  "collab.repoConnect.connectExisting": "기존 폴더 연결",
  "collab.repoConnect.later": "나중에",
  "collab.repoConnect.privateHint":
    "비공개 저장소는 GitHub 인증이 필요합니다. 터미널에서 `gh auth login`을 실행하거나 SSH 키를 등록한 뒤 다시 시도하세요.",
  "collab.repoConnect.errorAuth":
    "저장소 인증에 실패했습니다. 비공개 저장소라면 GitHub 인증(gh auth login 또는 SSH 키) 후 다시 시도하세요.",
  "collab.repoConnect.errorNotFound":
    "저장소를 찾을 수 없습니다. 주소가 맞는지 확인하고, private 저장소라면 프로젝트 오너에게 GitHub 콜라보레이터로 추가해달라고 요청하세요.",
  "collab.repoConnect.errorNetwork":
    "네트워크 오류로 clone 하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.",
  "collab.repoConnect.errorExists":
    "대상 폴더가 이미 존재합니다. [기존 폴더 연결]로 그 폴더를 연결하거나 다른 위치를 선택하세요.",
  "collab.repoConnect.errorGeneric": "clone 에 실패했습니다.",
  "collab.repoConnect.errorInvalidUrl":
    "저장소 주소 형식이 올바르지 않습니다. https://… 또는 git@… 주소를 입력하세요.",
  "collab.repoConnect.errorMismatch":
    "선택한 폴더의 git origin 이 프로젝트 저장소와 다릅니다. 올바른 클론 폴더를 선택하세요.",
  "collab.repoConnect.errorNoRemote":
    "선택한 폴더에서 git origin 을 찾지 못했습니다. 프로젝트 저장소를 clone 한 폴더를 선택하세요.",
  "collab.repoConnect.connectFailed": "프로젝트에 경로를 기록하지 못했습니다.",
  // macOS Xcode Command Line Tools (티켓 nETj7szjEtT5prbYsg1D).
  // 라이선스 미동의 상태에선 git 이 아예 안 돌아 clone/연결이 전부 실패한다.
  // sudo 가 필요해 앱이 대신 못 하므로, 실행할 명령을 복사 버튼과 함께 준다.
  "collab.repoConnect.errorXcodeLicense":
    "macOS Xcode Command Line Tools 라이선스에 동의해야 git 을 쓸 수 있습니다. 아래 명령을 터미널에 붙여넣어 실행한 뒤 다시 시도하세요. (관리자 비밀번호가 필요해 마블로가 대신 실행할 수 없습니다.)",
  "collab.repoConnect.errorXcodeMissing":
    "macOS Xcode Command Line Tools(git 포함)가 설치되어 있지 않습니다. 아래 명령을 터미널에 붙여넣어 설치를 마친 뒤 다시 시도하세요.",
  "collab.repoConnect.copyCommand": "명령 복사",
  "collab.repoConnect.copied": "복사됨",
  "collab.repoConnect.github.connected": "GitHub 연결됨",
  "collab.repoConnect.github.connect": "GitHub 연결",
  "collab.repoConnect.github.enterCode":
    "GitHub 에서 다음 코드를 입력하세요:",
  "collab.repoConnect.github.open": "GitHub 열기",
  "collab.repoConnect.github.message.connected":
    "GitHub 가 연결되었습니다. 이제 private 저장소를 clone 할 수 있습니다.",
  "collab.repoConnect.github.message.denied": "GitHub 연결이 취소되었습니다.",
  "collab.repoConnect.github.message.expired":
    "GitHub 연결 코드가 만료되었습니다. 다시 시도하세요.",
  "collab.repoConnect.github.message.failed": "GitHub 연결에 실패했습니다.",
  "collab.repoConnect.github.message.startFailed":
    "GitHub 연결을 시작하지 못했습니다.",
  // own-but-empty 보강 (티켓 r8vg9pMWCRtdnUzR3KyX). 자동 등록된 빈 폴더
  // 또는 프로젝트와 다른 git 을 가리키는 own 폴더일 때 보여주는 자기 진단.
  // 사용자가 "내 폴더가 비어 있다" / "내 폴더는 있는데 저장소가 다르다" 를
  // 한눈에 보고 바로 Clone & 연결 또는 다른 폴더 선택으로 바로잡게 한다.
  "collab.repoConnect.ownIssue.empty":
    "이 기기에 등록된 폴더가 비어 있습니다 — `{{path}}`. 프로젝트 저장소를 이 위치에 clone 하거나, 이미 clone 해 둔 폴더로 다시 연결해 주세요.",
  "collab.repoConnect.ownIssue.mismatch":
    "이 기기에 등록된 폴더의 git 저장소가 프로젝트와 다릅니다 — `{{path}}`. 같은 저장소를 clone 한 폴더로 다시 연결해 주세요.",
};
