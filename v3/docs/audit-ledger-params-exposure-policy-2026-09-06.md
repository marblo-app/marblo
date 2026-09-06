# 감사 원장 `params` 노출 정책 — 무엇이 안전하게 보여도 되는가

- 티켓: `yJLfoRpqvCcvarIXcT23` (선행 판정: `Ciriq5ASEvAlA8TnKxhW`)
- 날짜: 2026-09-06
- 대상: `audit_logs` 컬렉션의 `params` 필드
- 독자: ★**분석 페이지에서 원장을 노출할 담당자**가 이 문서의 화이트리스트를 기준으로 쓴다.

## 0. 한 줄

원장을 **감추는** 정책이 아니다. 원장에서 **무엇이 안전하게 보여도 되는지 선을 긋는** 정책이다.

## 1. 무엇이 문제였나

`ledger.ts` 가 `params: input.params` 로 툴 인자 **원문**을 그대로 기록했다. 툴 인자에는 지시문·경로·티켓 본문이 그대로 들어오고 거기 자격증명이 섞일 수 있다.

`src/types/audit.ts` 는 그 필드에 "★감사 뷰는 이 필드를 화면에 뿌리지 않는다"고 **주석으로** 적어 뒀지만, 구현 세 곳이 정확히 그것을 뿌리고 있었다:

| 위치                                            | 무엇을                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `AuditTimeline.tsx`                             | `JSON.stringify(log.params)` 전문                                |
| `ProjectAuditRow.tsx` / `projectAuditView.ts`   | `evidence.paramsJson`, 그리고 클릭 없이 항상 보이는 detail 한 줄 |
| `ActivityStreamPanel` / `activityFormatters.ts` | `params.message` · `comment` · `description` · `initial_prompt`  |

★**계약이 주석에만 있고 테스트가 없어서 구현이 갈라진 경우다.** 그래서 이번 수리의 절반은 그 계약을 테스트로 옮기는 일이다.

## 2. 왜 룰(firestore.rules)로 못 고치나 — 다시 파지 마라

선행 티켓 `Ciriq5ASEvAlA8TnKxhW` 가 이미 판정했고 `firestore.rules` 의 `audit_logs` 블록에 전문이 남아 있다. 요지:

- Firestore 에는 **필드 단위 read 게이팅이 없다.**
- 컬렉션을 통째로 owner/admin 으로 조이면 `ActivityStreamPanel`(일반 멤버의 액티비티 스트림)이 죽는다.
- 한 컬렉션을 필드별로 다른 등급으로 게이팅하는 것도 불가하다 — 쿼리 결과의 **모든** 문서가 통과해야 쿼리가 허용된다.

★**이 티켓에서도 룰은 한 글자도 바꾸지 않았다.** 주석만 "별건이 처리됐다"로 갱신했다.

## 3. 두 층으로 고쳤다

### 3.1 write — 화이트리스트 (블랙리스트 금지)

`electron/mcp-server/ledger.ts` 의 `projectParamsForLedger()`. 새 문서에는 화이트리스트를 통과한 것만 들어간다.

★**블랙리스트가 아닌 이유**: 새 툴이 새 키를 들고 오는 순간 블랙리스트는 조용히 샌다. 여기서는 **모르는 키가 기본적으로 버려지고**, 싣고 싶으면 사람이 목록에 명시적으로 추가해야 한다.

문서에는 세 필드가 새로 붙는다:

| 필드            | 뜻                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `paramsPolicy`  | 어느 정책으로 걸러졌는가. 현재 `"whitelist-v1"`. ★**이 필드가 없으면 정책 이전 원문 문서다.**                   |
| `paramsOmitted` | 떨어진 최상위 키 **이름**들. 값은 담지 않는다.                                                                  |
| `paramsHash`    | 인자 **원본** 전체의 해시. 원문은 못 봐도 "무엇이 넘어갔는지"는 대조할 수 있다(`instructionHash` 와 같은 취지). |

같은 정책을 지나는 다른 write 경로: 스풀 tombstone(`ledger-spool.ts`), 미션 미러(`mission-engine/store-impl.ts`). 둘 다 `sealLedgerParams()` 를 쓴다 — ★원장에 쓰는 문이 여러 개인데 한쪽에만 자물쇠를 달면 그 문으로 샌다.

### 3.2 read/화면 — 정책 표식 게이트

★**write 를 고쳐도 기존 문서에는 원문이 이미 남아 있다. 그리고 원장은 불변이라 지울 수 없다.** (아래 §5)

