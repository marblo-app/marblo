# Google Drive 커넥터 MVP — 설계 노트

티켓: `zqNxS9904aeeBEug1uAD` · 후속 에픽(지식위키 · 헤르메스형 비서)의 **선행 기반**

이 문서는 "왜 이렇게 만들었나" 를 남긴다. 무엇을 하는지는 코드 머리주석에 있다.

---

## 1. 첫 갈림길 — 증분 추가인가, 별도 플로우인가

**결론: 같은 OAuth client · 별도 동의 시점 (= OAuth 의미의 incremental authorization).**

로그인에 Drive 스코프를 얹지 않은 이유는 셋이다.

1. **로그인 경로는 토큰을 저장하지 않는다.** `runGoogleLoopbackOAuth` 가 받은
   `id_token` 은 렌더러가 `signInWithCredential` 에 한 번 쓰고 버리고,
   `refresh_token` 은 읽지도 않는다. Drive 는 앱이 나중에 혼자 파일을 읽어야
   하므로 장기 `refresh_token` 보관이 필수 — 그 경로를 그대로 못 쓴다.
2. **최소권한.** 로그인 시점에 Drive 동의를 끼우면 Drive 를 안 쓰는 사용자까지
   "내 드라이브 전체 읽기" 화면을 본다. 로그인 전환율에도 직접 손해다.
3. **복구 경로가 필요하다.** 사용자가 구글 계정 설정에서 권한을 철회하면 Drive 만
   다시 연결할 수 있어야 한다. 로그인과 묶으면 재로그인을 강요하게 된다.

그래도 OAuth 의 incremental authorization 규약은 지킨다 — 같은 client id 로 2차
authorize 를 하면서 `include_granted_scopes=true` 를 붙인다. 이미 부여된 스코프를
다시 묻는 화면이 뜨지 않는다. `login_hint` 로 계정 선택도 건너뛴다.

**OAuth client 는 앱 전체 단일 등록 그대로다.** `write-oauth-config.mjs` 가
`build-resources/oauth-config.json` 에 굽는 `clientId`/`clientSecret` 을 로그인과
Drive 가 공유한다 — 새로 등록할 client 도, 새 빌드 스크립트도 없다.

## 2. loopback 경로 준수

dev·패키지 양쪽에서 `signInWithRedirect` 는 Electron 에서 조용히 멈춘다
(`google-oauth.ts` 머리주석의 실측 이력). 그래서 Drive 동의도 **시스템 브라우저 +
`127.0.0.1` 루프백 + PKCE(S256) + `state`**(RFC 8252) 하나로만 간다. 앱 창은 절대
navigate 하지 않으므로 터미널·에이전트 상태가 보존된다.

구현상 `google-oauth.ts` 의 루프백 엔진을 `runGoogleLoopbackAuthorization` 으로
추출해 로그인과 Drive 가 **같은 코드**를 쓴다. 로그인 쪽 동작(스코프·prompt·반환
형태)은 그대로다.

## 3. 스코프 — `drive.readonly`

`drive.file` 은 "앱이 만들었거나 피커로 연 파일" 만 보인다. 지식위키는 **사용자가
이미 갖고 있는** 문서를 읽어야 하므로 목적을 달성할 수 없다. 그래서
`drive.readonly` 로 시작한다. 쓰기 스코프는 이 앱 어디에도 없다.

> ### ⚠️ 운영 리스크 — restricted scope
>
> `drive.readonly` 는 Google 분류상 **restricted scope** 다. 앱을 프로덕션(외부
> 공개)으로 올리려면 OAuth 검증 + **CASA 보안평가**가 필요하다. OAuth consent
> screen 이 `Testing` 상태인 동안(테스트 사용자 100명)에는 그대로 동작하므로
> MVP·도그푸딩에는 문제가 없다. **외부 출시 전 별도 트랙으로 반드시 다룰 것.**

`openid email` 을 함께 요청한다 — 연결된 계정을 UI 에 보여주고 재동의 때
`login_hint` 로 쓰기 위해서다. 둘 다 로그인에서 이미 부여된 non-sensitive
스코프라 동의 화면이 늘어나지 않는다.

## 4. 토큰 보관

