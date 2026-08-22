# GitHub App 등록에 필요한 값 + 라이브 검증 런북

- 날짜: 2026-08-21
- 티켓: `ddbN2KvxHZ08rakiVfL0` (구현) / 설계 `Dqw3dD9iA7yttsVzOjvB`(PR #1092) / org `5EeccZ5RbHXCMWaSR77E`
- 상태: **코드·설정·문서 완료. App 은 만들지도 설치하지도 않았다.**
- 설계 원문: `v3/docs/github-app-installation-inheritance-design-2026-08-21.md` — 이 문서는 그 설계를 **재론하지 않고**, 등록에 실제로 입력할 값과 등록 후 검증 절차만 적는다.

> ★이 App 은 **마블로 사용자들의 팀을 위한 제품 기능**이다. 마블로 자체 저장소 관리용이 아니다. 마블로를 쓰는 팀의 오너가 1회 설치하면, 그 팀 멤버가 GitHub 개별 초대 없이 저장소를 clone 할 수 있다.

---

## 1. 등록 화면에 그대로 넣을 값

GitHub → Settings → Developer settings → **GitHub Apps** → New GitHub App

| 항목                   | 값                                                                                                   | 비고                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub App name**    | `Marblo` (선점돼 있으면 `Marblo Repo Access`)                                                        | 전역 유일. 여기서 정해지는 **slug** 가 설치 URL 이 된다(`github.com/apps/<slug>`). 정해지면 `GITHUB_APP_SLUG` 로 넣는다.                                                                        |
| **Description**        | `Marblo 팀 멤버가 GitHub 개별 초대 없이 프로젝트 저장소를 clone 할 수 있게 합니다. 읽기 전용입니다.` | 오너가 설치 화면에서 읽는 문장.                                                                                                                                                                 |
| **Homepage URL**       | `https://marblo.app`                                                                                 |                                                                                                                                                                                                 |
| **Callback URL**       | **비움**                                                                                             | ★*Request user authorization (OAuth) during installation* 을 끄므로 필요 없다. App 이 사용자 신원을 발급하게 되는 순간 "그럼 device OAuth 는 왜 있냐" 가 되고 그 다음이 계정 공유다(설계 §2-1). |
| **Setup URL**          | `https://us-central1-marblo-2253d.cloudfunctions.net/githubAppSetupCallback`                         | ★필수. 설치 직후 GitHub 이 `?installation_id=&setup_action=install&state=` 로 리다이렉트한다.                                                                                                   |
| **Redirect on update** | **체크**                                                                                             | 오너가 설치 저장소를 바꿨을 때도 같은 콜백으로 와서 바인딩이 갱신된다.                                                                                                                          |
| **Webhook → Active**   | **끔 (URL 없음)**                                                                                    | v1 에 소비할 이벤트가 0 이다. 안 받는 이벤트는 지킬 필요도 없다.                                                                                                                                |
| **Webhook secret**     | 해당 없음                                                                                            | Webhook 을 끄므로.                                                                                                                                                                              |

### 1.1 Permissions — ★이 둘만

| 범주       | 권한         | 수준                                   |
| ---------- | ------------ | -------------------------------------- |
| Repository | **Contents** | **Read-only**                          |
| Repository | **Metadata** | **Read-only** (GitHub 강제, 해제 불가) |

**그 외 전부 `No access` 로 둔다.** 특히:

- **Contents: Write 를 주지 않는다.** 확정된 결정이다 — 모든 push 가 `marblo[bot]` 으로 뭉개져 감사 추적이 죽고, 서버 침해 시 폭발 반경이 "읽기"에서 "고객 코드 변조"로 뛴다.
- **Administration 은 영구 거부 후보.** 받는 순간 App 침해 = 고객 저장소 삭제 가능.
- **Organization → Members: Read 를 받지 않는다.** 멤버십 진실원은 Firestore 지 GitHub 이 아니다. 받으면 고객 조직의 전체 인원 명부가 들어온다 — 필요 없는 PII.

### 1.2 Subscribe to events

**아무것도 체크하지 않는다.** (Webhook 이 꺼져 있으므로 선택 자체가 불가능하다.)

### 1.3 Where can this GitHub App be installed?

| 시점           | 값                                                              |
| -------------- | --------------------------------------------------------------- |
| v1 (검증)      | **Only on this account**                                        |
| GA (고객 공개) | **Any account** — ★외부 노출 결정이라 사장님 판단(설계 §9.2 Q3) |

### 1.4 등록 직후 GitHub 이 주는 것 — 받아 적어야 할 값

| GitHub 화면의 이름                                 | 우리 env 이름            | 성격                          |
| -------------------------------------------------- | ------------------------ | ----------------------------- |
| **App ID** (숫자)                                  | `GITHUB_APP_ID`          | 비밀 아님. 숫자만.            |
| **Public link** 의 slug (`github.com/apps/<여기>`) | `GITHUB_APP_SLUG`        | 비밀 아님.                    |
| **Generate a private key** → 내려받는 `.pem`       | `GITHUB_APP_PRIVATE_KEY` | ★**최고 등급 비밀**. §2 참조. |

---

## 2. 서버 환경변수 (Cloud Functions 전용)

`firebase functions:secrets` / 배포 환경변수에 넣는다. **저장소·Firestore·로그·Sentry 어디에도 두지 않는다.**

| 키                              | 값                                                                                                               | 없으면                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `GITHUB_APP_ID`                 | 등록 후 App ID                                                                                                   | 기능 전체가 잠들어 있다(아래 참조) |
| `GITHUB_APP_SLUG`               | 등록 후 slug                                                                                                     | 설치 시작 버튼만 막힌다            |
| `GITHUB_APP_PRIVATE_KEY`        | `.pem` **원문**. 한 줄로 넣어야 하면 개행을 `\n` 으로 이스케이프 — 서버가 `normalizePrivateKeyPem` 으로 되돌린다 | 기능 전체가 잠들어 있다            |
| `GITHUB_APP_SETUP_STATE_SECRET` | 새로 만든 고엔트로피 문자열(예: `openssl rand -base64 48`)                                                       | 기능 전체가 잠들어 있다            |

### ★미설정이 곧 "이 기능이 아직 없음" 이다 — 배포를 막지 않는다

`githubAppConfigured()` 가 거짓이면 콜러블이 `failed-precondition` 을 던지고, 클라이언트는 **device 경로로 그대로 간다.** 그래서 이 4개 키를 `check-deploy-env.mjs` 의 **필수 목록에 넣지 않았다** — 등록 전에 배포를 막을 이유가 없고, 조용한 열화가 아니라 "기능이 아직 켜지지 않음" 이라는 설계된 정상 상태이기 때문이다.

### private key 회전 절차

새 private key 생성 → 시크릿 갱신 → **배포 확인 후** 구 key 폐기. (구 key 를 먼저 지우면 발급이 끊긴다.)

---

## 3. 오너가 설치할 때 지켜야 하는 것

설치 화면에서 **"Only select repositories"** 를 고르고 그 프로젝트 저장소만 선택한다. "All repositories" 는 오너가 무심코 조직 전체를 넘기게 만든다.

발급되는 토큰은 설치에 저장소가 5개여도 **요청한 1개**만 연다(`repositories: [repo]` + `permissions.contents=read` 다운스코프). 응답이 그보다 넓게 오면 서버가 **그 토큰을 쓰지 않고 버린다**(`verifyMintedToken`).

---

## 4. 등록 시점을 org 결정과 맞출 것 (설계 §8)

**저장소를 개인 계정 → org 로 이전하면, 개인 계정에 걸린 App 설치는 따라가지 않는다.**

- org 이전이 같은 사이클 안에 승인될 것 같으면 → **개인 계정 설치를 건너뛰고 org 에 바로 설치**한다. 설치를 두 번 하고 데이터 마이그레이션까지 하는 걸 피할 수 있다.
- org 이전이 미정·연기면 → 개인 계정에 설치해도 문제없다. 나중 비용은 "org 에 재설치 + `githubInstallationId` 갱신" 두 단계뿐이다.
- 이전 후 갱신 전 구간의 동작: 발급이 404 로 끊기고 **device 경로로 내려간다**. 크래시는 없고 무마찰만 사라진다.

---

## 5. 등록 후 라이브 검증 런북

> ★이 티켓은 App 을 만들지 않았으므로 아래는 **실행되지 않았다.** 코드 경로는 전부 단위테스트로 증명돼 있고(§6), 아래는 실제 GitHub 을 상대로 한 번 확인하는 절차다.

### 5-1. 무마찰 clone (완료기준 1)

1. 오너 계정으로 App 을 테스트 저장소(private)에 설치한다.
2. Marblo 에서 그 프로젝트의 **[GitHub App 설치]** → 브라우저 설치 → 콜백 성공 화면.
3. Firestore `projects/{id}.githubInstallationId` 가 채워졌는지 확인(값은 숫자 문자열).
4. **그 저장소의 콜라보레이터가 아닌** 팀 멤버 계정으로 Marblo 에서 [Clone & 연결].
5. 기대: clone 성공. 그 멤버는 GitHub 에서 개별 초대를 받은 적이 없다.

### 5-2. 기존 사용자 회귀 0 (완료기준 2)

1. `githubInstallationId` 가 없는 프로젝트에서 [Clone & 연결] → 종전대로 성공.
2. 개인 저장소·SSH 주소·GitHub 아닌 호스트 → 종전대로 동작.
3. 로그에 App 관련 실패 줄이 **없어야 한다** — installation 이 없으면 서버를 부르지도 않는다.

### 5-3. ★탈퇴 차단 (완료기준 3) — 두 가지를 각각 본다

**(a) 멤버 제거**

1. 5-1 의 멤버를 프로젝트에서 제거한다.
2. 즉시 그 멤버 계정으로 [Clone & 연결] 재시도 → **실패**해야 한다.
3. `github_app_access_logs` 에 `outcome: "denied", reason: "not-a-member"` 가 남는지 확인.
4. 이미 그 멤버가 받은 토큰의 잔여 노출은 **최대 60분, 그 저장소 읽기 한정**이다. 갱신·refresh 경로가 없다(발급 응답에 refresh 토큰이 존재하지 않는다).

**(b) 오너의 App 제거 — 계정 공유 대비 가장 큰 이점**

1. 오너가 GitHub → Settings → Applications → Installed GitHub Apps → **Uninstall** (또는 설치에서 그 저장소만 제거).
2. 멤버가 [Clone & 연결] 재시도 → **실패**해야 한다.
3. `github_app_access_logs` 에 `reason: "repo-installation-404"`.
4. `github:appStatus` 가 `{installed: true, repoAccessible: false}` 를 돌려주는지 확인 — 화면이 오너에게 재설치를 안내할 근거다.
5. ★부작용을 알고 쓴다: 같은 설치의 **다른 멤버도** 재설치 전까지 못 받는다. 사고 대응용이지 일상 절차가 아니다.

**(c) 정직하게 — 끊기지 않는 것**

이미 로컬 디스크에 clone 된 소스는 남는다. App 이든 콜라보레이터든 계정 공유든 동일하다. "App 을 쓰면 코드를 회수할 수 있다" 는 기대를 만들지 않는다.

### 5-4. 토큰 경계 (완료기준 4)

1. clone 성공 후 그 폴더에서 `git remote get-url origin` → **토큰이 없는 깨끗한 URL**.
2. `grep -r ghs_ .git/config` → 아무것도 안 나와야 한다.
3. Cloud Functions 로그에 `ghs_` / PEM / JWT 가 없어야 한다.
4. Firestore `projects/{id}.gitRemoteUrl` 에 자격증명이 없어야 한다.

### 5-5. 크로스테넌트 (설계 §3.2 7번)

1. 프로젝트 A 의 멤버가 A 의 `gitRemoteUrl` 을 **B 팀의 저장소**로 바꾼다(룰상 가능하다).
2. [Clone & 연결] → **실패**해야 한다. `reason: "installation-mismatch"`.

---

## 6. 지금 이미 증명돼 있는 것 (App 없이)

| 무엇                                                                                                  | 어디                                         |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 인가 순서(멤버십 → 엔타이틀먼트 → 설치 → 슬러그)와 거부 코드                                          | `functions/src/githubApp.test.ts`            |
| ★멤버 제거 시 T+0 발급 거부                                                                           | 같은 파일, "탈퇴 차단"                       |
| ★App 제거(404) / 저장소 org 이전(id 불일치) / App JWT 사망(401·403) / 경합(발급단계 404) 시 접근 차단 | 같은 파일, "접근 차단이 실제로 동작하는가"   |
| 요청보다 넓은 토큰이 오면 버린다                                                                      | 같은 파일, `verifyMintedToken`               |
| state nonce 위조·만료 차단                                                                            | 같은 파일                                    |
| ★회귀 0 매트릭스 8케이스 + 설치 없을 때 **네트워크 0**                                                | `tests/unit/github-clone-credential.test.ts` |
| ★installation 토큰이 argv·`.git/config`·에러 메시지에 안 실린다                                       | 같은 파일                                    |
| `githubInstallationId` 클라 write 금지 (create 우회 포함)                                             | `firestore.rules.test.ts` (#1096 에서 도입)  |
| ★멤버 제거 시 T+0 프로젝트 문서 read 거부                                                             | `firestore.rules.test.ts`                    |
| 서버 전용 컬렉션 전면 거부                                                                            | `firestore.rules.test.ts`                    |

실행:

```
cd v3/functions && npm run test:github-app          # 39 tests
cd v3 && npx vitest run tests/unit/github-clone-credential.test.ts tests/unit/repo-clone.test.ts
cd v3 && npm run test:rules                          # 에뮬레이터 필요(JDK 11+)
```

---

## 7. v1 이 하지 않는 것 (알고 남긴 경계)

- **push 는 여전히 개별 권한이 필요하다.** contents:read 만 받기 때문이다. 리뷰어·PM·읽기 위주 에이전트는 이걸로 충분하고, 대다수 멤버가 거기 해당한다.
- **clone 이후의 `git fetch`/`pull` 은 멤버 본인 자격증명**(OS 키체인의 `gh auth`)으로 돌아간다. App 토큰은 clone 순간에만 쓴다.
- **git credential helper 를 만들지 않았다.** `bridge-server.ts:1505` 가 `MARBLO_BRIDGE_TOKEN` 을 모든 에이전트 env 에 넣고 있어, helper 를 붙이면 그 토큰을 가진 로컬 프로세스 누구나 GitHub 토큰을 요청할 수 있게 된다. 새 보안 표면을 이번에 만들지 않는다(설계 §9.2 Q2 = v2).
