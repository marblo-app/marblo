# GitHub App 자동상속 설계 — 오너 1회 설치 → 멤버 무마찰 접근

- 날짜: 2026-08-21
- 티켓: `Dqw3dD9iA7yttsVzOjvB` (설계) / 상위 에픽 `FFrgruR7qUYANYvL9ETt` (범위) / org 티켓 `5EeccZ5RbHXCMWaSR77E`
- 상태: **설계만.** GitHub App 을 만들지도, 설치하지도 않았다. 코드도 바꾸지 않았다.
- 대상 코드: `v3/electron/repo-clone.ts`, `v3/electron/github-token-store.ts`, `v3/electron/github-device-oauth.ts`, `v3/functions/src/`, `v3/firestore.rules`

> 상위 에픽(`FFrgruR7qUYANYvL9ETt`)에 이미 적힌 것(무엇을 만들지 · 3개 서브티켓 분할 · functions 배포 주의)은 여기서 반복하지 않는다.
> 이 문서가 새로 정하는 것: ① device OAuth 와 App 의 **역할 경계**, ② **scope 항목별 정당화**, ③ 회귀 0 을 폴백이 아니라 **분기 선택**으로 보장하는 방법, ④ **탈퇴 시 접근 차단 경로**, ⑤ **org 선행 여부 판단**, ⑥ 토큰 유출 경계 — 그리고 그 과정에서 **실측된 기존 결함 3건**.

---

## 0. 한 줄 결론

**device OAuth 는 "너는 누구인가"고, GitHub App 은 "이 저장소를 읽어도 되는가"다. 둘은 대체 관계가 아니라 직교한다.** App 은 오너가 저장소 접근을 한 번에 위임하는 수단이고, 멤버의 신원은 끝까지 각자의 GitHub 계정이다. 그래서 계정 공유는 이 설계에 등장하지 않는다 — 약관 위반이자 감사 추적 소멸이며, App 이 그 유혹을 없애는 것이 이 에픽의 진짜 가치다.

---

## 1. 지금 구조 (실측)

| 요소 | 실측 내용 | 파일 |
| --- | --- | --- |
| 인증 | OAuth **device authorization grant** (RFC 8628), 멤버 각자 자기 GitHub 계정 | `electron/github-device-oauth.ts` |
| 요청 scope | **`repo`** (URLSearchParams 의 `scope: "repo"`) | `github-device-oauth.ts:97` |
| 토큰 보관 | `safeStorage` 암호화 → `~/.marblo/github-oauth.enc.json`, mode 0600, key = Marblo uid | `github-token-store.ts` |
| 토큰 소비처 | **`repo:clone` 단 한 곳** | `main.ts:6628-6631` |
| clone 방식 | `https://oauth2:<token>@github.com/...` 를 만들어 `git clone -- <url> <dest>` | `repo-clone.ts:tokenizedGitHubCloneUrl` / `cloneRepo` |
| 멤버십 진실원 | Firestore `projects/{id}.members[]` + `.ownerId` | `firestore.rules:140-150`, `src/services/projectService.ts` |
| push / PR | Electron 이 아니라 **에이전트 PTY 안의 `gh` CLI** (멤버 자기 계정) | `electron/mcp-server/tools.ts` (`gh pr view/list/merge`) |

**마찰의 위치**: 인증이 아니다. 인증은 멤버가 1분이면 끝낸다. 마찰은 **오너가 저장소 콜라보레이터를 한 명씩 손으로 추가**해야 한다는 것이고, 그건 멤버 수에 비례해 커지며 **나갈 때 지우는 것을 잊는다**.

### 1.1 실측된 기존 결함 (App 설계 전에 알아야 하는 것)

App 을 어떻게 붙일지가 이 세 개에 달려 있어서 먼저 적는다. 셋 다 **지금 배포된 device OAuth 경로의 문제**이지 App 때문에 생기는 게 아니다.

#### 결함 A — clone 토큰이 `.git/config` 에 평문으로 영구히 남는다

`git clone` 은 인자로 준 URL 을 **그대로** `remote.origin.url` 에 기록한다. 로컬 실측:

```
$ git clone "file:///.../src.git" dst
$ grep -A2 'remote "origin"' dst/.git/config
[remote "origin"]
        url = file:///.../src.git        ← 인자 문자열 그대로
```

git 은 URL 의 userinfo(`oauth2:<token>@`)를 떼지 않는다. 즉 **Marblo 로 clone 한 모든 작업본의 `.git/config` 에 사용자 GitHub 토큰이 평문으로 있다.** `safeStorage` 로 암호화해 보관한 토큰이 clone 한 번으로 평문 복사본을 만든다.

#### 결함 B — 그 토큰이 IPC → 렌더러 → Firestore → 화면까지 흐른다

`.git/config` 에 있으니 `git remote get-url origin` 이 그대로 뱉는다. 그 값이 도달하는 곳(실측 경로):