`~/.marblo/google-drive-oauth.enc.json` (0600). Electron `safeStorage`
(macOS Keychain / Windows DPAPI / Linux libsecret)로 **크레덴셜 세트 전체를 한
덩어리로 암호화**한다. 암호화가 불가능하면 평문으로 떨어지지 않고 throw 한다
(`vendor-secrets` 와 같은 P0-4 규율).

`vendor-secrets` 저장소를 쓰지 않은 이유: 그쪽은 모델 레지스트리가 `${...}` 로
참조하는 env 키 이름만 받는 allowlist 구조라 OAuth 토큰 세트가 들어갈 자리가
아니다. `github-token-store` 와 같은 층에 형제로 뒀다.

**평문 반환 창구는 `getGoogleDriveTokens` 하나**이고 호출자는 `google-drive-auth`
뿐이다. IPC·UI·로그가 쓰는 `googleDriveConnectionStatus` 에는 이메일·스코프·
연결시각만 있고 토큰 값이 없다. 로그에는 마스킹된 값조차 남기지 않는다.

## 5. 커넥터 — 중립 반환형이 유일한 계약

```
DriveDocument { id, title, mimeType, text, extraction, truncated, ... }
```

후속 위키/비서가 Drive API 모양에 결합되지 않도록 여기서 끊는다. 인덱스 저장소·
위키 UI·비서 에이전트는 **이 티켓에 없다**(후속 에픽).

본문 취득 전략:

| 대상                     | 방법                                  | `extraction`  |
| ------------------------ | ------------------------------------- | ------------- |
| Google Docs / Slides     | `files.export` → `text/plain`         | `export`      |
| Google Sheets            | `files.export` → `text/csv` (첫 시트) | `export`      |
| 텍스트 계열 일반 파일    | `files.get?alt=media`                 | `download`    |
| PDF (텍스트 레이어 있음) | `alt=media` + 자체 추출기             | `pdf`         |
| PDF (스캔본)             | 〃 (텍스트 없음)                      | `pdf-no-text` |
| 이미지·동영상·도면·폴더  | 받지 않는다                           | `unsupported` |

★ 본문이 비는 두 경우를 "빈 문서" 로 뭉개지 않고 `extraction` 값으로 **이유를
드러낸다**. 조용한 빈 본문은 후속 인덱서가 "읽었는데 내용이 없다" 로 오인한다.

**googleapis SDK 를 도입하지 않았다.** REST 엔드포인트 3개면 충분하고, SDK 는 앱
번들과 `dist-mcp` esbuild 번들을 수 MB 불린다. 순수 `fetch` 라 **의존성 추가가
0** 이다(`package.json` 무변경, `dist-mcp` 번들 검증 완료).

PDF 도 같은 이유로 `pdf-parse`/`pdfjs-dist` 대신 node 내장 `zlib` 만 쓰는 최소
추출기를 뒀다(`pdf-text-extract.ts`). 한계는 그 파일 머리주석에 정직하게 적혀
있다 — 스캔본 OCR·암호화 PDF·비표준 CID 인코딩은 지원하지 않는다.

## 6. 경계와 노출면

```
렌더러 ──IPC(drive:*)──┐
                       ├─→ main ─→ google-drive-auth ─→ safeStorage 저장소
MCP 도구 ──HTTP──→ bridge ┘                          └─→ google-drive-connector ─→ Drive REST
(drive_search/drive_fetch)
```

- **MCP 프로세스는 OAuth 토큰을 보지 않는다.** 브리지가 main 을 대신 두드리고
  결과(중립형)만 돌려준다. MCP 프로세스가 탈취돼도 Drive 자격증명은 안 샌다.
- 브리지는 검색 조건을 **통과시키지 않고** 커넥터의 쿼리 빌더가 받는 형태로
  좁힌다 — MCP 클라이언트가 임의의 Drive `q` 문자열을 밀어 넣을 수 없다.
- 쿼리 값은 `escapeDriveQueryValue` 로 이스케이프한다(홑따옴표 하나로 쿼리 절이
  주입되는 것을 막는다 — 유닛테스트에 회귀 케이스가 있다).
