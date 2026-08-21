# GitHub org 개설 + 저장소 이전 계획

| 항목        | 값                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------ |
| 티켓        | `5EeccZ5RbHXCMWaSR77E` — [협업·깃허브·에픽] Marblo 공식 GitHub org 개설 + 저장소 이전 계획 |
| 상태        | **계획 문서. 아직 아무것도 실행하지 않았다.** org 생성·저장소 이전·설정 변경 전부 미실행   |
| 실측 기준일 | 2026-08-21 KST                                                                             |
| 작성        | devops agent                                                                               |

> 이 문서의 모든 수치는 실제 명령 출력에서 나왔다. 근거 명령을 각 절에 같이 적었다.
> 추정인 항목은 **[추정]** 으로 명시했다.

---

## 0. 한 장 요약 — 권고안

| #   | 권고                                                                                                                  | 이유 (한 줄)                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | org 를 만든다. 이름은 **`marblo-ai`** 또는 **`marblo-hq`** (`marblo` 는 2014년부터 남이 쓰는 계정이라 불가)           | 팀·권한 그룹, 버스팩터 해소                                                                                                                             |
| 2   | 플랜은 **Free ($0) 로 시작**                                                                                          | Free org 도 팀·권한 그룹은 된다. Team($4/인·월)이 더 주는 건 _private repo 브랜치 보호_ 뿐인데, **지금 CI 가 죽어 있어 필수 상태검사를 걸 대상이 없다** |
| 3   | **소스 저장소 `melocream/marblo` 는 옮긴다**                                                                          | 여기가 팀 협업·권한이 필요한 곳                                                                                                                         |
| 4   | ★**릴리스 저장소 `melocream/marblo-releases` 는 이번에 옮기지 않는다**                                                | 아래 §2 참조. 옮기면 설치 기반 전체의 업데이트가 **`melocream` 개인 계정의 리다이렉트에 영구 종속**된다 — org 이전의 목적과 정반대                      |
| 5   | 릴리스 피드는 별도 티켓으로 **커스텀 도메인(`updates.marblo.app`) generic provider** 로 분리한 뒤에 저장소를 정리한다 | 한 번 분리하면 이후 저장소를 몇 번 옮기든 사용자 앱이 안 깨진다                                                                                         |
| 6   | ★**선행 조건: GitHub 결제 문제부터 푼다**                                                                             | §5 참조. 지금 Actions 가 결제 문제로 **전면 정지** 상태다                                                                                               |

**사장님이 결정해야 하는 것은 3개뿐이다.** → §6

---

## 1. 현황 실측

### 1-1. 계정·저장소

```
gh api repos/melocream/marblo        → private=true,  owner=melocream, owner_type=User, default=main,  size=43,527KB
gh api repos/melocream/marblo-releases → private=false, owner=melocream, default=master, size=0KB
gh api user/orgs                     → []   (소속 org 없음)
```

| 저장소                         | 공개    | 역할                                                          | 이전 대상?                   |
| ------------------------------ | ------- | ------------------------------------------------------------- | ---------------------------- |
| `melocream/marblo`             | private | 소스 · CI · 이슈                                              | ✅ 옮긴다                    |
| `melocream/marblo-releases`    | public  | **자동업데이트 피드 + 배포 자산**                             | ❌ **이번엔 안 옮긴다** (§2) |
| `marblo-app/marblo`            | public  | 공개 쇼케이스 미러(★5, homepage=marblo.app, 40MB)             | △ 2단계 (§4-4)               |
| `marblo-app/marblo-app`        | public  | 사실상 빈 저장소(2KB)                                         | 정리 대상                    |
| `melocream/marblo-1`           | private | 2026-07-27 생성 후 방치된 중복본(2.2MB)                       | 정리 대상                    |
| `melocream/TaskForce.AI`       | private | 구 이름 저장소. `README.md:79` 이 아직 이걸 clone 하라고 안내 | △ 2단계                      |
| 공개 스킬/MCP 6종 <sup>a</sup> | public  | 생태계 스킬 배포                                              | △ 2단계                      |

<sup>a</sup> `ga4-full-tagging-skill`, `gcp-automation-skill`, `GCP-optimize-skill`, `seo-geo-skill`, `cross-AI-verifier-MCP`, `bigquery-cost-reduction-query-guide-claude-skill`

### 1-2. 현재 붙어 있는 것 (이전 시 확인 대상)

```
gh api repos/melocream/marblo/actions/secrets  → 7건
gh api repos/melocream/marblo/actions/variables→ 0건
gh api repos/melocream/marblo/environments     → 2건 (Preview, Production) · 각 secret/var 0건
gh api repos/melocream/marblo/keys             → 0건 (배포 키 없음)
gh api repos/melocream/marblo/hooks            → 0건 (레거시 웹훅 없음)
gh api repos/melocream/marblo/collaborators    → melocream(admin), datagadapida-coder(push)
gh api repos/melocream/marblo/deployments      → creator=vercel[bot], environment=Production/Preview (상시)
```