```
.git/config
  └─ fs-manager.getGitRemoteUrl()            electron/fs-manager.ts:396  (git remote get-url origin, 원문 그대로 resolve)
      └─ ipcMain.handle("fs:gitRemoteUrl")   electron/main.ts:5487       ← ★토큰이 IPC 경계를 넘는다
          ├─ RepoConnectModal.handleConnectExisting()  src/.../RepoConnectModal.tsx:473
          │   ├─ fail("...errorMismatch", origin)      :486  ← ★토큰이 화면에 렌더된다
          │   └─ backfillRepoUrl(origin)               :487 → updateProject({gitRemoteUrl})
          │       └─ Firestore projects/{id}.gitRemoteUrl  ← ★토큰이 팀 전원이 읽는 문서에 저장된다
          ├─ FileTree.tsx:1662, WorktreeTab.tsx:793
          └─ connection-store.deriveGitRepoMeta()      electron/connection-store.ts:270 → 로컬 연결 원장
```

`errorMismatch` 분기가 실제로 도달 가능한지 검증했다. `normalizeGitRemoteUrl` 이 userinfo 를 벗기지 않기 때문이다:

```
$ node -e '...normalizeGitRemoteUrl...'
tokenized : oauth2:ghu_token123@github.com/melocream/marblo
clean     : github.com/melocream/marblo
equal?    : false      ← 항상 mismatch → fail(..., origin) 이 원문(raw origin)을 표시한다
```

즉 "Marblo 로 clone 한 폴더를 다시 [기존 폴더 연결] 로 고르면" 토큰이 모달에 뜨고, 프로젝트에 주소가 아직 없으면 그 토큰 박힌 URL 이 Firestore 에 백필된다.

#### 결함 C — scope `repo` 는 필요한 것보다 훨씬 넓다

토큰 소비처는 clone 하나(`main.ts:6628`)인데 받는 권한은 `repo` — private 저장소의 **읽기 + 쓰기 + 저장소 설정 + 콜라보레이터 관리 + webhook + deploy key** 전부다. 읽기 하나를 위해 저장소 전권을 받아 평문으로 디스크에 두고 있다.

> ★ **이 세 건은 App 과 무관하게 지금 살아 있는 결함이다.** 별도 티켓으로 분리해야 한다(§8). App 설계는 이걸 **상속하지 않는 방식**으로 한다.

---

## 2. 역할 분리 — App 은 인증이 아니다

| | device OAuth (`github-device-oauth.ts`) | GitHub App installation |
| --- | --- | --- |
| 답하는 질문 | **"너는 누구인가"** | **"이 저장소를 읽어도 되는가"** |
| 주체 | 멤버 개인 (자기 GitHub 계정) | 저장소 오너 (조직/계정 단위 1회) |
| 신원 | 멤버 본인 | 없음 — `marblo[bot]` 은 사람이 아니다 |
| 토큰 성격 | 사용자 토큰, 장수명, 사용자가 폐기 | installation 토큰, **1시간 고정·갱신 불가** |
| 발급 위치 | 클라이언트(Electron) ↔ GitHub 직접 | **서버(Cloud Functions)만** — private key 가 서버에만 있다 |
| commit author | 멤버 본인 | (v1 에서 push 안 함) |
| 없어지면 | 그 사람만 로그인 못 함 | 그 저장소만 못 읽음 |

**설계 규칙 — 이 문서가 강제하는 선:**

1. **App 은 로그인 버튼이 아니다.** App 설정에서 *Request user authorization (OAuth) during installation* 을 **끈다**. App 이 사용자 신원을 발급할 수 있게 되는 순간 "그럼 device OAuth 는 왜 있냐"는 질문이 생기고, 그 다음이 계정 공유다.
2. **App 토큰으로 push 하지 않는다** (v1). push 는 멤버 자기 계정의 `gh` 로 한다 → "누가 밀었나"가 GitHub 감사로그에 사람 이름으로 남는다. App 토큰으로 밀면 push 이벤트가 전부 `marblo[bot]` 으로 뭉개진다.
3. **App 토큰을 에이전트 PTY 환경변수로 내보내지 않는다.** `GITHUB_TOKEN` / `GITHUB_PERSONAL_ACCESS_TOKEN`(`harness-catalog.ts:306`) 은 계속 멤버 본인 토큰이다. App 토큰이 PTY env 에 들어가면 모든 하위 프로세스와 트랜스크립트의 `env` 덤프에 1시간짜리 자격증명이 노출되고, 무엇보다 **에이전트가 봇 신원으로 행동**하게 된다.

---

## 3. 설치 모델

### 3.1 흐름

```
[1] 오너: Marblo → 프로젝트 설정 → [Marblo GitHub App 설치]
        → github.com/apps/marblo/installations/new?state=<서명된 nonce>
        → 오너가 GitHub 화면에서 "Only select repositories" 로 이 프로젝트 repo 만 선택
        → GitHub 이 setup_url 로 redirect: ?installation_id=<id>&setup_action=install&state=<nonce>

[2] 서버(Cloud Functions, onRequest `githubAppSetupCallback`):
        - state nonce 검증 (한 번만 쓰이는 값, 발급자 uid 와 projectId 바인딩, 10분 만료)
        - nonce 의 uid == 그 프로젝트의 ownerId 인지 확인   ★오너만 설치를 바인딩할 수 있다
        - App JWT 로 GET /app/installations/{id} → 설치 계정 확인
        - GET /installation/repositories → repo 목록 확인
        - Admin SDK 로 projects/{projectId}.githubInstallationId = <id> 기록  ★클라 write 아님

[3] 멤버: [Clone & 연결] 버튼
        - Electron → callable issueRepoInstallationToken({ projectId })
        - 서버가 멤버십 검증 후 1시간짜리 토큰을 1회 반환
        - Electron 이 그 토큰으로 clone (URL 에 박지 않는다, §5)
        - 토큰은 clone 끝나면 메모리에서 사라진다. 저장 안 함.
```

