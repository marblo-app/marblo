# GitHub App 등록에 필요한 값 + 라이브 검증 런북

- 날짜: 2026-08-21
- 티켓: `ddbN2KvxHZ08rakiVfL0` (v1 구현, PR #1101) / `FYIyUuhJbv2cDVjgkRGf` (v2 write) / 설계 `Dqw3dD9iA7yttsVzOjvB`(PR #1092) / org `5EeccZ5RbHXCMWaSR77E`
- 상태: **코드·설정·문서 완료. App 은 만들지도 설치하지도 않았고, 권한도 바꾸지 않았다.**
- 설계 원문: `v3/docs/github-app-installation-inheritance-design-2026-08-21.md` — 이 문서는 그 설계를 **재론하지 않고**, 등록에 실제로 입력할 값과 등록 후 검증 절차만 적는다.

> ★이 App 은 **마블로 사용자들의 팀을 위한 제품 기능**이다. 마블로 자체 저장소 관리용이 아니다. 마블로를 쓰는 팀의 오너가 1회 설치하면, 그 팀 멤버가 GitHub 개별 초대 없이 저장소를 clone 하고(v1) **push·PR 까지 한다(v2)**.

> ★**v2 갱신 안내.** 이 문서는 v1(read-only) 기준으로 쓰였고 v2 에서 권한 결정이 바뀌었다. 바뀐 절은 §1.1 과 §7 이며, v2 가 추가로 필요로 하는 값은 §8 에 모아 뒀다. **v1 로 이미 등록·설치했더라도 버릴 것은 없다** — §8 은 "새로 만들기" 가 아니라 "권한 한 칸 올리고 재승인" 이다.

---

## 1. 등록 화면에 그대로 넣을 값

GitHub → Settings → Developer settings → **GitHub Apps** → New GitHub App

| 항목                   | 값                                                                                                   | 비고                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub App name**    | `Marblo` (선점돼 있으면 `Marblo Repo Access`)                                                        | 전역 유일. 여기서 정해지는 **slug** 가 설치 URL 이 된다(`github.com/apps/<slug>`). 정해지면 `GITHUB_APP_SLUG` 로 넣는다.                                                                        |
| **Description**        | ★v2: `Marblo 팀 멤버가 GitHub 개별 초대 없이 프로젝트 저장소를 받고(clone·pull) 브랜치를 올려 PR 을 보낼 수 있게 합니다. 접근 권한은 Marblo 프로젝트 역할을 따릅니다.` | 오너가 설치 화면에서 읽는 문장. ★v1 문구("읽기 전용입니다")는 **더 이상 사실이 아니다** — 반드시 갱신할 것. 오너가 write 를 승인하는 화면에서 읽는 유일한 설명이다.                                                            |
| **Homepage URL**       | `https://marblo.app`                                                                                 |                                                                                                                                                                                                 |
| **Callback URL**       | **비움**                                                                                             | ★*Request user authorization (OAuth) during installation* 을 끄므로 필요 없다. App 이 사용자 신원을 발급하게 되는 순간 "그럼 device OAuth 는 왜 있냐" 가 되고 그 다음이 계정 공유다(설계 §2-1). |
| **Setup URL**          | `https://us-central1-marblo-2253d.cloudfunctions.net/githubAppSetupCallback`                         | ★필수. 설치 직후 GitHub 이 `?installation_id=&setup_action=install&state=` 로 리다이렉트한다.                                                                                                   |
| **Redirect on update** | **체크**                                                                                             | 오너가 설치 저장소를 바꿨을 때도 같은 콜백으로 와서 바인딩이 갱신된다.                                                                                                                          |
| **Webhook → Active**   | **끔 (URL 없음)**                                                                                    | v1 에 소비할 이벤트가 0 이다. 안 받는 이벤트는 지킬 필요도 없다.                                                                                                                                |
| **Webhook secret**     | 해당 없음                                                                                            | Webhook 을 끄므로.                                                                                                                                                                              |

### 1.1 Permissions — ★v2 기준 (이 셋만)

| 범주       | 권한              | v1 (구)       | **v2 (현행)**                          |
| ---------- | ----------------- | ------------- | -------------------------------------- |
| Repository | **Contents**      | Read-only     | ★**Read and write**                    |
| Repository | **Pull requests** | (No access)   | ★**Read and write**                    |
| Repository | **Metadata**      | Read-only     | Read-only (GitHub 강제, 해제 불가)     |

**그 외 전부 `No access` 로 둔다.**

#### ★v1 의 "Contents: Write 를 주지 않는다 — 확정된 결정" 은 **폐기됐다**

v1 문서(이 자리)에 이렇게 적혀 있었다:

> ~~**Contents: Write 를 주지 않는다.** 확정된 결정이다 — 모든 push 가 `marblo[bot]` 으로 뭉개져 감사 추적이 죽고, 서버 침해 시 폭발 반경이 "읽기"에서 "고객 코드 변조"로 뛴다.~~

**앞부분(감사 추적)은 과장이었다.** App 토큰으로 밀 때 실제로 잃는 것과 잃지 않는 것:

| | App 토큰으로 push |
| --- | --- |
| **커밋 작성자** | ✅ **그 사람 그대로.** git author 이메일을 GitHub 이 계정에 매칭한다 — 누가 밀었는지와 무관하다. `electron/github-commit-identity.ts` 가 그 이메일을 박는다. |
| push 이벤트 | ❌ `marblo[bot]` 으로 기록 |
| PR 작성자 | ❌ `marblo[bot]` 으로 기록 |

즉 **"누가 이 코드를 썼나" 는 안 사라진다.** 사라지는 건 "누가 밀었나"·"누가 PR 을 열었나" 뿐이고, 그 둘은 **우리 감사 원장이 답한다** — `github_app_access_logs` 에 v2 부터 `{role, access, branch}` 가 함께 남는다(`buildAuditEntry`). 그리고 마블로 보드는 누가 무슨 티켓을 했는지 이미 기록한다.

**뒷부분(폭발 반경)은 여전히 유효하다.** 서버가 침해되면 피해가 "읽기" 에서 "고객 코드 변조" 로 뛴다. 그건 없애는 게 아니라 **감수하고 방어를 두껍게** 한 것이다:

1. **다운스코프 유지** — `repositories: [그 repo 하나]`. write 가 붙어도 설치에 저장소가 몇 개든 **요청한 1개**만 열린다.
2. **역할 게이트** — 권한의 진실원이 GitHub 이 아니라 마블로다. `viewer` 는 write 토큰을 **영원히** 못 받는다(`role-cannot-write`). 판정은 `memberRoles` 컬렉션 = 기존 역할 모델(`DbAZ5C6gbO6nWNx9FZ4Q`) 그대로이고, 새 권한 개념을 만들지 않았다.
3. **기본 브랜치 게이트** — `member` 는 기본 브랜치에 직접 못 민다. 화면의 Merge 버튼이 owner/admin 전용인 것과 **같은 선**이다(§7 의 한계도 함께 읽을 것).
4. **재승인 협상** — 설치가 승인한 권한을 먼저 확인하고 그만큼만 요청한다. 승인 전에는 v1(read)로 동작한다(회귀 0).
5. **발급 응답 재검증** — 요청보다 넓은 토큰이 오면 **쓰지 않고 버린다**(`verifyMintedToken`). read 요청에 write 가 와도 버린다.

#### 여전히 받지 않는 것

- **Administration 은 영구 거부 후보.** 받는 순간 App 침해 = 고객 저장소 삭제 가능. ★브랜치 보호 규칙을 **우리가** 걸어 주려면 이 권한이 필요한데, 그 대가가 너무 크다 — 대신 오너에게 §8-3 으로 권고한다.
- **Organization → Members: Read 를 받지 않는다.** 멤버십 진실원은 Firestore 지 GitHub 이 아니다. 받으면 고객 조직의 전체 인원 명부가 들어온다 — 필요 없는 PII.
- **`repo` 전권(구 OAuth 스코프)으로 되돌아가지 않는다.** v1 이 정확히 그걸 피하려고 만들어졌다.

#### `Pull requests: Write` 를 함께 받는 이유

브랜치만 밀고 PR 은 브라우저에서 열라고 하면 "PR 까지 간다" 가 아니다. 그리고 이 권한은 **코드를 바꾸지 못한다** — Contents 와 달리 폭발 반경이 늘지 않는 쪽의 최소 추가다.

★이걸 빼고 Contents 만 올려도 **push 는 그대로 동작한다.** 서버가 설치에 승인된 권한만 요청하기 때문이다(`negotiateInstallationAccess`: `pull_requests` 가 없으면 그것만 빼고 write 로 간다). 사장님이 원치 않으시면 이 칸은 `No access` 로 두셔도 회귀가 없다.

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

발급되는 토큰은 설치에 저장소가 5개여도 **요청한 1개**만 연다(`repositories: [repo]` + 협상된 `permissions` 다운스코프). 응답이 그보다 넓게 오면 서버가 **그 토큰을 쓰지 않고 버린다**(`verifyMintedToken`).

★v2 에서도 이건 그대로다. **write 가 붙어도 저장소 하나로만.** 그리고 clone(read) 요청은 설치가 write 를 승인했어도 여전히 `contents: read` 토큰만 받는다 — 다운스코프가 한 방향으로만 샌다.

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
cd v3/functions && npm run test:github-app          # 78 tests (v1 39 → v2 +39)
cd v3 && npx vitest run tests/unit/github-clone-credential.test.ts \
                       tests/unit/repo-clone.test.ts \
                       tests/unit/github-push-credential.test.ts   # 77 tests
cd v3 && npm run test:rules                          # 283 tests, 에뮬레이터 필요(JDK 11+)
```

### 6.1 v2 가 추가로 증명하는 것 (App 없이)

| 무엇 | 어디 |
| ---- | ---- |
| 역할 모델이 `ROLE_PERMISSIONS`/`canMergeAsRole` 과 같은 집합이다 (MIRROR drift 검출) | `githubApp.test.ts` "v2 역할 모델" |
| ★viewer 는 write 를 못 받고, 같은 사람의 clone 은 그대로 된다 | 같은 파일 "★viewer 는 write 를 거부당한다" |
| ★역할 회수 T+0 (강등·제거 둘 다) | 같은 파일 "★역할 회수" / "★멤버 제거" |
| ★member 의 기본 브랜치 push 거부 = 화면 Merge 게이트와 같은 선 | 같은 파일 "★member 는 기본 브랜치에 직접 밀 수 없다" |
| ★기본 브랜치를 모르면 통과시키지 않는다 | 같은 파일 "★기본 브랜치를 모르면…" |
| ★재승인 전 write→read 강등(회귀 0), 재승인 후 write | 같은 파일 "★오너 재승인 전" / "재승인 후" |
| ★read 요청에 write 토큰이 오면 버린다 (다운스코프 단방향) | 같은 파일 "★read 요청에 write 토큰이…" |
| ★발급 토큰 수명 60분 실측 + 캐시 없음 | 같은 파일 "★실측" |
| ★App 설치 없으면 push 경로도 **네트워크 0** | `tests/unit/github-push-credential.test.ts` |
| ★역할 거부가 device 로 **폴백하지 않는다** | 같은 파일 "★역할 거부는 device 로 폴백하지 않는다" |
| ★비공개 이메일 사용자도 귀속된다 (id 붙은 noreply) | 같은 파일 "커밋 귀속 이메일 선택" |
| ★`--global` 을 절대 안 건드린다 | 같은 파일 "applyCommitIdentity" |
| ★토큰이 argv·에러 메시지·URL 에 안 실린다 (push 판) | 같은 파일 "pushBranch" |
| ★보호 브랜치 거절을 "pull 하세요" 로 오안내하지 않는다 | 같은 파일 "classifyPushError" |

---

## 7. 알고 남긴 경계 (v2 기준)

### 7.1 v2 가 해결한 것 (v1 의 경계였던 것)

- ~~**push 는 여전히 개별 권한이 필요하다.**~~ → v2 가 `contents: write` 로 해결했다. 마블로 역할이 `member` 이상이면 GitHub 개별 초대 없이 브랜치를 밀고 PR 을 연다.

### 7.2 ★v2 도 해결하지 못하는 것 — 여기를 정직하게 읽을 것

**(a) 기본 브랜치 게이트는 암호학적 경계가 아니다.**

GitHub installation 토큰에는 **브랜치 스코프가 없다.** `contents: write` 는 "어느 브랜치든 밀 수 있다" 는 뜻이다. 우리 게이트(`evaluatePushRef`)는 토큰을 **발급하기 전에** "어느 ref 로 밀 건가" 를 받아 판정하지만, 일단 손에 들어간 토큰은 그 선언과 다른 브랜치로도 쓸 수 있다.

- **막는 것**: 마블로를 통한 경로 전부. 화면의 Merge 버튼과 같은 선이고, 앱을 쓰는 한 모순이 없다.
- **못 막는 것**: `member` 가 우리 앱을 우회해 그 토큰으로 직접 `git push origin main` 하는 것.
- ★**진짜 강제 수단은 저장소의 브랜치 보호 규칙(ruleset)뿐이다.** 그건 App 권한이 아니라 저장소 설정이라 GitHub 이 App 토큰에도 똑같이 적용한다. 우리가 대신 걸어 주려면 `Administration: write` 가 필요한데 그 대가(App 침해 = 고객 저장소 삭제)가 너무 크다. 그래서 **오너에게 권고**한다(§8-3).
- 참고: 우리 push 경로는 그 거절(GH006)을 `protected-branch` 로 분류해 "PR 로 보내세요" 라고 안내한다 — "pull 하세요" 같은 틀린 안내를 하지 않는다.

**(b) 역할 회수의 잔여 창 = 최대 60분.** §9 에 실측치와 근거를 따로 적었다.

**(c) 팀원이 그 저장소의 GitHub 콜라보레이터이기도 하면 device 토큰으로 민다.** 그건 GitHub 이 직접 준 권한이고 마블로가 만든 것도, 회수할 수 있는 것도 아니다. 마블로 역할 게이트가 지배하는 것은 **App 경로**다. (App 경로에서 역할 거부가 나면 우리는 device 로 **폴백하지 않는다** — 폴백하면 우리 손으로 게이트를 뚫는 것이다.)

**(d) 이미 clone 된 소스는 회수되지 않는다.** v1 §5-3(c) 그대로. App 이든 콜라보레이터든 계정 공유든 동일하다.

**(e) 커밋 귀속에는 GitHub 신원 연결이 1회 필요하다.** App 토큰은 저장소 권한이지 신원이 아니라서, GitHub 을 한 번도 연결하지 않은 멤버는 귀속시킬 이메일이 없다. 그 경우 우리는 **아무것도 박지 않는다** — 마블로 계정 이메일로 추측해서 박으면 매칭이 안 돼 귀속이 **조용히** 깨진다. device OAuth 로그인 1회는 저장소 초대가 아니고, v1 부터 이미 있던 경로다.

### 7.3 여전히 하지 않는 것

- **clone 이후의 `git fetch`/`pull` 은 멤버 본인 자격증명**(OS 키체인의 `gh auth`)으로 돌아간다. App 토큰은 clone·push 순간에만 쓴다.
- **git credential helper 를 만들지 않았다.** `bridge-server.ts:1505` 가 `MARBLO_BRIDGE_TOKEN` 을 모든 에이전트 env 에 넣고 있어, helper 를 붙이면 그 토큰을 가진 로컬 프로세스 누구나 GitHub 토큰을 요청할 수 있게 된다. ★**v2 에서 이건 더 위험해졌다** — 그 토큰이 이제 write 다. 새 보안 표면을 이번에도 만들지 않는다(설계 §9.2 Q2).

---

## 8. ★v2 권한 변경 — 사장님이 하실 것 (코드는 건드리지 않았다)

> ★이 티켓은 **App 을 만들지도, 권한을 바꾸지도 않았다.** 외부 계정을 건드리는 되돌리기 어려운 동작이라 값만 정리하고 멈췄다.

### 8-1. GitHub App 설정에서 바꿀 값 (2곳)

App → Settings → **Permissions & events**:

| # | 항목 | 지금(v1) | 바꿀 값 | 필수? |
| - | ---- | -------- | ------- | ----- |
| 1 | Repository → **Contents** | Read-only | **Read and write** | ★필수 (이게 없으면 v2 전체가 v1 로 동작) |
| 2 | Repository → **Pull requests** | No access | **Read and write** | 선택 (없어도 push 는 됨, §1.1 마지막 참조) |

App → Settings → **General**:

| # | 항목 | 바꿀 값 | 필수? |
| - | ---- | ------- | ----- |
| 3 | **Description** | §1 표의 v2 문구로 교체 | ★필수 — 오너가 write 를 승인하는 화면에서 읽는 유일한 설명이 "읽기 전용입니다" 면 안 된다 |

**바꾸지 않는 것**: App ID, slug, private key, Setup URL, Webhook(끈 상태 유지), 그 외 모든 권한(`No access` 유지).

### 8-2. 서버 환경변수 — ★추가·변경 없음

`GITHUB_APP_ID` / `GITHUB_APP_SLUG` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_APP_SETUP_STATE_SECRET` **네 개 그대로다.** v2 는 새 시크릿을 도입하지 않았다. 권한은 env 가 아니라 발급 요청 본문에서 협상된다.

### 8-3. ★오너에게 권고할 저장소 설정 (App 설정 아님)

기본 브랜치에 **브랜치 보호 규칙**을 건다(Settings → Branches / Rules → Rulesets):

- `Require a pull request before merging` 체크.
- 이게 §7.2(a) 의 "못 막는 것" 을 GitHub 수준에서 실제로 막는 **유일한** 방법이다. App 토큰에도 똑같이 적용된다.
- 우리가 대신 걸어 주지 않는 이유: `Administration: write` 가 필요하고, 그 권한의 대가가 브랜치 보호로 얻는 것보다 크다.

### 8-4. ★권한을 올린 뒤 일어나는 일 (재승인)

권한을 올리면 GitHub 이 **기존 설치처 오너 전원에게 재승인을 요구**한다. 오너가 승인하기 전까지 그 설치는 **옛 권한(contents:read)** 그대로다.

우리 코드는 그 구간을 이렇게 다룬다 — **회귀 0**:

1. 발급 전에 `GET /repos/{o}/{r}/installation` 의 `permissions` 를 읽는다.
2. `contents !== "write"` 면 **write 를 요청하지 않고** read 로 깎아 발급한다(`negotiateInstallationAccess` → `downgraded: true`).
   - ★깎지 않고 그냥 요청하면 GitHub 이 **422** 로 발급 자체를 거절해 **clone 까지 같이 죽는다.** 그래서 요청 전에 깎는다.
3. 클라이언트는 `downgraded` 를 받으면 push 를 App 경로로 시도하지 않고 **device 경로**로 간다 = v2 이전과 똑같은 동작.
4. `getGitHubAppStatus` 가 `{canWrite: true, writeGranted: false}` 를 돌려주므로, 화면이 오너에게 **"재승인이 필요합니다"** 를 안내할 수 있다.

★즉 **권한을 올리는 순간부터 오너가 승인하는 순간까지, 아무도 아무것도 잃지 않는다.**

---

## 9. ★역할 회수 창(window) — 실측과 근거

> 마블로가 권한의 진실원이면, 오너가 보드에서 역할을 빼는 순간 push 가 끊겨야 한다. 그게 "GitHub 초대를 안 쓴다" 의 대가다. **얼마나 빨리 끊기나.**

### 9-1. 새 작업은 T+0 에 끊긴다

역할 판정은 **매 발급 요청마다** `memberRoles` 를 새로 읽어서 한다. 캐시도 메모이즈도 없다.

| 회수 동작 | 다음 push 시도 | 감사 원장에 남는 것 |
| --------- | -------------- | ------------------- |
| `member` → `viewer` 강등 | ★즉시 거부 | `denied / role-cannot-write` |
| 프로젝트 멤버에서 제거 | ★즉시 거부 (clone 도) | `denied / not-a-member` |
| 오너가 App 제거 | ★즉시 거부 | `denied / repo-installation-404` |
| 오너의 플랜 만료 | ★즉시 거부 | `denied / no-team-entitlement` |

증거: `functions/src/githubApp.test.ts` — "★역할 회수: member → viewer 로 강등되면 다음 발급에서 즉시 write 거부", "★멤버 제거: members 에서 빠지면 read 조차 T+0 에 거부", "★역할 판정에 캐시가 없다".

### 9-2. 이미 발급된 토큰은 **최대 60분** 산다

측정한 것 셋 — 이 셋이 창의 전부다:

| 무엇 | 측정값 | 근거 |
| ---- | ------ | ---- |
| (a) 발급 토큰 수명 | **60분** | 발급 응답의 `expires_at` = 발급시각 + 1h. `POST /app/installations/{id}/access_tokens` 에 **TTL 파라미터가 없다**(API 2022-11-28) — 우리가 줄일 수 없다. 테스트: "★실측: 발급 토큰의 잔여 수명 상한은 60분이다" |
| (b) 우리 쪽 캐시로 늘어나는가 | **아니오 (0분 추가)** | 서버는 토큰을 저장하지 않는다(응답에 한 번 실려 끝, `index.ts` 에서 토큰 문자열이 등장하는 곳은 반환문 1곳뿐). 클라도 저장하지 않는다(`github-token-store.ts` 는 device 토큰 전용). 작업 1회당 발급 1회. |
| (c) 갱신 경로 | **없음** | 발급 응답에 refresh 토큰이 존재하지 않는다. 60분 뒤 다시 받으려면 §9-1 의 판정을 다시 통과해야 한다. |

**만료 시각을 못 읽으면 그 토큰을 쓰지 않는다**(`bad-expiry`) — 창을 추측하지 않는다.

### 9-3. 받아들일 만한가 — 판단

**받아들일 만하다.** 근거:

- 창 안에서 그 토큰을 쓰려면 **자기 머신의 git 자식 프로세스 env 에서 토큰을 꺼내야** 한다. 그런데 그 사람은 바로 그 순간 **이미 그 저장소에 정당한 write 권한을 갖고 있었다** — 회수 직전까지 팀원이었다. 즉 이 창이 새로 열어 주는 것은 "회수 후 최대 60분간, 그 저장소 하나에, 그 시점 역할의 권한 한도 안에서" 뿐이다.
- 콜라보레이터 모델과 비교해도 나쁘지 않다. GitHub 에서 콜라보레이터를 제거해도 그 사람이 이미 만든 PAT·SSH 키·로컬 clone 은 즉시 무력화되지 않는다.
- 폭발 반경이 저장소 1개로 고정돼 있다(`repositories: [repo]`).

**더 줄이려면** (이번에 하지 않은 것, 사장님 판단용):

| 방법 | 얻는 것 | 대가 |
| ---- | ------- | ---- |
| 서버가 발급 토큰을 보관하고 회수 시 `DELETE /installation/token` 호출 | 창이 ~0 분 | ★**v1 §5-B2 의 "서버는 토큰을 저장하지 않는다" 를 깬다.** 1시간짜리 write 토큰이 담긴 저장소가 새로 생긴다 — 서버 침해 시 그게 곧 전 고객 저장소 write 다. **권하지 않는다.** |
| 오너의 App 제거(break-glass) | 새 발급 즉시 차단 | 같은 설치의 **다른 멤버도** 재설치 전까지 막힌다. 사고 대응용이지 일상 절차가 아니다(v1 §5-3(b)). 이미 나간 토큰은 여전히 60분 산다. |

---

## 10. ★v2 라이브 검증 런북 (write 판)

> §5 는 read 기준이다. write 는 **잘못 남으면 남의 저장소에 쓴다** — read 가 잘못 남으면 보이기만 하는 것과 비교가 안 된다. 그래서 §5 를 다 돌린 뒤 이걸 추가로 돌린다.

### 10-1. 권한 올리기 전 — ★회귀 0 확인 (이걸 먼저 한다)

1. App 권한을 **아직 바꾸지 않은 상태**에서 v2 코드를 배포한다.
2. 팀원이 clone → **성공**해야 한다(v1 그대로).
3. 팀원이 push → App 경로가 `downgraded` 로 내려가 **device 경로**로 간다. v2 이전과 같은 결과.
4. `github_app_access_logs` 에 `outcome: "issued", reason: "downgraded-to-read", access: "read"` 가 남는지 확인.
5. ★여기서 무언가 깨지면 **권한을 올리지 말고 롤백**한다.

### 10-2. 권한 올린 직후 — 재승인 전

1. §8-1 대로 권한을 올린다. **아직 오너 재승인을 하지 않는다.**
2. clone → 여전히 성공. push → 여전히 device 경로. (= 10-1 과 동일)
3. 화면이 오너에게 "재승인 필요" 를 띄우는지 확인(`getGitHubAppStatus` → `canWrite: true, writeGranted: false`).

### 10-3. 재승인 후 — 무마찰 push·PR (완료기준 1)

1. 오너가 GitHub 에서 재승인한다.
2. **그 저장소의 콜라보레이터가 아닌** `member` 역할 팀원이 마블로에서 브랜치를 밀어 본다.
3. 기대: **성공.** 그 멤버는 GitHub 에서 개별 초대를 받은 적이 없다.
4. `github_app_access_logs` 에 `outcome: "issued", access: "write", role: "member", branch: "<브랜치명>"`.

### 10-4. ★커밋 귀속 (완료기준 2) — 실제로 눈으로 확인

1. clone 된 폴더에서 `git config --local user.email` → `<id>+<login>@users.noreply.github.com` 또는 그 사람의 공개 프로필 이메일.
2. `git config --global user.email` → ★**바뀌지 않았어야 한다**(우리는 `--local` 로만 쓴다).
3. 그 폴더에서 커밋 → push → GitHub 웹에서 커밋을 연다.
4. ★기대: 커밋 작성자에 **그 팀원의 아바타와 프로필 링크**가 붙는다. 회색 이름(링크 없음)이면 귀속이 깨진 것이다.
5. ★**비공개 이메일 사용자로 반드시 한 번 더 한다.** GitHub Settings → Emails → "Keep my email addresses private" 를 켠 계정으로 3~4 를 반복한다. 기대: 똑같이 귀속되고, GH007(`Your push would publish a private email address`)이 **나지 않는다**.
6. GitHub 을 한 번도 연결하지 않은 계정으로 clone → `git config --local user.email` 이 **비어 있어야** 한다(틀린 이메일을 박느니 안 박는다). 로그에 `[commitIdentity] GitHub 계정 미연결`.

### 10-5. ★역할 게이트 (완료기준 3) — 화면과 모순이 없는가

| 역할 | 피처 브랜치 push | 기본 브랜치 push | 화면의 Merge 버튼 |
| ---- | ---------------- | ---------------- | ----------------- |
| owner | ✅ | ✅ | 보임 |
| admin | ✅ | ✅ | 보임 |
| member | ✅ | ★**거부** | 안 보임 |
| viewer | ★**거부** | ★**거부** | 안 보임 |

1. 표의 6개 ✅/거부를 실제로 확인한다.
2. 거부 시 `github_app_access_logs` 에 `role-cannot-write` / `default-branch-requires-merge-role`.
3. ★거부됐을 때 앱이 **device 토큰으로 몰래 재시도하지 않는지** 확인한다 — 재시도하면 게이트가 뚫린 것이다.

### 10-6. ★역할 회수 (§9 의 실증)

1. 10-3 의 `member` 를 오너가 보드에서 **`viewer` 로 강등**한다.
2. 즉시 그 멤버가 새 브랜치 push 재시도 → **실패**해야 한다. `reason: "role-cannot-write"`.
3. 같은 멤버를 **프로젝트에서 제거**한다 → clone·push 둘 다 실패. `reason: "not-a-member"`.
4. 오너가 **App 을 제거**한다 → 전부 실패. `reason: "repo-installation-404"`.
5. ★잔여 창: 강등 직전에 받은 토큰은 최대 60분 산다(§9-2). 그 60분 안에 그 토큰으로 push 가 되는지 확인하고, **그게 정상 동작임을** 문서와 대조한다(놀라지 않기 위해).

### 10-7. 크로스테넌트 (write 판)

1. 프로젝트 A 의 멤버가 A 의 `gitRemoteUrl` 을 **B 팀 저장소**로 바꾼다(룰상 가능하다).
2. push 시도 → **실패**. `reason: "installation-mismatch"`. ★read 와 같은 자리에서 막힌다 — write 라고 다른 경로가 열리지 않는다.
3. 멤버가 자기 `memberRoles` 문서를 `admin` 으로 만들려 시도 → 룰이 거부(`firestore.rules.test.ts` 가 이미 증명).
4. 멤버가 `githubInstallationId` 를 직접 쓰려 시도 → 룰이 거부(#1096).

### 10-8. 토큰 경계 (write 판)

1. push 성공 후 `git remote get-url origin` → 토큰 없는 깨끗한 URL.
2. `grep -r ghs_ .git/config` → 아무것도 없어야 한다.
3. push 중에 `ps aux | grep git` → argv 에 토큰이 없어야 한다.
4. Cloud Functions 로그에 `ghs_` / PEM / JWT 가 없어야 한다.