Actions 시크릿 7종(이름만): `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `MERGE_HISTORY_WEBHOOK_URL`, `MERGE_HISTORY_WEBHOOK_TOKEN`
_(값은 GitHub API 로 읽을 수 없다. 이 문서에도 값은 없다.)_

> ⚠️ **별건 결함 실측**: `.github/workflows/build.yml:213-218` 이 `secrets.FIREBASE_API_KEY` 등 6개를 참조하는데 **repo/environment 어디에도 그 이름의 시크릿이 없다.** 지금은 CI 자체가 안 돌아서 드러나지 않을 뿐, CI 복구 시 빈 값으로 빌드된다. 별도 티켓 필요.

> ⚠️ **별건 결함 실측**: `v3/.github/workflows/{build,deploy-production}.yml` 은 **GitHub 이 읽지 않는 경로**다(워크플로는 저장소 루트 `.github/workflows/` 만 인식). 죽은 파일이거나, 의도한 배포 자동화가 아예 안 돌고 있는 것.

---

## 2. ★자동업데이트 영향 — 실측 판단

### 2-1. 지금 설치된 앱이 실제로 무엇을 보고 있나

**증거 1 — 이 맥에 설치된 실제 앱 번들 내부**

```
cat /Applications/Marblo.app/Contents/Resources/app-update.yml
  owner: melocream
  repo: marblo-releases
  provider: github
  updaterCacheDirName: marblo-v3-updater
```

**증거 2 — 컴파일된 코드가 부팅 때 그걸 다시 강제한다** (`v3/electron/updater.ts:37-46, 68-71`)

```ts
const DEFAULT_UPDATE_FEED_OWNER = "melocream";
const DEFAULT_UPDATE_FEED_REPO  = "marblo-releases";
...
autoUpdater.setFeedURL(resolveGithubFeedOptions());
```

`setFeedURL` 이 명시 호출되므로 `package.json` 의 `repository.url` 추론은 쓰이지 않는다.
환경변수 `MARBLO_UPDATER_OWNER` / `MARBLO_UPDATER_REPO` / `MARBLO_UPDATER_CHANNEL` 로 덮을 수 있지만, **사용자 PC 에는 그 변수가 없다.**

→ **결론: 사용자 앱의 피드 주소는 바이너리에 박혀 있고, 배포된 뒤에는 우리가 바꿀 수 없다.** 새 빌드를 설치시키는 것 외엔 방법이 없다.

### 2-2. `latest.yml` / `latest-mac.yml` 이 가리키는 경로

```
curl -sSL https://github.com/melocream/marblo-releases/releases/download/v3.0.22/latest-mac.yml
  version: 3.0.22
  files:
    - url: Marblo-3.0.22-arm64-mac.zip     ← 상대 파일명
    - url: Marblo-3.0.22-arm64.dmg
  path: Marblo-3.0.22-arm64-mac.zip
```

```
curl -sSL .../latest.yml
  files:
    - url: Marblo-Setup-3.0.22.exe          ← 상대 파일명
```

→ **매니페스트 안에는 owner/repo 가 없다.** 전부 상대 파일명이다. 즉 매니페스트는 저장소 중립이고, **저장소 주소를 결정하는 건 오직 앱 바이너리의 `owner/repo`** 다. (매니페스트를 손봐서 이전을 흡수하는 트릭은 불가능하다.)

### 2-3. electron-updater 가 실제로 때리는 URL 4종

`electron-updater@6.8.3` `out/providers/GitHubProvider.js` 를 읽어 확인:

| #   | URL                                                                                         | 용도          |
| --- | ------------------------------------------------------------------------------------------- | ------------- |
| 1   | `https://github.com/melocream/marblo-releases/releases.atom`                                | 릴리스 목록   |
| 2   | `https://github.com/melocream/marblo-releases/releases/latest` (`Accept: application/json`) | 최신 태그     |
| 3   | `.../releases/download/<tag>/latest-mac.yml` (win: `latest.yml`)                            | 매니페스트    |
| 4   | `.../releases/download/<tag>/<asset>`                                                       | 실제 다운로드 |

리다이렉트 처리: `builder-util-runtime/out/httpExecutor.js:59,133-140` → `maxRedirects = 10`, `code >= 300 && code < 400` 이면 `location` 따라감. **3xx 를 자동 추종한다.**

### 2-4. 실제로 이전된 저장소로 4종을 다 때려봤다

우리 저장소를 옮길 수는 없으니, **실제로 이전이 일어난 남의 저장소**로 같은 요청을 보냈다.

| 테스트                                                                                | 이전 유형                                | 결과                                                                                        |
| ------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `github.com/creationix/nvm/releases.atom` → `nvm-sh/nvm`                              | **개인 계정 → org** (우리 케이스와 동일) | 301 1홉 → **200 OK**                                                                        |
| `github.com/creationix/nvm/releases/latest` (`Accept: application/json`)              | 개인 → org                               | 2홉 → **200, `{"tag_name":"v0.40.7", ...}` JSON 정상**                                      |
| `github.com/cdr/code-server/releases/download/v4.133.0/code-server-4.133.0-amd64.rpm` | org → org                                | 2홉 → **206 Partial Content**, `release-assets.githubusercontent.com` 서명 URL 로 정상 도달 |
| 대조군 `melocream/marblo-releases/releases.atom`                                      | 이전 없음                                | 0홉 200                                                                                     |

리다이렉트 홉 수(1~2) ≪ `maxRedirects`(10).

> ⚠️ 정직한 한계: 자산 다운로드 리다이렉트는 org→org 사례로만 확인했다(개인→org 로 이전되었으면서 릴리스 자산까지 있는 공개 저장소를 못 찾았다). GitHub 의 리다이렉트는 저장소 레코드 단위라 소유자 유형과 무관하지만, **확인하지 않은 것을 확인했다고 적지 않기 위해** 명시해 둔다. 이 잔여 불확실성은 §7 리허설로 0 으로 만든다.

### 2-5. 그래서 왜 "안 옮긴다" 가 답인가

리다이렉트가 동작한다는 건 확인했다. 그런데 **리다이렉트에 기대는 것 자체가 이번 이전의 목적을 파괴한다.**