### 3.2 발급 엔드포인트 — `issueRepoInstallationToken`

```
callable(context.auth 필수)
  in : { projectId }              ★ repo 나 installationId 를 클라에서 받지 않는다
  out: { token, expiresAt, repo } ★ token 은 이 응답에만 존재. 서버는 저장하지 않는다
```

검증 순서 (하나라도 실패하면 즉시 거부, 이유는 뭉뚱그려 반환):

1. `context.auth` 없으면 `unauthenticated`.
2. `rateLimit.enforce()` — uid+projectId 당 예: 20회/시간. 계정이 털렸을 때 토큰 양산을 막는다. (`functions/src/rateLimit.ts` 이미 있음)
3. Admin SDK 로 `projects/{projectId}` 읽기 → `uid ∈ members || uid == ownerId` 아니면 `permission-denied`.
4. 팀 협업 엔타이틀먼트 확인 (`grantPlan` 의 `hasTeamCollab`) — 팀 기능이 유료 게이트를 우회하지 않게.
5. `project.githubInstallationId` 없으면 `failed-precondition` → 클라는 device 경로로 간다(§6).
6. `project.gitRemoteUrl` → `owner/repo` 슬러그 도출.
7. **App JWT 로 `GET /installation/repositories` 를 호출해 그 슬러그가 이 installation 에 실제로 포함되는지 확인.** 없으면 거부.
8. `POST /app/installations/{id}/access_tokens` 를 **`repository_ids: [그 repo 하나]` + `permissions: { contents: "read" }`** 로 호출 → 설치 권한의 부분집합으로 다운스코프.
9. `audit_logs` 에 `{uid, projectId, repoSlug, ts, outcome}` 기록. **토큰은 절대 기록하지 않는다.**

> ★ **7번이 왜 필수인가 (실측 근거).** `firestore.rules:147-148` 은 `allow update: if isProjectMember(projectId)` 다 — **멤버 누구나 프로젝트 문서의 아무 필드나 쓸 수 있다.** 그래서 6번의 `gitRemoteUrl` 도, 5번의 `githubInstallationId` 도 멤버가 조작 가능하다. 7번이 없으면 프로젝트 A 의 멤버가 A 의 두 필드를 프로젝트 B 의 것으로 바꿔 **B 의 private repo 토큰을 받아낼 수 있다.** 크로스테넌트 권한 상승이다.
>
> 그래서 방어를 두 겹으로 둔다:
> - **룰**: `githubInstallationId` 를 클라이언트 write 금지 필드로 만든다. 멤버 update 시 `request.resource.data.get('githubInstallationId', null) == resource.data.get('githubInstallationId', null)` 를 요구 → 서버(Admin SDK)만 쓴다.
> - **서버**: 그래도 `gitRemoteUrl` 은 멤버가 쓸 수 있으므로, 7번에서 GitHub 에 되물어 확인한다. 룰만 믿지 않는다.

### 3.3 App private key

- **Cloud Functions 환경변수/시크릿에만 존재한다.** `functions/src/index.ts` 의 기존 규약(`process.env.PADDLE_API_KEY` 등)과 동일.
- **Electron 앱에 절대 넣지 않는다.** asar 는 암호화가 아니다 — 데스크톱 바이너리에 넣는 건 전 사용자에게 배포하는 것과 같다. private key 하나면 **모든 설치처의 모든 저장소** 토큰을 찍어낼 수 있다.
- 저장소·Firestore·로그·Sentry 어디에도 없다.
- App JWT: RS256, `exp ≤ 10분`, 요청 시마다 즉석 생성, 로그 금지.
- 회전 절차: GitHub App 설정에서 새 private key 생성 → 시크릿 갱신 → 배포 확인 후 구 key 폐기. (구 key 를 먼저 지우면 발급이 끊긴다.)

---

## 4. 권한(scope) — 항목별 정당화

### 4.1 요청하는 것

| 권한 | 수준 | 왜 필요한가 | 없으면 |
| --- | --- | --- | --- |
| **Repository → Contents** | **Read-only** | 유일한 사용처인 `git clone` / `fetch` 가 이것 하나로 성립한다. HTTPS 로 `x-access-token:<installation token>` 인증 시 필요한 최소 권한. | 멤버가 저장소를 못 받는다. 에픽 전체가 무의미해진다. |
| **Repository → Metadata** | **Read-only** | GitHub 이 **강제**한다 — 저장소 권한을 하나라도 요구하면 자동으로 딸려오고 거부할 수 없다. `GET /installation/repositories`(§3.2 7번 검증)와 기본 브랜치 조회가 여기 붙는다. | 선택 불가. |

**끝이다. v1 은 이 둘.**

### 4.2 요청하지 않는 것과 그 이유

