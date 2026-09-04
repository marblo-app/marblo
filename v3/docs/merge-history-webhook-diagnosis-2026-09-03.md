# Merge History Webhook 진단 — 2026-09-03

## 배경

`Merge History Capture` 워크플로(`.github/workflows/merge-history.yml`)가 PR 머지 시
`MERGE_HISTORY_WEBHOOK_URL` / `MERGE_HISTORY_WEBHOOK_TOKEN` GitHub 시크릿을 이용해
Cloud Function 으로 머지 이력을 전송한다. 이 파이프라인은 Mission Replay(완료이력 탭)의
데이터 소스다:

```
Actions (merge-history.yml) → Cloud Function → Firestore merge_history
    → mergeHistoryService / MergeHistoryEntry (v3/src/types/mergeHistory.ts)
    → 완료이력 탭 Mission Replay
```

PR #1391 에서 전송을 `github-script`/`fetch` 로 바꾼 뒤 `TypeError: Failed to parse
URL from ***` 가 관측됐다 — 즉 `MERGE_HISTORY_WEBHOOK_URL` 시크릿 값이 URL 형식이
아니다. PR #1394 로 전송 실패가 non-blocking skip 이 되어 `record` 체크는 초록이지만,
실제 Firestore 기록은 일어나지 않는다 (`core.warning` 만 남음).

## 수신측 Cloud Function

- **함수명**: `recordGitHubMergeHistory`
- **위치**: `v3/functions/src/index.ts:856` (도입 커밋 `f61ae375`, #566, 2026-07-22)
- **SDK**: `firebase-functions` v1 (`functions.https.onRequest`), region 지정 없음 →
  기본 리전 `us-central1`
- **Firebase 프로젝트**: `marblo-2253d` (`v3/.firebaserc`)
- **1st-gen 함수의 표준 URL 패턴**: `https://<region>-<project-id>.cloudfunctions.net/<function-name>`

## 배포 상태 — 실측 확인됨 (인증 없이 HTTP 프로브로 확인)

`gcloud`/`firebase` 프로젝트 자격 증명 없이도, 배포된 1st-gen 함수는 인증 헤더가
없거나 틀려도 HTTP 로 응답하므로 **소스코드의 분기 로직과 실측 응답을 대조**해
배포 여부를 확인했다:

| 요청 | 응답 | 소스 대조 |
| --- | --- | --- |
| `GET https://us-central1-marblo-2253d.cloudfunctions.net/recordGitHubMergeHistory` | `405`, header `Allow: POST`, body `Method Not Allowed` | `index.ts:858-859` 의 메서드 가드와 정확히 일치 |
| `POST` (Authorization 헤더 없음) | `401 {"ok":false,"error":"unauthorized"}` | `index.ts:873-876` 의 인증 실패 분기와 정확히 일치 |
| `POST` (`Authorization: Bearer <임의값>`) | `401 {"ok":false,"error":"unauthorized"}` | 동일 — 토큰 불일치 시 응답 |

→ **함수는 배포돼 있다.** 503 `webhook_not_configured` 가 아니라 401 이 왔다는 것은
Cloud Function 쪽 `GITHUB_MERGE_HISTORY_WEBHOOK_TOKEN` 환경변수도 **비어있지 않게
설정돼 있다**는 뜻이다 (`index.ts:863-869` 참고 — 토큰 미설정이면 503).

## ★사장님이 넣을 정확한 값

```
MERGE_HISTORY_WEBHOOK_URL = https://us-central1-marblo-2253d.cloudfunctions.net/recordGitHubMergeHistory
```

앞뒤 공백·trailing slash 없이 그대로 붙여넣으면 된다. 이 값은 공개 정보(배포된
HTTPS 함수의 URL)이므로 여기 남겨도 안전하다.

## TOKEN 형식 확인

- 워크플로가 보내는 헤더: `Authorization: Bearer <secrets.MERGE_HISTORY_WEBHOOK_TOKEN>`
  (`.github/workflows/merge-history.yml`)
- 함수가 기대하는 헤더: `Authorization: Bearer <GITHUB_MERGE_HISTORY_WEBHOOK_TOKEN>`
  (`index.ts:871-876`)