1. **리다이렉트는 `melocream` 개인 계정이 살아 있어야 유지된다.**
   이 티켓의 존재 이유가 "소유자 계정에 문제가 생기면 제품 전체가 막힌다(버스팩터)" 다.
   릴리스 저장소를 옮기고 리다이렉트에 기대면, **이미 배포된 앱 전부가 그 개인 계정에 영구 종속**된다. 계정이 사라지면 `melocream/*` 리다이렉트도 같이 사라지고, 그 시점에 설치돼 있던 모든 앱이 업데이트를 영구히 못 받는다. 문제를 없애는 게 아니라 **되돌릴 수 없게 굳히는** 셈이다.

2. **옛 경로가 재사용 가능한 채로 남는다 = 사고 한 번이면 영구 소멸.**
   GitHub 공식 문서: _"If you create a new repository or fork at the previous repository location, the redirects to the transferred repository will be permanently deleted."_
   또 문서는 _"이전 직전 1주간 clone 100회 초과 또는 Actions 사용 100회 초과"_ 시에만 옛 `OWNER/REPO` 이름을 **영구 은퇴**시켜 재생성을 막는다고 한다.

   ```
   gh api repos/melocream/marblo-releases/traffic/clones      → {"count":1,"uniques":1}    (14일)
   gh api repos/melocream/marblo-releases/actions/runs        → total_count 0
   ```

   → **marblo-releases 는 두 임계값 모두 미달 → 이름이 은퇴되지 않는다 → 옛 경로가 비어 재사용 가능한 상태로 남는다.**
   반대로 소스 저장소는:

   ```
   gh api ".../marblo/actions/runs?created=>2026-08-14" → total_count 787
   gh api repos/melocream/marblo/traffic/clones          → {"count":500,"uniques":2}
   ```

   → **`melocream/marblo` 는 임계값을 크게 넘어 이름이 영구 은퇴된다** (재생성 불가 = 사고로 리다이렉트를 깨뜨릴 수 없음 = 오히려 안전).

3. **얻는 게 없다.** `marblo-releases` 는 collaborator 0명, 시크릿 0건, 웹훅 0건, 배포키 0건, Actions 0건, 이슈/PR 없음, size 0KB 인 **공개 자산 버킷**이다. 팀·권한 관리가 필요 없다. 옮겨서 얻는 건 URL 에 보이는 이름뿐이고, 그건 §5 2단계에서 무위험으로 얻을 수 있다.

**정리**: 위험(설치 기반 전체의 업데이트 경로) 대비 이득(URL 미관)이 성립하지 않는다. 그리고 이 판단은 §5 2단계로 뒤집을 수 있다 — 커스텀 도메인으로 피드를 분리한 뒤에는 저장소를 옮겨도 사용자 앱이 아무 영향을 안 받는다.

### 2-6. 부수 사실 (자동업데이트 관련)

- 최신 공개 릴리스는 **v3.0.22** (`gh release list`). 그런데 `v3.0.35`, `v3.0.21`, `v3.0.15` 는 **Draft** 로 남아 있고, 코드 버전은 `v3/package.json` 기준 **3.0.34**.
  → 사용자에게 실제로 내려가는 최신은 3.0.22 다. 이건 이 티켓 범위 밖이지만 릴리스 위생 문제로 기록해 둔다.
- `v3/src/components/UpdateBanner.tsx:39` 의 수동 다운로드 폴백 URL, `marblo-web/src/app/[locale]/download/page.tsx:22` 의 `RELEASE_BASE`, `marblo-web/src/app/[locale]/layout.tsx:228` 의 `sameAs` 가 모두 `melocream/marblo-releases` 하드코딩. **릴리스 저장소를 안 옮기면 이 셋은 손댈 필요가 없다.**

---

## 3. ★옮길 때 안 따라오는 것 — 전수 체크리스트

먼저 **따라오는 것**을 공식 문서로 확정해 둔다 (docs.github.com — Transferring a repository):

> _"When you transfer a repository, its issues, pull requests, wiki, stars, and watchers are also transferred. **If the transferred repository contains webhooks, services, secrets, or deploy keys, they will remain associated after the transfer is complete.** Git information about commits, including contributions, is preserved."_

즉 **Actions 시크릿·웹훅·배포 키는 문서상 따라온다.** (우리 저장소는 웹훅 0·배포키 0 이라 사실상 시크릿 7건만 해당.)
그래도 §7 리허설에서 눈으로 확인한다 — "문서가 그렇다" 와 "우리 저장소가 그랬다" 는 다르다.

### 안 따라오거나, 사람이 손대야 하는 것