| 권한 | 왜 안 받나 | 다시 볼 조건 |
| --- | --- | --- |
| Contents **Write** | push 는 멤버 자기 `gh` 로 한다(§2-2). 받으면 Marblo 서버가 **모든 고객 저장소의 코드를 고칠 수 있는** 주체가 되고, push 이벤트 감사 추적이 `marblo[bot]` 으로 뭉개진다. 서버 침해 시 폭발 반경이 "읽기"에서 "고객 코드 변조"로 뛴다. | "쓰기 권한 없는 멤버가 push 해야 한다"가 실제 요구로 확인될 때. 그 땐 봇 귀속을 감수하는 결정이 필요하다. |
| Pull requests | `gh pr create/merge` 가 멤버 계정으로 한다(`mcp-server/tools.ts` 실측). **서버**가 PR 을 만들 계획이 없다. | 서버측 자동 PR 기능이 생기면. |
| Issues | 티켓은 Firestore `tasks` 에 있다. GitHub Issues 를 쓰지 않는다. | GitHub Issues 연동 제품 결정이 나면. |
| Webhooks (Repository hooks) | `recordGitHubMergeHistory`(`index.ts:469`)는 이미 공유 시크릿 헤더로 동작하며 저장소마다 수동 설정이다. 자동 등록만을 위해 write 를 받을 이유가 없다. | webhook 자동 프로비저닝을 하기로 하면(별도 티켓). |
| **Administration** | 저장소 설정·삭제·콜라보레이터 관리. **어떤 기능도 필요로 하지 않는다.** 이걸 받는 순간 App 침해 = 고객 저장소 삭제 가능. | 없음. 영구 거부 후보. |
| Actions / Secrets / Deployments / Packages / Environments | 사용처 0. | 없음. |
| **Organization → Members: Read** | "GitHub org 멤버인지 확인하면 편하다"는 유혹이 있지만, **멤버십 진실원은 Firestore `projects.members` 지 GitHub 이 아니다.** 이걸 받으면 고객 조직의 **전체 인원 명부**가 Marblo 로 들어온다 — 필요 없는 PII 다. | 없음. 아키텍처가 바뀌기 전엔. |
| Account → Email 등 | App 은 인증이 아니다(§2-1). | 없음. |

### 4.3 App 설정값

| 설정 | 값 | 이유 |
| --- | --- | --- |
| Repository access | **Only select repositories** | "All repositories" 는 오너가 무심코 조직 전체를 넘기게 만든다. 선택식이 기본이어야 사고가 사고로 안 커진다. |
| Request user authorization (OAuth) during installation | **OFF** | App 이 신원 발급을 못 하게 못 박는다(§2-1). |
| Webhook | **비활성 (URL 없음)** | v1 에 소비할 이벤트가 없다. 안 받는 이벤트는 지킬 필요도 없다. |
| Where can this App be installed | **v1(자체 도그푸딩): Only on this account** → **GA: Any account** | 고객 오너가 자기 조직에 설치하는 게 최종 형태지만, 검증 전에 공개 설치를 열지 않는다. |
| 토큰 다운스코프 | 발급 시 항상 `repository_ids` 1개 + `permissions.contents=read` | 설치에 repo 가 5개여도 발급되는 토큰은 **요청한 1개**만 연다. |

### 4.4 이 scope 로 되는 것 / 안 되는 것 (솔직하게)

- **된다**: 오너가 콜라보레이터로 초대하지 않은 멤버도 **clone / fetch / pull** 이 된다. 리뷰어·PM·읽기 위주 에이전트 — 대다수 멤버가 여기 해당한다.
- **안 된다**: 그 멤버의 **push 는 여전히 안 된다.** push 하려면 오너가 그 사람에게 GitHub 쓰기 권한을 줘야 한다.
- 이건 숨겨진 한계가 아니라 **선택한 경계**다. 최소 권한으로 시작해서 부족하면 늘리는 게, 넓게 받아 놓고 줄이는 것보다 항상 쉽다. 반대로 갔다가 사고 난 뒤에 줄이는 건 사고 수습이지 설계가 아니다.

---

## 5. 토큰 경계 — 로그·IPC·화면·디스크

§1.1 의 결함 A/B 를 **상속하지 않는** 것이 이 절의 목적이다. 원칙: **가려서(redaction) 막지 말고, 애초에 흐르지 않게(by construction) 만든다.**

### B1. clone URL 에 토큰을 박지 않는다 ★가장 중요

`tokenizedGitHubCloneUrl()` 방식(= `https://oauth2:<token>@...`)을 App 경로에 쓰면 안 된다. 1시간 뒤 죽을 토큰이 `.git/config` 에 영구히 남고, 결함 B 의 전 경로가 그대로 재현된다.

대신 **askpass**:

```
env  : MARBLO_GIT_PASSWORD=<installation token>   ← 자식 프로세스 env 로만 전달
       GIT_ASKPASS=<앱 리소스의 작은 스크립트>     ← env 의 값을 stdout 으로 echo
       GIT_TERMINAL_PROMPT=0                       ← 기존 값 유지
argv : git clone -- https://x-access-token@github.com/<owner>/<repo>.git <dest>
```