- **형식은 일치한다** (둘 다 `Bearer <token>` 스킴).
- 다만 GitHub 시크릿에 저장된 TOKEN **값 자체**가 Cloud Function 배포 시 설정한
  값과 실제로 같은지는 이 조사로는 확인 불가 — 두 값 모두 마스킹돼 있어 직접 비교할
  방법이 없다. 이번 장애의 실측 증거(`TypeError: Failed to parse URL`)는 URL 쪽
  문제만 가리키고 있어 TOKEN 은 정상일 가능성이 높지만, URL 을 고친 뒤 다음 머지에서
  실제로 `200`(`Merge history recorded`)이 찍히는지 확인이 필요하다. 만약 URL 수정
  후에도 `401`이 뜨면 TOKEN 값도 재발급/재확인이 필요하다는 뜻이다.
- 참고: `v3/functions/scripts/check-deploy-env.mjs` 의 `REQUIRED_KEYS` 에
  `GITHUB_MERGE_HISTORY_WEBHOOK_TOKEN` 은 포함돼 있지 않다 — 배포 게이트가 이 값의
  누락을 막아주지 않으므로, 향후 재배포 시 실수로 비워지지 않도록 별도 확인이 필요하다.

## 7/22 이후 유실 이력 — 소급 가능성 판단 (실행 안 함)

**가능하다고 판단한다.** 근거:

1. `recordGitHubMergeHistory` 는 **멱등**하다 — `mergeDocId = github_<owner>_<repo>_<prNumber>`
   로 Firestore transaction 안에서 문서 존재 여부를 확인 후 `tx.create` 하므로, 같은
   PR 을 여러 번 보내도 중복 기록되지 않는다 (`index.ts:927-957`). 재전송 스크립트가
   최근 정상 기록분과 겹쳐도 안전하다.
2. 필요한 입력(`prNumber`, `taskId`/`taskId8`, `mergedAt`, `branch`, `baseRef`,
   `headSha`, `owner`, `repository`, `filesChanged`, `linesAdded`, `linesDeleted`,
   `paths`)은 모두 GitHub REST API(`pulls.list` + `pulls.listFiles`, 워크플로가
   쓰는 것과 동일한 API)로 과거 merged PR 에서 재구성 가능하다.
3. 워크플로의 branch 패턴 파싱(`^marblo\/[^/\s]+-([A-Za-z0-9]{8})$`)과 동일한 필터를
   과거 PR 목록에 적용하면 대상 PR 을 골라낼 수 있다.

**일회성 스크립트 스케치(실행 안 함, 판단만)**:
   - `gh api` 또는 GitHub REST API 로 `base=main`, `state=closed`, `merged=true`,
     머지일 `>= 2026-07-22` 인 PR 목록 조회
   - 브랜치명이 위 정규식에 매칭하는 것만 필터
   - 각 PR 에 대해 `pulls.listFiles` 로 diff stat 을 모아 워크플로와 동일한 payload
     구성
   - 수정된 `MERGE_HISTORY_WEBHOOK_URL` 로 `Authorization: Bearer <TOKEN>` 헤더와
     함께 POST — 이미 기록된 PR 은 함수가 `already_recorded` 로 스킵하므로 안전

   전제 조건: (a) 시크릿 URL 수정 완료, (b) TOKEN 값이 유효함이 먼저 확인됨,
   (c) 스크립트 실행 권한(GitHub API read + CF 엔드포인트 네트워크 접근)이 있는 곳에서
   실행. 실행은 이 티켓 범위 밖 — 별도 작업으로 진행 권장.

## 다음에 또 깨지면 여기를 본다

1. `gh secret list` 로 `MERGE_HISTORY_WEBHOOK_URL`/`MERGE_HISTORY_WEBHOOK_TOKEN`
   등록 여부만 확인 (값은 안 보임).
2. `curl -X POST https://us-central1-marblo-2253d.cloudfunctions.net/recordGitHubMergeHistory`
   로 함수 배포 여부를 인증 없이도 확인 가능 — `405`(GET) / `401`(POST, 인증 없음)이
   오면 배포돼 있고 TOKEN 도 설정된 것. 연결이 아예 안 되거나 5xx/DNS 에러면 미배포나
   인프라 문제.
3. 워크플로 실행 로그(`Send merge history` 스텝)의 `core.warning`/`core.info` 메시지가
   1차 단서 — `Failed to parse URL` 이면 URL 값 문제, `HTTP 401`이면 TOKEN 값 문제,
   `HTTP 4xx/5xx` 기타면 함수 쪽 로직/쿼터 문제.
4. Cloud Function 로그(`recordGitHubMergeHistory`)에서 `[recordGitHubMergeHistory]
   webhook token is not configured` 가 보이면 CF 환경변수 쪽 유실.
5. 함수 소스: `v3/functions/src/index.ts:856-1000` 부근.
   워크플로: `.github/workflows/merge-history.yml`.