| #   | 항목                                         | 실측 근거                                                                                                                                                                                               | 이전 후 상태                                                                                   | 조치                                                                                                                                                                    | 위험                                      |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | **Vercel 연동**                              | `deployments` API 의 creator 가 전부 `vercel[bot]`, Production/Preview 상시. `repos/melocream/marblo.homepage = marblo-web.vercel.app`. `marblo.app` A 레코드 = 216.150.1.129 / 216.150.16.129 (Vercel) | Vercel GitHub App 설치는 **계정 단위**다. 새 org 에는 설치가 없다                              | ① 새 org 에 Vercel GitHub App 설치 + 해당 repo 접근 허용 → ② Vercel 프로젝트 Settings → Git 에서 연결 재확인 → ③ 더미 커밋으로 Preview 배포 1회 확인                    | **높음** — 놓치면 웹 배포가 조용히 멈춘다 |
| 2   | **Actions 시크릿 7종**                       | `actions/secrets` 7건                                                                                                                                                                                   | 문서상 따라옴. 단 **값은 API 로 읽을 수 없다(쓰기 전용)**                                      | 이전 직후 이름 7개 존재 확인. **없으면 원본이 필요**하다 — `MAC_CSC_LINK`(코드서명 .p12 base64) 원본 파일과 비밀번호가 로컬/1Password 에 있는지 **이전 전에** 먼저 확인 | **치명** — 원본이 없으면 복구 불가        |
| 3   | **로컬 클론들의 remote**                     | 아래 목록                                                                                                                                                                                               | git push/fetch 는 리다이렉트로 계속 동작(문서 확인). 단 GitHub 이 "업데이트하라" 경고          | 각 클론에서 `git remote set-url origin <새 URL>`                                                                                                                        | 중                                        |
| 4   | **브랜치 보호 규칙**                         | `branches/main/protection` → **403 "Upgrade to GitHub Pro or make this repository public"**                                                                                                             | **지금 아예 없다.** 이전해도 Free org 에선 여전히 못 켠다                                      | Team 으로 올릴 때 새로 설정 (§4-2)                                                                                                                                      | 낮음 (현재 0)                             |
| 5   | **Environments (Preview/Production)**        | `environments` 2건, 시크릿/변수 0건                                                                                                                                                                     | Vercel 이 만든 것. Vercel 재연결 시 자동 재생성                                                | 재연결 후 존재 확인                                                                                                                                                     | 낮음                                      |
| 6   | **`v3/package.json` `repository.url`**       | `:7` = `https://github.com/melocream/marblo.git`                                                                                                                                                        | 리다이렉트로 동작하나 부정확                                                                   | 새 URL 로 수정                                                                                                                                                          | 낮음                                      |
| 7   | **`README.md:79`**                           | `git clone https://github.com/melocream/TaskForce.AI.git`                                                                                                                                               | 이미 옛 이름 안내 (현재도 틀림)                                                                | 새 URL 로 수정                                                                                                                                                          | 낮음                                      |
| 8   | **배지**                                     | `grep shields.io README.md` → **0건**                                                                                                                                                                   | 해당 없음                                                                                      | —                                                                                                                                                                       | 없음                                      |
| 9   | **GitHub Pages**                             | `has_pages: false` (양쪽 다)                                                                                                                                                                            | 해당 없음. (문서: Pages 는 리다이렉트되지 않음)                                                | —                                                                                                                                                                       | 없음                                      |
| 10  | **Packages**                                 | 사용 없음                                                                                                                                                                                               | 문서상 레지스트리에 따라 링크가 끊길 수 있음                                                   | 해당 없음 확인만                                                                                                                                                        | 없음                                      |
| 11  | **Fork 네트워크**                            | `forks_count: 0`                                                                                                                                                                                        | 해당 없음                                                                                      | —                                                                                                                                                                       | 없음                                      |
| 12  | **협업자 권한**                              | `datagadapida-coder` = push                                                                                                                                                                             | org 이전 시 기존 collaborator 는 유지되고, 원 소유자(melocream)가 collaborator 로 추가됨(문서) | org Team 으로 재편 후 개별 collaborator 정리                                                                                                                            | 중                                        |
| 13  | **`MERGE_HISTORY_WEBHOOK_URL/TOKEN` 수신처** | `.github/workflows/merge-history.yml` 이 사용                                                                                                                                                           | 시크릿은 따라오나, **수신 서버가 저장소 주소나 org 를 검증하면 거부될 수 있다**                | 수신처 화이트리스트 확인                                                                                                                                                | 중                                        |
| 14  | **릴리스 자산 URL**                          | `marblo-web` `RELEASE_BASE`, `UpdateBanner`, `layout.tsx sameAs`                                                                                                                                        | **릴리스 저장소를 안 옮기므로 영향 없음**                                                      | —                                                                                                                                                                       | 없음 (권고안 채택 시)                     |

### 로컬 클론 실측

`.git` 이 **디렉터리**면 독립 클론, **파일**이면 worktree 다. worktree 는 상위 클론의 `remote` 설정을 그대로 공유하므로 **독립 클론에서만 `remote set-url` 을 하면 된다.**

```
# 독립 클론 (.git = 디렉터리) — 여기만 고치면 된다
/Users/dongwonkim/Documents/programming/marblo   → melocream/marblo.git   (worktree 76개 딸림)
/Users/dongwonkim/Marblo/marblo                  → melocream/marblo.git   (worktree 18개 딸림)
/Volumes/My Passport/programming/marblo-old      → melocream/marblo.git   (구 사본, 외장 디스크)

# worktree (.git = 파일) — 고칠 필요 없음. 예:
/Users/dongwonkim/.marblo/worktrees/macbuild-3023    → gitdir: .../Documents/programming/marblo/.git/...  ★빌드 worktree
/Users/dongwonkim/.marblo/worktrees/macbuild-latest  → gitdir: .../Documents/programming/marblo/.git/...  ★빌드 worktree
```

→ **조치 대상은 독립 클론 3개뿐이다.** (`git remote set-url origin <새 URL>`)
★ 빌드 worktree(`macbuild-3023` = `release/v3.0.35`, `macbuild-latest`)는 **브랜치를 절대 건드리지 않는다.** 상위 클론의 remote 만 바뀌면 자동으로 따라간다.

> 외장 디스크의 `marblo-old` 는 오프라인일 때가 많다. 다음에 연결될 때 고치면 되고, 그전까지는 리다이렉트로 push/fetch 가 동작한다.

---

## 4. org 설정안

### 4-1. 이름