- **argv 에 토큰이 없다** → `ps` 로 안 보인다. (`-c http.extraheader=...` 방식은 argv 에 실려서 부적합하다.)
- **`.git/config` 에 토큰이 없다** → `remote.origin.url` 이 깨끗하다 → 결함 B 의 IPC·화면·Firestore 경로가 **구조적으로** 막힌다. 마스킹 코드가 필요 없다.
- env 는 그 git 자식 프로세스에만 준다. Electron 프로세스 env 나 PTY env 에 넣지 않는다.

### B2. 서버는 토큰을 저장하지 않는다

발급 응답에 한 번 실려 나가고 끝. Firestore·로그·캐시 어디에도 안 남긴다. 저장할 이유가 없다 — 1시간짜리를 캐시해서 아끼는 것보다 안 갖고 있는 게 낫다.

### B3. IPC 경계

- 새 IPC 채널 중 **토큰을 반환하는 것은 없다.** 기존 `github:status` 가 `{ connected: boolean }` 만 주는 규약(`main.ts:5670`)을 그대로 따른다.
- 새 채널: `github:appStatus(projectId)` → `{ installed: boolean, repoAccessible: boolean }`. 그 이상 주지 않는다.
- 토큰은 **main 프로세스 안에서만** 산다: 발급 응답 → 로컬 변수 → git 자식 env → 함수 종료. 렌더러는 존재 자체를 모른다.

### B4. 로그

- 클라: clone 인자/env 를 통째로 로깅하지 않는다. `repo-clone.ts` 의 `redactToken()`/`summarizeStderr()` 는 유지하고, App 경로에도 같은 처리를 태운다.
- 서버: private key·JWT·발급 토큰 **금지**. 남기는 것은 `{uid, projectId, repoSlug, outcome, installationId}` 뿐. 값이 꼭 필요하면 `maskConfigForLogging`/`maskSensitiveValue`(`electron/config-redaction.ts`) 규약을 쓴다.
- 텔레메트리/버그리포트: `functions/src/redact.ts` 의 패턴에 **`ghs_`(installation 토큰 접두사)가 이미 포함**되어 있다(`redact.ts:30`). 이건 마지막 그물이지 1차 방어가 아니다 — B1 이 1차다.

### B5. 화면

`RepoConnectModal` 의 `fail("...errorMismatch", origin)` 처럼 git URL 원문을 그대로 렌더하는 지점이 있다. B1 이후 origin 은 깨끗하지만, **표시 경계에 `stripUrlCredentials()` 를 방어적으로 하나 둔다.** 싸고, 다음에 누가 다른 경로로 URL 을 화면에 태워도 막힌다.

### B6. 에이전트 PTY — 알려진 잔여 리스크

`bridge-server.ts` 는 이미 `MARBLO_BRIDGE_TOKEN` 을 **모든 스폰된 에이전트 env 에 넣는다**(`bridge-server.ts:1505`). 만약 나중에 git credential helper 를 브리지에 붙이면, 브리지 토큰을 가진 로컬 프로세스는 누구나 GitHub 토큰을 요청할 수 있게 된다.

- v1 판단: **credential helper 를 만들지 않는다.** App 토큰은 **clone 순간**에만 쓴다.
- 결과적 제약: clone 이후의 `git fetch`/`pull` 은 **멤버 본인 자격증명**(OS 키체인의 `gh auth`)으로 돌아간다. 본인 권한이 없는 멤버는 이후 fetch 가 안 된다 — §4.4 의 경계와 같은 이야기다.
- v2 에서 helper 를 만들 거라면 그 때 반드시 함께 정할 것: 호출 프로세스 신원 확인, repo 경로 바인딩, 요청마다 감사 기록. **§9 의 열린 질문 Q2.**

---

## 6. 기존 사용자 회귀 0 — 폴백이 아니라 1급 경로

### 6.1 폴백이라고 부르지 않는 이유

"폴백"은 A 를 시도하고 실패하면 B 로 간다는 뜻이고, 그러면 B 사용자는 매번 실패 한 번을 먹고 지나간다 — 느려지고, 로그가 더러워지고, 언젠가 "B 는 레거시니까 지우자"가 된다. 그래서 **분기 선택(capability-based routing)** 으로 만든다. 두 경로가 같은 타입을 만들어 **하나의 clone 구현**에 들어간다.

```ts
type CloneCredential =
  | { kind: "installation"; token: string }   // 서버 발급, 1시간, 저장 안 함
  | { kind: "device"; token: string }         // safeStorage, 기존 그대로
  | { kind: "none" };                         // public repo / ssh / 타 호스트

async function resolveCloneCredential(projectId, uid): Promise<CloneCredential> {
  if (project.githubInstallationId) {
    const t = await issueRepoInstallationToken(projectId).catch(() => null);
    if (t) return { kind: "installation", token: t };   // ── 1급 경로 A
  }
  const d = getGitHubToken(safeStorage, uid);
  if (d) return { kind: "device", token: d };           // ── 1급 경로 B (기본값, 영구)
  return { kind: "none" };
}
```

### 6.2 회귀 0 보장 — 항목별