- `drive_search`/`drive_fetch` 는 워커 역할 스코핑
  (`tool-surface.ts`)의 화이트리스트에 **넣지 않았다** — 지금은 오케스트레이터급
  /full 표면 세션에만 보인다. 비서 에이전트의 역할이 정해지는 후속 에픽에서
  그 역할에 추가하면 된다.

## 7. 사용자 uid 규율

Drive 자격증명은 **Marblo 사용자 uid 별로** 저장된다(한 머신을 여러 계정이 쓸 수
있다). 렌더러 호출은 uid 를 명시로 넘기고, 창이 없는 경로(브리지 → MCP 도구)는
`currentRealUserUid()` 로 지금 로그인된 실사용자를 쓴다. **익명 uid 는 절대
쓰지 않는다** — 익명 uid 로 저장소를 찾으면 매번 다른 칸을 보게 되고, 그건
"연결이 안 된다" 는 유령 버그로 나타난다.

## 7.5 ★두 개의 축 — 인증(유저) vs 지식 바인딩(프로젝트)

_티켓 MCTHALmNAWPpilTFwe8o 에서 추가._

Drive 연결에는 수명도 주인도 다른 **두 축**이 있고, 이 둘을 섞으면 위키가
성립하지 않는다.

| 축 | 단위 | 저장소 | 바꾸면 영향 |
| --- | --- | --- | --- |
| 인증(OAuth 토큰) | **유저** | `google-drive-token-store.ts` (safeStorage 암호화) | 모든 프로젝트 |
| 지식 바인딩(위키 폴더) | **프로젝트** | `drive-project-binding.ts` (로컬 JSON, 0600) | 그 프로젝트만 |

한 레코드에 섞었다면 프로젝트를 늘릴 때마다 재동의가 필요하거나, 반대로 모든
프로젝트가 같은 폴더를 보게 된다. 그래서 저장소부터 갈라 놓았다.

### 두 개의 호출 경로

```
렌더러 IPC (drive:search, scope 미지정)  → 스코프 없음  ← 사람이 폴더를 고르는 화면
브리지 → MCP (drive_search/drive_fetch) → 항상 프로젝트 스코프 ← 에이전트
```

- **폴더 피커는 스코프가 없다.** 아직 바인딩이 없는 상태에서 자기 드라이브를
  훑어 위키 폴더를 골라야 하므로, 여기에 스코프를 걸면 아무것도 고를 수 없다.
  사람이 자기 눈으로 자기 드라이브를 보는 것이라 경계가 필요 없다.
- **에이전트 경로는 항상 스코프가 있다.** `DriveGateway.search/fetch` 의 첫
  인자가 `projectId` 인 것은 의도적이다 — 선택 인자로 두면 빼먹은 호출이 조용히
  "드라이브 전체" 가 된다. 바인딩이 없으면 조회 자체를 거절하고 "폴더를 먼저
  고르라" 고 답한다. ★미바인딩을 "전체 허용" 으로 해석하지 않는다.
  (이는 #938 MVP 대비 **의도된 동작 변경**이다: 그때는 에이전트가 드라이브
  전체를 봤다.)

### 경계 집행 (`drive-scope.ts`)

- `drive_search`: `in parents` 는 직계 자식만 매칭하므로, 바인딩 폴더의 하위
  폴더를 BFS 로 펼쳐(폴더 50개·깊이 10 상한 — 상한은 취향이 아니라 GET 쿼리스트링
  길이 산수다) 부모 OR 절로 넘긴다. 상한/권한
  때문에 다 펼치지 못하면 `truncated` 로 드러내고 도구가 그 사실을 문장으로
  말한다 — "검색해서 없었다" 와 "범위 밖이라 안 봤다" 는 다른 결론이다.
- 호출자가 `folder_id` 를 지정하면 **그 폴더가 바인딩 폴더 하위인지 검증**한다.
  없으면 스코프 우회 통로가 된다.
- `drive_fetch`: id 만으로는 소속을 알 수 없으므로 `parents` 를 타고 올라가
  바인딩 폴더를 만나는지 확인한다(조상 못 읽음 = 통과 안 됨, fail-closed).
- 폴더트리·조상 판정은 TTL 5분 캐시. 바인딩 변경·연결/해제 시 즉시 버린다.

### 경계의 한계 — projectId 는 자기신고다