```
gh api users/<name>  →  200 = 사용 중 / 404 = 사용 가능
marblo        200  ← 2014년부터 "MarBlo" 라는 남의 개인 계정. 불가
marblo-app    200  ← 우리 봇 계정 (public repo 2개, marblo-app/marblo ★5)
marblo-ai     404  사용 가능
marblo-hq     404  사용 가능
marbloapp     404  사용 가능
marblohq      404  사용 가능
usemarblo     404  사용 가능
getmarblo     404  사용 가능
marblo-team / marblo-dev / marblo-io / marblo-inc / marblolabs / hypemarc  전부 404 사용 가능
```

**추천: `marblo-ai`** (제품 성격이 이름에 드러남) 또는 **`marblo-hq`**.
`marblo` 를 굳이 원하면 대안은 하나뿐 — **`marblo-app` 개인 계정을 org 로 전환**(GitHub 의 계정→org 전환). 그러면 `marblo-app/marblo`(★5, homepage=marblo.app) URL 과 스타가 그대로 보존된다. 단 **전환은 되돌릴 수 없고**, 그 계정으로는 더 이상 로그인할 수 없게 되며, 현재 `gh auth` 에 등록된 `marblo-app` 토큰이 무효화된다. → §6 결정 3.

### 4-2. 플랜 — 금액과 근거

`github.com/pricing` 실측 (2026-08-21):

| 플랜           | 금액               | 그 돈으로 무엇이 되는가                                                                                                                                                                      |
| -------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free (org)** | **$0 USD / 월**    | 무제한 private repo, **무제한 멤버**, **팀(Team) 권한 그룹 ✅**, Actions 2,000분/월                                                                                                          |
| **Team**       | **$4 USD / 인·월** | Free 의 전부 + **private repo 의 브랜치 보호 / 필수 PR 리뷰어 / 다중 리뷰어 / CODEOWNERS / 예약 리마인더 / Pages**, Actions **3,000**분/월, Packages 2GB, GitHub Advanced Security 구매 옵션 |
| Enterprise     | $21 USD / 인·월    | SAML SSO 등. 지금 필요 없음                                                                                                                                                                  |

**핵심**: 티켓이 든 이유 중 _"팀원을 collaborator 로 한 명씩 수동 초대"_, _"권한 그룹·팀이 없다"_, _"버스팩터"_ 는 **전부 Free org 로 해결된다.** (docs: _"GitHub Free for organizations includes: Team access controls for managing groups"_)

Team 이 추가로 파는 건 실질적으로 **private repo 의 브랜치 보호 한 가지**다. 지금 상태:

```
gh api repos/melocream/marblo/branches/main/protection
→ 403 "Upgrade to GitHub Pro or make this repository public to enable this feature."
```

즉 지금도 브랜치 보호가 **없다**. 그리고 브랜치 보호의 핵심 가치인 "필수 상태검사(required status checks)" 는 **CI 가 돌아야 의미가 있는데, 지금 CI 는 결제 문제로 전면 정지 상태다(§5).**

**금액 계산 — Team 을 택할 경우**

현재 private repo 접근이 필요한 계정: `melocream`(owner), `datagadapida-coder`, `marblo-app`(봇) = **3 seat**.
GitHub Team 은 **봇/머신 유저도 seat 을 소비한다.**

| 시나리오                      | 월  | 연   | 원화 [추정, 1,400원/USD 가정]   |
| ----------------------------- | --- | ---- | ------------------------------- |
| Free org                      | $0  | $0   | ₩0                              |
| Team, 3 seat                  | $12 | $144 | 약 ₩16,800 / 월 · ₩201,600 / 년 |
| Team, 5 seat (팀원 2 증원 시) | $20 | $240 | 약 ₩28,000 / 월 · ₩336,000 / 년 |

> pricing 페이지에 _"$4 USD per user/month for the first 12 months _"\* 프로모션 표기가 병기돼 있다. 조건은 결제 화면에서 확인해야 한다. 위 금액은 프로모션 없는 정가 기준이다.

**권고: Free 로 시작. 아래 두 조건이 모두 참이 되는 시점에 Team 으로 올린다.**

1. GitHub 결제 문제가 해결되어 Actions 가 실제로 돈다 (§5)
2. `main` 에 "CI 통과 + 리뷰 1명" 을 강제하고 싶다는 의사결정이 실제로 있다

Free → Team 업그레이드는 언제든 클릭 한 번이고 **되돌릴 수도 있다**(다운그레이드 시 브랜치 보호가 꺼질 뿐). 서두를 이유가 없다.

### 4-3. 팀·권한 구조 (Free org 에서 그대로 가능)

| 팀            | 권한     | 대상 저장소                             | 멤버                      |
| ------------- | -------- | --------------------------------------- | ------------------------- |
| `owners`      | Owner    | 전체                                    | 사장님                    |
| `engineering` | Write    | `marblo`                                | 개발자                    |
| `release`     | Maintain | `marblo` (+2단계에서 `marblo-releases`) | 릴리스 책임자             |
| `bots`        | Write    | `marblo`                                | `marblo-app` 등 머신 계정 |

기본 멤버 권한은 **Read** 로 두고, 저장소 생성 권한은 Owner 로 제한한다.

### 4-4. 브랜치 보호 (Team 으로 올린 뒤)

`main` 기준:

- Require a pull request before merging (승인 1명)
- Require status checks to pass: `Lint`, `Build & Release / build` — ★**CI 가 실제로 도는 것을 확인한 뒤에 켠다.** 지금 켜면 모든 PR 이 영구히 머지 불가가 된다
- Require branches to be up to date before merging
- Do not allow force pushes / deletions
- (초기엔) Include administrators 는 끄고 시작 — 사고 시 사장님이 직접 풀 수 있게