| # | 보장 | 근거 |
| --- | --- | --- |
| G1 | **오늘 존재하는 모든 프로젝트는 100% 기존 경로.** | 어떤 프로젝트에도 `githubInstallationId` 가 없다. 첫 조건이 거짓이라 App 코드가 실행조차 되지 않는다. 배포 당일 동작은 **바이트 동일**. |
| G2 | **App 경로 장애가 기존 경로를 막지 않는다.** | 발급 실패(서버 5xx, 레이트리밋, 설치 삭제, 네트워크)는 전부 `catch → null` 로 흡수되고 device 분기로 내려온다. App→device 방향의 저하만 존재하고 그 역은 없다. |
| G3 | **개인 저장소·비 Marblo 저장소는 영구히 device 경로.** | installation 이 애초에 없다. 이 경로는 "옛 방식"이 아니라 이 사용 사례의 **정답**이다. |
| G4 | **IPC 계약 불변.** | `github:deviceStart` / `devicePoll` / `status` / `disconnect` 시그니처·반환형 그대로. 렌더러 수정 없이 기존 화면이 돈다. |
| G5 | **SSH·타 호스트 불변.** | `tokenizedGitHubCloneUrl` 이 이미 `https` + `github.com` 이 아니면 no-op(`repo-clone.ts:155-170`). App 경로도 같은 게이트를 쓴다. |
| G6 | **테스트 의무.** | 기존 `repo-clone` 테스트 전부 green 유지 + 매트릭스 신설: `[installation 유/무] × [device 토큰 유/무] × [서버 성공/실패]` 8케이스에서 선택된 `kind` 와 최종 git 인자를 단언. `GitRunner` 주입 지점이 이미 있어 네트워크 없이 검증된다. |

### 6.3 ★회귀로 오해될 수 있는 실제 동작 변화 — 명시

§5-B1(토큰을 URL 에 안 박기)을 **device 경로에도 적용하면**(결함 A 를 고치려면 그래야 한다) 관측 가능한 변화가 하나 생긴다:

> 지금은 `.git/config` 에 토큰이 박혀 있어서, 사용자가 **터미널에서** 치는 `git pull` 이 아무 설정 없이 그냥 된다. 토큰을 빼면 그게 안 된다.

Marblo 는 에이전트가 PTY 안에서 git 을 돌리는 제품이라 이건 무시할 수 없다. 처리:

- clone 직후 **`git credential approve`** 로 자격증명을 **OS 키체인**에 등록한다(`protocol=https / host=github.com / username=x-access-token / password=<device token>`). 지속성은 동일하고, 위치가 `.git/config` 평문에서 OS 키체인으로 옮겨간다.
- **installation 토큰은 이 처리를 하지 않는다.** 1시간짜리를 키체인에 넣으면 만료된 자격증명이 남아 더 헷갈린다. §5-B6 의 경계 그대로.
- 이 변경은 **App 과 독립적으로 선행 가능**하고, 그렇게 하는 게 낫다(§8 의 티켓 1).

---

## 7. 탈퇴 시나리오 — 접근이 실제로 끊기는 경로

계정 공유 대비 가장 큰 이점이므로 시간축으로 구체적으로 적는다.

### 7.1 멤버 M 이 프로젝트 P 에서 빠질 때

오너가 M 을 제거한다 → `removeMember()` → `projects/P.members: arrayRemove(uid)` (`src/services/projectService.ts:182-191`).

| 시점 | 무슨 일이 일어나나 | 강제하는 주체 |
| --- | --- | --- |
| **T+0 (즉시)** | Firestore 룰이 M 의 `projects/P` **읽기를 거부**한다. `firestore.rules:141-143` 이 `uid in members \|\| uid == ownerId` 를 요구한다. | Firestore 룰 |
| **T+0 (즉시)** | M 의 **새 토큰 발급 요청이 거부**된다. `issueRepoInstallationToken` 3번 검증(§3.2)이 Admin SDK 로 문서를 직접 읽어 판정한다. 캐시도 전파 지연도 없다. | Cloud Function |
| **T+0 (즉시)** | M 의 Marblo 클라이언트가 clone/재연결을 시도하면 `permission-denied` → device 분기로 내려감 → M 본인 GitHub 계정에 그 repo 권한이 없으므로 **404** → 기존 메시지 "저장소 접근 권한이 없습니다"(`repo-clone.ts:305`). | GitHub |
| **T+최대 60분** | M 이 메모리에 들고 있을 수 있는 마지막 installation 토큰이 **만료**된다. 갱신 불가, refresh 토큰 없음. **최악 노출 창 = 60분, 그 1개 저장소에 대한 읽기만.** | GitHub |
| **영구** | M 의 **개인 GitHub 계정에는 처음부터 그 저장소 권한이 없었다.** GitHub 쪽에 지울 잔여 부여가 없다. | 구조 |

**60분 창을 더 줄이려면 (for-cause 제거 · 계정 침해):** 개별 installation 토큰을 서버가 id 로 지목해 폐기하는 GitHub API 는 **없다**(`DELETE /installation/token` 은 그 토큰을 쥔 쪽만 호출 가능해서 우리에겐 쓸모가 없다). 대신 **break-glass**: 오너가 App 설치에서 해당 저장소를 빼거나 App 을 제거한다 → 그 installation 의 토큰이 **즉시** 그 저장소에 대해 무효가 된다. 부작용은 **같은 설치의 다른 멤버도 재설치 전까지 못 받는다**는 것 — 사고 대응용이지 일상 절차가 아니다. 이 트레이드오프를 런북에 적어 둔다.

