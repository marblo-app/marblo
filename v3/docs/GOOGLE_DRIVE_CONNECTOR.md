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

## 8. 이 티켓에 없는 것 (후속 에픽)

- 지식 인덱스 저장소 (임베딩·청킹·증분 동기화)
- 위키 UI, Drive 연결 설정 화면 (지금은 IPC/preload 만 있고 버튼이 없다)
- 헤르메스형 비서 에이전트
- 변경 감지(`changes.list` + `startPageToken`) 기반 증분 재인덱싱
- Sheets 다중 시트, DOCX/PPTX 등 오피스 포맷, OCR

## 9. 수동 검증 절차 (UI 가 붙기 전)

설정 화면이 후속 티켓이라, 지금은 앱 DevTools 콘솔에서 직접 부른다.

```js
// 1) 동의 — 시스템 브라우저가 열린다
await window.electronAPI.drive.connect();
// 2) 상태 — 토큰은 안 나오고 이메일·스코프만 나온다
await window.electronAPI.drive.status();
// 3) 목록/검색
await window.electronAPI.drive.search({ pageSize: 10 });
// 4) 본문 (id 는 3번 결과에서)
await window.electronAPI.drive.fetch({ fileId: "<id>" });
```

사전 조건: GCP 콘솔에서 해당 프로젝트의 **Google Drive API 활성화**. 안 켜져
있으면 커넥터가 `accessNotConfigured` 를 잡아 "콘솔에서 Drive API 를 활성화하라"
는 문구로 답한다(일반 권한 오류와 구분해서).

**electron main / preload 가 바뀌었으므로 앱 재시작이 필요하다.**