---

## 5. ★선행 조건 — GitHub Actions 가 지금 죽어 있다

이건 org 계획의 전제조건이라 여기 적는다.

```
gh api "repos/melocream/marblo/actions/runs?created=>2026-08-14" → total_count 787
  · "Build & Release"        → 최근 100건 중 queued 77 / failure 23. 성공 0건
  · "Lint" / "Merge History" → 전부 3~5초 만에 failure

실패 job annotation 원문:
  "The job was not started because recent account payments have failed or your
   spending limit needs to be increased. Please check the 'Billing & plans'
   section in your settings"
```

동일한 annotation 을 **2026-07-23 런에서도** 확인했다 → **최소 5주 이상 CI 전면 정지.**
`Build & Release` 는 최근 2,200건 이상을 훑어도 **성공 이력이 없다.** 지금 릴리스는 CI 가 아니라 로컬 맥 빌드 worktree(`macbuild-latest` / `macbuild-3023`)에서 수동으로 나가고 있다.

### 왜 터졌나 — [추정] 이지만 계산 근거는 실측

runner 단가 (docs.github.com, 2026-08-21 실측):

| 러너                             | 분당              |
| -------------------------------- | ----------------- |
| Linux 2-core x64                 | $0.006            |
| Windows 2-core                   | $0.010            |
| macOS 3~4-core                   | **$0.062**        |
| 공유 스토리지(아티팩트+Packages) | **$0.25 / GB·월** |

`.github/workflows/build.yml:350-362` 이 매 빌드마다 dmg/zip/exe 를 아티팩트로 올리고 **`retention-days: 30`**.
실측 자산 크기(v3.0.22 매니페스트): zip 266MB + dmg 277MB + exe 229MB = **빌드 1회당 약 772MB**.
Free 플랜 포함 스토리지는 500MB. → **성공 빌드 한 번이면 이미 초과**, 30일 보관이면 누적된다.

**권고(별도 티켓)**: `retention-days: 30 → 7`, 그리고 태그 빌드는 `release` job 이 어차피 GitHub Release 로 발행하므로 **`upload-artifact` 에서 dmg/zip/exe 를 빼는** 것을 검토. 이것만으로 스토리지 과금이 사실상 0 이 된다.

★ **사장님 조치**: GitHub → Settings → Billing & plans 에서 결제수단 및 spending limit 확인. **이게 풀리기 전에는 org 로 옮겨도 CI 는 안 돈다** (org 로 옮기면 과금 주체가 org 로 바뀌어 새 2,000분 쿼터를 받지만, 원인이 결제수단 실패라면 동일 카드로 또 막힌다).

---

## 6. 사장님이 결정할 것 — 3개

| #     | 결정                                     | 선택지                                                                                                                                  | devops 권고                                                               |
| ----- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **1** | org 이름                                 | `marblo-ai` / `marblo-hq` / `marbloapp` / `usemarblo` / 기타 (`marblo` 는 불가)                                                         | **`marblo-ai`**                                                           |
| **2** | 플랜                                     | Free **$0** / Team **$12/월(3인)·$144/년**                                                                                              | **Free 로 시작.** CI 복구 + 브랜치 보호가 실제로 필요해질 때 Team         |
| **3** | `marblo-app` 계정을 org 로 전환할 것인가 | 전환하면 `marblo-app/marblo`(★5) URL·스타 보존, 이름도 제품과 일치. **단 되돌릴 수 없고** 그 계정 로그인·현재 `gh auth` 토큰이 무효화됨 | **전환하지 말고 새 org 를 만든다.** 봇 계정을 잃는 대가가 이름값보다 크다 |

추가로 **선행 조치 1건**: GitHub 결제 문제 해결 (§5). 이건 결정이 아니라 필수다.

---

## 7. 실행 순서 (★승인 후, 별도 티켓)

### 0단계 — 리허설 (실제 이전 전에 반드시. 비용 $0)

자동업데이트 잔여 불확실성(§2-4)을 0 으로 만드는 절차. `updater.ts` 가 이미 env 오버라이드를 지원하므로 **진짜 패키지 앱으로 검증할 수 있다.**

1. 임시 public repo `melocream/marblo-updater-rehearsal` 생성
2. 거기에 태그 `v9.9.9` 로 릴리스 발행 — `latest-mac.yml` + 더미 zip/dmg 업로드 (실제 매니페스트 형식 그대로)
3. 임시 org(`marblo-rehearsal`) 생성 후 그 repo 를 **이전**
4. 로컬에서
   ```
   MARBLO_UPDATER_OWNER=melocream \
   MARBLO_UPDATER_REPO=marblo-updater-rehearsal \
   open -a Marblo
   ```
   → **옛 경로** 를 보는 앱이 이전된 저장소에서 업데이트를 찾아 **끝까지 다운로드하는지** 확인
5. 4가 통과하면 §2-4 의 잔여 불확실성이 사라진다. 실패하면 **소스 저장소 이전 자체도 재검토**해야 한다 (그때는 이 문서의 §0-3 도 뒤집힌다)
6. 임시 repo/org 삭제

### 1단계 — org 생성 + 소스 저장소 이전