### 7.2 왜 이게 계정 공유·수동 콜라보레이터보다 나은가

| | 계정 공유 (PAT/비번 돌려쓰기) | 콜라보레이터 수동 관리 (현재) | **App 자동상속** |
| --- | --- | --- | --- |
| 제거 동작 | 공유 자격증명 **회전 + 남은 전원에게 재배포** | GitHub 웹 → Settings → Collaborators → 저장소마다 삭제 | `members` 배열에서 uid 하나 제거 |
| 비용 | O(팀 인원) + 그 사이 전원 중단 | O(저장소 수), 전부 수동 | **O(1), 다른 사람 영향 0** |
| 잊어버릴 여지 | 회전 안 하면 영구 접근 | ★**가장 흔한 사고** — 퇴사자가 저장소 접근을 그대로 갖고 있는 상태 | **잊을 곳이 없다** — 프로젝트에서 빼는 행위가 곧 저장소 접근 제거다. 두 번째 장소가 존재하지 않는다 |
| 누가 무엇을 했나 | **불가능** — 전부 한 계정으로 보인다 | GitHub 감사로그(사람별) | GitHub 감사로그(사람별 push) + Marblo `audit_logs`(사람별 저장소 접근) |
| 약관 | **위반** | 준수 | 준수 |

### 7.3 정직하게 — 끊기지 않는 것

- **M 의 디스크에 이미 clone 된 소스는 남는다.** App 이든 콜라보레이터든 계정 공유든 동일하다. 로컬 사본 회수 수단은 없다. "App 을 쓰면 코드를 회수할 수 있다"는 기대를 만들지 않는다.
- **끊는 주체는 GitHub 이 아니라 Marblo 서버다.** 콜라보레이터 모델에서는 GitHub 이 직접 막지만, App 모델에서는 멤버십 판정을 **우리 코드**가 한다. 그래서 §3.2 의 검증 7단계가 보안 경계 그 자체다 — 여기 버그가 나면 그게 곧 무단 접근이다. 리뷰·테스트를 이 함수에 집중한다.
- 오너가 App 을 제거하거나 저장소를 이전하면 `githubInstallationId` 가 낡은 값이 된다 → 발급 실패 → **G2 로 device 경로로 내려간다**(크래시 없음). 오너에게 재설치를 안내하는 상태 표시가 필요하다.

---

## 8. org 개설(`5EeccZ5RbHXCMWaSR77E`)과의 선후 관계 — 판단

### 판단: **선행 아님. 독립이다.** 단, 실행 순서에는 조건이 붙는다.

GitHub App 은 **개인 계정에도 조직에도 설치된다.** 지금 `melocream/marblo`(개인 소유, private)에 그대로 설치할 수 있고, 이 설계의 어느 부분도 org 를 전제하지 않는다. **따라서 org 이전을 기다릴 이유가 없다.**

### 개인 계정 설치 시의 제약 (org 이면 사라지는 것)

| 제약 | 영향 |
| --- | --- |
| 설치 주체가 `melocream` 개인 | 버스팩터 그대로. 계정에 문제가 생기면 팀 전원의 저장소 접근이 끊긴다. |
| 설치 저장소 추가/변경이 개인 권한 | 새 저장소를 설치에 넣으려면 매번 그 사람이 해야 한다. 조직 오너 그룹이 없다. |
| 조직 감사로그 없음 | App 설치·권한 변경 이력이 조직 수준으로 남지 않는다. 개인 계정의 보안 로그는 훨씬 얇다. |
| App 설치 승인 정책 없음 | 조직이 제공하는 "어떤 App 을 설치할 수 있는가" 정책을 못 쓴다. |
| 팀 기반 저장소 권한 없음 | §4.4 의 "push 는 개별 권한 부여" 가 팀 단위로 묶이지 않아 계속 1:1 관리다. |

### ★두 티켓이 실제로 물리는 지점 (org 티켓에 반영 필요)

**저장소를 개인 계정 → org 로 이전하면, 개인 계정에 걸린 App 설치는 따라가지 않는다.** 이전된 저장소는 그 installation 범위에서 빠진다. 결과:

1. `projects/{id}.githubInstallationId` 가 **낡은 값**이 된다 → 멤버 clone 이 발급 실패 → device 경로로 내려감(§6 G2, 크래시는 없지만 **무마찰이 사라진다**).
2. 복구는 **org 에 App 재설치 + `githubInstallationId` 갱신** 두 단계. 설계 변경이 아니라 **데이터 마이그레이션 한 줄**이다.

### 그래서 권고하는 순서