`src/lib/auditParamsPolicy.ts` 의 `displayableLedgerParams()` 가 화면으로 나가는 유일한 문이다:

- `paramsPolicy` 가 박힌 문서 → **그대로**. write 가 이미 한 일을 두 번 하지 않는다.
- 표식이 **없는** 옛 문서 → **1등급 키만**, 그것도 값이 식별자 모양일 때만. 자유 텍스트(2등급)는 옛 문서에서는 원문이므로 통과시키지 않는다. ★여기서 마스킹으로 때우지 않는 이유: **반쯤 가린 원문이 가장 나쁘다.**

화면은 걷어냈다는 사실을 말한다(`project.audit.detail.paramsWithheld`). ★조용히 비우면 감사 뷰가 반대 방향으로 거짓말한다 — "인자가 없었다"와 "인자를 못 싣는다"는 조사 시 취할 조치가 다르다.

## 4. ★안전하게 보여도 되는 필드 목록 (분석 페이지 기준)

권위본은 `electron/mcp-server/ledger.ts`, 렌더러 사본은 `src/lib/auditParamsPolicy.ts`. 두 벌이 갈라지는 것은 `tests/unit/audit-params-display-guard.test.ts` 의 드리프트 가드가 잡는다.

### 4.0 ★이 목록은 **상한**이지 하한이 아니다

여기 있다는 것은 "**보여도 된다**"이지 "**보여야 한다**"가 아니다. 화면마다 더 조여도 되고, 조인 채로 착지한 선례가 이미 있다:

- **분석 페이지 실행 원장**(`6X5zmTY5OUKI4Sxwufqo`, #1492, 머지됨) — `buildExecutionLedger` 가 원장에서 읽는 필드는 **`taskId` · `model` 둘뿐**이다. 2등급 자유 텍스트는 물론 `instructionRedacted` 조차 행에 싣지 않는다. ★이 정책과 충돌하지 않는다 — 둘 다 이 문서의 1등급 안에 있는 **진부분집합**이다.
- **5단 드릴다운**(`wFp2qlIslpjSG87f0zio`, #1497) — `model`(1등급) + `cost_logs` 축(`actor_kind`/`costUsd`/`tokens`)만. 자유 텍스트 0필드.

★그러니 새 화면이 이 목록 전체를 그릴 이유는 없다. **자기 화면이 실제로 필요한 최소 집합**을 고르고, 그게 이 목록 **안에** 있는지만 확인하면 된다. 목록 밖의 필드가 필요해지면 §8 절차를 밟는다.

### 1등급 — 식별자·열거값 (원문 그대로. 옛 문서에서도 보여도 된다)

기준: **값이 저엔트로피 식별자/열거값인가.** 사람이 자유롭게 타이핑하는 칸은 여기 두지 않는다.

`task_id` `taskId` `after_task_ids` `after_item_ids` `project_id` `agent_id` `agent_name` `target_agent_id` `mission_id` `item_id` `file_id` `event_id` `flow_id` `page_id` `pane_id` `message_id` `instruction_id` `question_id` (및 각각의 camelCase) · `role` `status` `kind` `priority` `model` `spawned_model` `tier` `complexity` `effort` · `limit` `offset` `blocking` `force` `reopen` `all_projects` `dependsOnPrevious` `success` · `from` `to` `previous` `start` `end` `sourceType` · `pr` `pr_url` `url` · 시스템 계수 칸(`droppedCount` `maxBytes` 등)

★**키 이름만으로는 부족하다.** `to` 는 `update_task_status` 에서는 상태값이지만 `mail_send` 에서는 **수신자 메일 주소**다. 그래서 값 검사가 실제 안전망이다: 120자 초과 · 메일/전화/JWT/자격증명 URL/API 키 패턴 검출 · 마스킹이 필요한 값 → **전부 버린다.** 식별자에 마스킹이 필요하다는 것 자체가 그 칸이 식별자가 아니라는 증거다.

### 2등급 — 표시용 자유 텍스트 (★레드액트본만. 옛 문서에서는 보여주지 않는다)

`instructionRedacted` 와 **같은 파이프라인**을 지난다: 시크릿/PII/경로 마스킹 → 200자 절단 → 잔존 탐지에 걸리면 그 키를 통째로 버림.

`title` `name` `description` `summary` `message` `comment` `question` `answer` `reason` `note` `text` `what` `why` `done_when` `context` `changes` `approach` `problem` `verification` `keyword` `query` `goal` `subject` `scope` `location` `tags` `tasks` `nodes` `edges`

### ★목록에 **없는** 것과 그 이유

| 키                                                     | 왜 안 싣나                                                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instruction` `instructions` `prompt` `initial_prompt` | 지시문의 자리는 `instructionHash` + `instructionRedacted` 다. params 로 두 벌 두면 한쪽만 고쳐지는 순간 갈라진다 — 이 티켓이 정확히 그 모양의 사고다. |
| `body`                                                 | 메일 본문. "무엇을 보냈나"는 `subject` 로 충분하고, 본문은 외부로 나간 벌크 콘텐츠라 원장에 눕힐 이유가 없다.                                         |
| `value`                                                | 설정 값. 이름만으로 비밀 여부를 알 수 없다.                                                                                                           |
| 그 외 전부                                             | 화이트리스트의 정의상 기본이 **버림**이다.                                                                                                            |

## 5. ★기존 문서의 원문은 못 지운다 — 명시

- `audit_logs` 는 **불변 원장**이다. `firestore.rules` 는 `delete: if false` 이고 `update` 는 L1.6 멱등 재시도(동일 페이로드)만 허용한다. 문서를 고쳐 쓰면 그 자체가 증거의 오염이다.
- 따라서 이 수리는 ★**앞으로 쌓이는 문서에만** 적용된다. `paramsPolicy` 가 없는 기존 문서의 `params` 원문은 **그대로 남아 있고, 지울 수 없다.**
- 그 원문의 노출 범위는 여전히 **프로젝트 멤버 경계까지**다(크로스테넌트는 L2 가 닫아 뒀다). 직접 Firestore 쿼리를 던지는 멤버에게는 보인다 — ★**화면 게이트는 화면만 막는다.** 이건 룰로 못 고친다(§2).
- 그래서 분석 페이지는 반드시 `displayableLedgerParams()` 를 지나야 한다. 옛 문서의 `params` 를 직접 읽어 그리면 이 정책이 무효가 된다.

## 6. ActivityStreamPanel 은 왜 다르게 다루나

이 패널은 옛 문서가 대부분인 **상시 스트림**이다. 감사 뷰처럼 표식 없는 문서의 자유 텍스트를 끊으면 패널이 통째로 죽는다 — 선행 티켓이 못 박은 회귀 금지선이 정확히 그것이다.

그래서 여기는 두 겹으로 간다:

1. 애초에 **키 화이트리스트로만** 읽는다(`activityFormatters.ts` 는 raw dump 를 하지 않는다).
2. 꺼낸 값을 **표시 직전에 스크럽**한다(`str()` 한 함수가 그 초크포인트다 — 새 필드를 꺼내도 자동으로 걸린다).

★타협인 것을 명시한다: 옛 문서의 산문 자체는 여기서 여전히 보인다. 제거되는 것은 자격증명·PII·경로다. 이 패널까지 완전히 막으려면 패널을 죽이거나 별도 티켓으로 다뤄야 한다.

## 7. 무엇이 이 계약을 지키나 (테스트)

| 파일                                                   | 무엇을 고정하나                                 | 가드를 끄면     |
| ------------------------------------------------------ | ----------------------------------------------- | --------------- |
| `tests/unit/ledger-params-whitelist.test.ts`           | 원문이 새 원장에 안 들어간다                    | **12건 red**    |
| `tests/unit/audit-params-display-guard.test.ts`        | 화면이 옛 문서 원문도 안 뿌린다 + 상수 드리프트 | **8건 red**     |
| `tests/unit/audit-timeline-params-guard.test.ts`       | AuditTimeline 실제 렌더                         | (위 8건에 포함) |
| `tests/unit/project-audit-row-params-withheld.test.ts` | 보류 사실을 화면이 말한다                       | —               |
| `tests/unit/mission-audit-mirror-params.test.ts`       | 원장의 두 번째 문도 같은 정책                   | —               |
| `tests/unit/activity-formatter-params-scrub.test.ts`   | 스트림 패널 표시 스크럽                         | **2건 red**     |
| `tests/unit/mcp-ledger-spool.test.ts`                  | 스풀 tombstone 도 정책 표식을 박는다            | —               |

## 8. 정책을 바꿀 때

1. `electron/mcp-server/ledger.ts` 의 목록을 고친다(권위본).
2. `src/lib/auditParamsPolicy.ts` 의 사본을 같이 고친다. 드리프트 가드가 안 고치면 빨개진다.
3. **의미**를 바꿨다면 `LEDGER_PARAMS_POLICY` 문자열도 올린다 — 그래야 뷰가 옛 정책 문서를 옛 정책으로 다룰 수 있다.
4. 이 문서의 §4 표를 갱신한다.