| 순  | 작업                                                                                              | 되돌릴 수 있나        |
| --- | ------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | GitHub 결제 문제 해결 (§5)                                                                        | ✅                    |
| 2   | `MAC_CSC_LINK` 등 시크릿 **원본**이 손에 있는지 확인 (1Password/로컬)                             | ✅                    |
| 3   | org 생성 (Free)                                                                                   | ✅ (삭제 가능, 단 §8) |
| 4   | 팀 4개 생성 + 멤버 초대 (§4-3)                                                                    | ✅                    |
| 5   | 진행 중인 PR 을 **전부 머지하거나 닫는다** — 이전 중 PR 은 그대로 따라오지만 CI 재트리거가 꼬인다 | ✅                    |
| 6   | `melocream/marblo` → org 로 **Transfer**                                                          | ⚠️ §8                 |
| 7   | 시크릿 7종 이름 존재 확인 (`gh api repos/<org>/marblo/actions/secrets`). 없으면 재등록            | ✅                    |
| 8   | 새 org 에 **Vercel GitHub App 설치** + repo 접근 허용 → Vercel 프로젝트 Git 연결 확인             | ✅                    |
| 9   | 더미 커밋으로 **Preview 배포 1회** 확인                                                           | ✅                    |
| 10  | 로컬 클론 4개 `git remote set-url` (★빌드 클론은 브랜치 건드리지 말 것)                           | ✅                    |
| 11  | `v3/package.json:7`, `README.md:79` URL 수정 → PR                                                 | ✅                    |
| 12  | `Lint` 워크플로 1회 성공 확인                                                                     | ✅                    |
| 13  | `melocream/marblo-1`, `marblo-app/marblo-app` 정리 여부 판단                                      | —                     |

**릴리스 저장소는 이 단계에서 손대지 않는다.** `marblo-releases` 는 `melocream` 소유로 그대로 둔다.
electron-builder `publish` 대상(`v3/electron-builder.yml`)과 `updater.ts` 기본값도 **그대로 둔다.** 아무것도 안 바꾼다 = 자동업데이트 위험 0.

### 2단계 — 릴리스 피드 탈GitHub (별도 티켓, 1단계 안정화 후)

목표: **저장소 위치와 업데이트 피드를 영구히 분리**한다. 이걸 하면 이후 저장소를 몇 번 옮기든 사용자 앱이 안 깨진다.

1. `updates.marblo.app` 서브도메인을 Vercel 에 붙이고, `latest*.yml` + 자산을 서빙 (리다이렉트 프록시 또는 정적 호스팅)
2. `electron-builder.yml` `publish` → `provider: generic`, `url: https://updates.marblo.app/`
   `updater.ts` 기본 피드도 동일하게 변경
3. 새 버전 릴리스. **이 시점부터 신규 설치·업데이트한 사용자는 GitHub 저장소 위치와 무관해진다**
4. 텔레메트리로 **설치 기반 버전 분포**를 관찰한다. 구버전(피드가 `melocream/marblo-releases` 로 박힌 빌드) 비율이 충분히 떨어질 때까지 대기
5. 그 다음에야 `marblo-releases` 를 org 로 이전. 이전 후에도 옛 경로 리다이렉트는 살아 있으므로 잔존 구버전도 계속 업데이트를 받는다
6. ★ 이전 후 **`melocream/marblo-releases` 이름으로 절대 새 repo/fork 를 만들지 않는다** (리다이렉트 영구 소멸)

> 4단계에 필요한 데이터: **버전별 활성 설치 수**. 현재 이 문서 작성자에게 텔레메트리 접근 권한이 없어 측정하지 못했다. 2단계 티켓의 선행 과제로 남긴다.

---

## 8. 롤백 계획 — ★되돌릴 수 없는 지점

### 되돌릴 수 있는 것

| 상황                          | 되돌리는 법                                                                              | 소요    |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------- |
| org 를 잘못 만들었다          | org 설정 → Delete organization                                                           | 즉시    |
| 저장소를 org 로 옮겼는데 문제 | **다시 `melocream` 개인 계정으로 Transfer** — git 데이터·이슈·PR·릴리스·시크릿 모두 보존 | 분 단위 |
| Vercel 배포가 멈췄다          | Vercel 프로젝트 Git 연결을 옛 저장소로 되돌리거나 GitHub App 재설치                      | 분 단위 |
| 시크릿이 안 따라왔다          | 원본으로 재등록 (**원본이 있어야 한다**)                                                 | 분 단위 |
| Team 플랜이 비싸다            | Free 로 다운그레이드 (브랜치 보호만 꺼짐)                                                | 즉시    |
| 로컬 remote 를 잘못 바꿨다    | `git remote set-url` 다시                                                                | 즉시    |

### ★되돌릴 수 없는 지점 (여기부터는 취소 버튼이 없다)