1. **지금 착수해도 되는 것 (org 무관):** 발급 Cloud Function + 인가 검증 + 클라 분기 라우팅 + §5 토큰 경계 + 테스트. **설치 대상이 개인이든 org 이든 코드가 동일하다.** 이게 작업량의 대부분이다.
2. **실제 App 설치 시점만 org 결정과 맞춘다.** org 이전이 같은 사이클 안에 승인될 것 같으면 **개인 계정 설치를 건너뛰고 org 에 바로 설치**한다 — 설치 작업을 두 번 하고 데이터 마이그레이션까지 하는 걸 피할 수 있다. org 이전이 미정이거나 미뤄지면 개인 계정에 설치해도 아무 문제 없다. 나중 비용은 위의 2단계뿐이다.
3. **org 티켓 쪽에 추가할 항목:** "깨지는 것 전수" 목록에 **GitHub App 설치 + `projects.githubInstallationId`** 를 넣어야 한다. Actions 시크릿·webhook·`latest.yml` 과 같은 성격의, 리다이렉트가 자동으로 따라오지 않는 항목이다. → org 담당 에이전트에게 전달 필요.

---

## 9. 남은 작업 분해와 열린 질문

### 9.1 티켓 분해 제안 (이 설계의 후속)

| # | 내용 | App 의존 | 비고 |
| --- | --- | --- | --- |
| **1** | **결함 A/B 수정** — clone 토큰을 URL 에서 빼고 askpass + `git credential approve` 로 전환, `normalizeGitRemoteUrl`/표시 경계에 `stripUrlCredentials` | **없음 — 지금 살아 있는 결함** | ★App 보다 먼저 해도 된다. 오히려 이걸 먼저 하면 App 경로가 깨끗한 clone 구현을 그대로 재사용한다. |
| 2 | 발급 Cloud Function + 인가 7단계 + rateLimit + audit_logs + 단위테스트 | 코드는 무관, 실동작은 App 필요 | 에픽의 "백엔드 스켈레톤+인가 테스트는 App 없이 가능" 과 일치 |
| 3 | `firestore.rules` — `githubInstallationId` 클라 write 금지 | 없음 | §3.2 의 권한 상승 차단 |
| 4 | 설치 콜백(`githubAppSetupCallback`) + state nonce + 오너 검증 | 필요 | onRequest, 배포 주의(에픽의 반쪽함수 교훈) |
| 5 | 클라 분기 라우팅 + 매트릭스 테스트(G6) + `github:appStatus` | 없음(모킹) | 회귀 0 을 여기서 증명 |
| 6 | **App 생성·설치 (외부 계정 조작)** | — | ★승인 필요. §8 에 따라 org 결정과 시점을 맞춘다 |

### 9.2 열린 질문 (오케 판단 필요)

- **Q1 — §4.4 의 경계를 받아들이는가?** v1 은 "멤버가 clone/fetch 는 되지만 push 는 여전히 개별 권한 필요"다. 이걸로 온보딩 마찰이 충분히 줄어드는지, 아니면 `contents: write` + 봇 귀속 push 를 처음부터 감수할지는 제품 판단이다. 설계 권고는 **read 로 시작**이다.
- **Q2 — git credential helper (§5-B6) 를 v2 범위로 둘 것인가?** 있으면 fetch/pull 도 무마찰이 되고 **매 git 동작마다 멤버십을 재검증**해서 탈퇴 차단이 60분에서 "다음 fetch" 로 줄어든다. 대신 로컬 프로세스 신원 확인이라는 새 보안 표면이 생긴다.
- **Q3 — App 이름/슬러그와 GA 시 "Any account" 공개 시점.** 외부 노출 결정이라 사장님 판단.

---

## 부록 A. 실측 기록

| 확인 사항 | 방법 | 결과 |
| --- | --- | --- |
| `git clone` 이 URL 을 config 에 원문 기록하는가 | 로컬 bare repo 를 `file://` 로 clone 후 `.git/config` 확인 | **그렇다.** 인자 문자열 그대로 `remote.origin.url` 에 기록 |
| `normalizeGitRemoteUrl` 이 userinfo 를 벗기는가 | `node -e` 로 함수 재현, 토큰 URL vs 클린 URL 비교 | **아니다.** `oauth2:<token>@github.com/...` 가 정규화 결과에 그대로 남아 항상 mismatch |
| device OAuth 요청 scope | `github-device-oauth.ts:97` | `scope: "repo"` (저장소 전권) |
| 토큰 소비처 | `getGitHubToken` 호출부 grep | `main.ts:5672`(존재 확인), `main.ts:6629`(clone) — 실사용은 clone 하나 |
| 멤버십 진실원 | `firestore.rules:140-150`, `projectService.ts:182` | `projects.members[]` + `ownerId`, 제거는 `arrayRemove` |
| 프로젝트 문서 write 권한 | `firestore.rules:147-148` | `isProjectMember` — **멤버 누구나 전 필드 write 가능** |
| push/PR 경로 | `mcp-server/tools.ts` grep | `gh pr view/list/merge` — 에이전트 PTY 의 `gh`, 멤버 본인 계정 |
| 시크릿 로깅 방어 | `functions/src/redact.ts:30`, `electron/config-redaction.ts` | `ghs_` 포함 GH 토큰 패턴 존재(버그리포트 경로 한정), 마스킹 헬퍼 존재 |
| 에이전트 env 에 브리지 토큰 | `bridge-server.ts:1505` | `MARBLO_BRIDGE_TOKEN` 이 모든 스폰 에이전트 env 에 들어감 |