브리지의 `projectId` 는 MCP 프로세스가 요청 본문에 실어 보내는 값이고, 브리지
베어러 토큰은 **세션 단위로 모든 에이전트가 공유**한다(`MARBLO_BRIDGE_TOKEN`).
따라서 셸을 쓸 수 있는 에이전트는 원리상 `curl` 로 다른 projectId 를 주장할 수
있다. 이는 이 커넥터만의 문제가 아니라 **모든 프로젝트 스코프 브리지 라우트가
공유하는 신뢰 모델**이라 여기서 새로 생긴 취약점은 아니지만, 위 "교차 오염 없음"
은 *정상 경로의 에이전트*에 대한 보장이지 악의적 에이전트에 대한 격리가 아니라는
점을 분명히 해 둔다. 진짜 격리는 브리지 토큰을 에이전트/프로젝트 단위로 쪼개는
별도 작업이며, 그때 이 라우트도 자동으로 이득을 본다.

### 연결 UI

`Harness 탭 → 연동 섹션 → Google Drive 위키`(`DriveConnectionPanel.tsx`,
Slack/Telegram 패널과 같은 자리·같은 형태). 위 절반이 유저 축(계정 연결·해제),
아래 절반이 프로젝트 축(위키 폴더 검색·지정·해제 + "범위 확인" 미리보기).
렌더러로 내려가는 값에 **토큰은 없다** — 연결 여부·이메일·스코프 이름뿐이다.

## 8. 이 티켓에 없는 것 (후속 에픽)

- 지식 인덱스 저장소 (임베딩·청킹·증분 동기화)
- 위키 브라우저 UI (연결·폴더 지정 화면은 MCTHALmNAWPpilTFwe8o 에서 붙었다)
- 헤르메스형 비서 에이전트
- 변경 감지(`changes.list` + `startPageToken`) 기반 증분 재인덱싱
- Sheets 다중 시트, DOCX/PPTX 등 오피스 포맷, OCR

## 9. 수동 검증 절차

**UI 경로 (권장).** Harness 탭 → 연동 섹션 → "Google Drive 위키":

1. **Google 계정 연결** — 시스템 브라우저가 열리고 동의 후 계정 이메일이 뜬다.
2. **폴더 찾기 → 이 폴더로 지정** — 이 프로젝트의 위키 폴더가 저장된다.
3. **범위 확인** — 에이전트가 보는 것과 같은 경로(`scope:"project"`)로 조회해
   그 폴더 범위의 문서 수를 보여준다.
4. 프로젝트를 바꾸면 위 절반(계정)은 그대로고 아래 절반(폴더)만 비어 있어야
   한다 — 그게 축이 분리돼 있다는 증거다.

**콘솔 경로 (진단용).**

```js
// 1) 동의 — 시스템 브라우저가 열린다
await window.electronAPI.drive.connect();
// 2) 상태 — 토큰은 안 나오고 이메일·스코프만 나온다
await window.electronAPI.drive.status();
// 3) 폴더 피커 조회(스코프 없음 — 사람이 고르는 경로)
await window.electronAPI.drive.search({ pageSize: 10 });
// 4) 이 프로젝트의 위키 폴더 지정 / 확인
await window.electronAPI.drive.binding.set({
  projectId: "<projectId>",
  folderId: "<folderId>",
  folderName: "팀 위키",
});
await window.electronAPI.drive.binding.get("<projectId>");
// 5) 에이전트와 같은 경로 — 바인딩 폴더 범위로만 나온다
await window.electronAPI.drive.search({
  scope: "project",
  projectId: "<projectId>",
  pageSize: 10,
});
// 6) 본문 (id 는 5번 결과에서). 범위 밖 id 는 거절된다.
await window.electronAPI.drive.fetch({
  scope: "project",
  projectId: "<projectId>",
  fileId: "<id>",
});
```

사전 조건: GCP 콘솔에서 해당 프로젝트의 **Google Drive API 활성화**. 안 켜져
있으면 커넥터가 `accessNotConfigured` 를 잡아 "콘솔에서 Drive API 를 활성화하라"
는 문구로 답한다(일반 권한 오류와 구분해서).

**electron main / preload 가 바뀌었으므로 앱 재시작이 필요하다.**