| #      | 지점                                                 | 무슨 일이 벌어지나                                                                                                                                                                                                                                                                                            | 방어                                                                                                                      |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **R1** | **`melocream/marblo` 를 이전하는 순간**              | 최근 1주 Actions **787회**·clone **500회** → GitHub 임계값(100) 초과 → **`melocream/marblo` 이름이 영구 은퇴된다.** 그 이름으로 다시는 새 저장소를 만들 수 없다 (`"The repository has been retired and cannot be reused."`) <br>※ 같은 저장소를 되돌려 이전하는 것은 가능하다. 막히는 건 _새_ 저장소 생성이다 | 되돌림 = "다시 transfer" 로 하고, 절대 "새로 만들어 push" 로 하지 않는다                                                  |
| **R2** | **옛 경로에 새 repo/fork 를 만드는 순간**            | 공식 문서: _"the redirects to the transferred repository will be permanently deleted."_ **리다이렉트가 영구 소멸.** 릴리스 저장소에서 이게 일어나면 **설치된 모든 앱이 영구히 업데이트 불가**                                                                                                                 | ① 이번엔 `marblo-releases` 를 아예 안 옮긴다 ② 2단계 이후에도 그 이름을 만들지 않는다는 것을 문서화                       |
| **R3** | **`melocream` 계정을 삭제하거나 이름을 바꾸는 순간** | `melocream/*` 리다이렉트 전부 소멸. 계정명이 남에게 넘어가면 남이 그 네임스페이스를 소유한다                                                                                                                                                                                                                  | 이전 후에도 **`melocream` 계정을 유지**한다. (권고안대로 릴리스 저장소를 안 옮기면 애초에 이 계정이 원본 소유자로 남는다) |
| **R4** | **새 org 를 가리키는 빌드를 사용자에게 배포한 순간** | 사용자 PC 의 바이너리는 회수 불가. 그 사용자들은 **새 경로에 영구 종속**된다. 새 경로가 죽으면 그들도 죽는다                                                                                                                                                                                                  | 2단계에서 GitHub 이 아닌 **우리 도메인**을 가리키게 만든다 (도메인은 우리가 통제하니 언제든 재지정 가능)                  |
| **R5** | **`marblo-app` 개인 계정 → org 전환**                | 계정→org 전환은 되돌릴 수 없다. 그 계정으로 로그인 불가, 현재 `gh auth` 의 `marblo-app` 토큰 무효화                                                                                                                                                                                                           | 하지 않는 것을 권고 (§6 결정 3)                                                                                           |
| **R6** | **private repo 를 public 으로 바꾸는 순간**          | 커밋 히스토리 전체가 공개된다. 다시 private 으로 돌려도 이미 클론·인덱싱된 것은 회수 불가                                                                                                                                                                                                                     | 이 계획에 그런 작업은 없다. 실수 방지용으로 기록                                                                          |

**요약하면 진짜 벼랑은 R2 하나다** — 그리고 §0 권고안(릴리스 저장소를 안 옮긴다)은 정확히 그 벼랑을 이번 이전에서 제거하기 위한 선택이다.

---

## 9. 남은 미지

| #   | 미지                                                        | 왜 못 채웠나                                     | 누가 답할 수 있나 |
| --- | ----------------------------------------------------------- | ------------------------------------------------ | ----------------- |
| 1   | **버전별 활성 설치 수** (2단계 롤오버 판단에 필요)          | 텔레메트리 접근 권한 없음                        | 백엔드/데이터     |
| 2   | GitHub 결제 실패 원인 (카드 만료 vs spending limit)         | Billing 은 API 로 안 보이고 `user` 스코프도 없음 | 사장님            |
| 3   | `MAC_CSC_LINK` 등 시크릿 **원본** 보유 여부                 | 시크릿 값은 원리상 읽을 수 없음                  | 사장님            |
| 4   | Team 플랜 "첫 12개월 $4" 프로모션의 정확한 조건             | 결제 화면에서만 확인 가능                        | 사장님            |
| 5   | `MERGE_HISTORY_WEBHOOK_URL` 수신 서버가 org 변경을 견디는지 | 수신처 미상                                      | 백엔드            |

---

## 부록 A — 검증에 쓴 명령 (재현용, 전부 읽기 전용)

```bash
# 저장소 현황
gh api repos/melocream/marblo --jq '{full_name,private,owner:.owner.login,owner_type:.owner.type}'
gh api repos/melocream/marblo-releases --jq '{full_name,private,default_branch}'
gh api repos/melocream/marblo/actions/secrets --jq '.total_count,(.secrets[].name)'
gh api repos/melocream/marblo/{keys,hooks,environments,collaborators}
gh api repos/melocream/marblo/branches/main/protection          # → 403 (Free 제약 확인)
gh api repos/melocream/marblo/traffic/clones                    # → 500 (이름 은퇴 임계값 판단)
gh api repos/melocream/marblo-releases/traffic/clones           # → 1
gh api "repos/melocream/marblo/actions/runs?created=>2026-08-14" --jq '.total_count'   # → 787

# CI 정지 원인
gh api repos/melocream/marblo/check-runs/<job_id>/annotations --jq '.[0].message'

# 자동업데이트 실측
cat /Applications/Marblo.app/Contents/Resources/app-update.yml
curl -sSL https://github.com/melocream/marblo-releases/releases/download/v3.0.22/latest-mac.yml
curl -sSL -o /dev/null -w '%{url_effective} %{http_code} %{num_redirects}\n' \
     -H 'Accept: application/xml'  https://github.com/creationix/nvm/releases.atom
curl -sSL -o /dev/null -w '%{url_effective} %{http_code} %{num_redirects}\n' \
     -H 'Accept: application/json' https://github.com/creationix/nvm/releases/latest
curl -sSL -o /dev/null -r 0-1024 -w '%{url_effective} %{http_code} %{num_redirects}\n' \
     https://github.com/cdr/code-server/releases/download/v4.133.0/code-server-4.133.0-amd64.rpm

# 이름 가용성
for n in marblo marblo-ai marblo-hq marbloapp usemarblo; do gh api users/$n --jq .type; done
```

## 부록 B — 출처

- GitHub Docs, _Transferring a repository_ — 따라오는 항목, 이름 은퇴 임계값(clone 100 / Actions 100), 리다이렉트 영구 삭제 조건, Free 플랜의 브랜치 보호 상실
- GitHub Docs, _GitHub's plans_ — Free org / Team 기능 차이
- github.com/pricing (2026-08-21 실측) — Free $0 / Team $4 per user·month / Enterprise $21
- GitHub Docs, _Billing — GitHub Actions_ — 러너 분당 단가, 스토리지 $0.25/GB·월
- `electron-updater@6.8.3` `out/providers/GitHubProvider.js`, `builder-util-runtime` `out/httpExecutor.js`
