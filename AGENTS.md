# Marblo Rules

## Marblo MCP 워크플로우 (필수)

- 모든 작업 시작 전에 Marblo MCP로 관련 태스크를 확인할 것
- 새 작업이면 태스크 티켓을 먼저 생성할 것
- 작업 중간중간 `add_activity`로 진행 상황을 기록할 것
- 작업 완료 시 `update_task_status`로 상태를 변경할 것
- 프로젝트명은 기존 태스크와 일관되게 사용할 것

## Git 푸시 규약 (필수)

- Marblo 워크트리에서 푸시할 때는 원격 추론에 맡기지 말고 `git push origin HEAD`를 사용한다.
- `origin`을 확인할 수 없으면 다른 원격(예: 공개 미러)으로 폴백하지 말고 명확히 실패를 보고한다.

## 머지 판정 규율 (필수)

- 머지 전 `gh pr checks <PR>`로 `lint`·`verify`·`record`가 모두 `pass`인지 확인한다. `pending`은 `pass`가 아니므로 끝날 때까지 기다린다.
- 빨간 체크는 원인을 확인하기 전 머지하지 않는다. `--admin`은 사용하지 않으며, 불가피하면 사유를 먼저 기록한다.
- 로컬 검증은 사전점검일 뿐 판정 근거가 아니다. CI의 전체 Lint 단계와 CI 환경(Node 버전 포함)을 기준으로 완료 보고에 검증 환경과 실행 항목을 적는다.

로컬과 CI가 다를 수 있다: 로컬 `npm run lint`는 CI Lint 4스텝 중 ESLint만 실행할 수 있고, 기본 Node v26과 CI Node20에서 `navigator is not defined` 같은 결과가 달라질 수 있다.

## ★GUI 를 띄우는 검증 금지 (필수)

사장님이 이 저장소의 앱을 **실제로 쓰고 계신 동안** 에이전트가 검증하려고 Electron 창을 띄우면, 창이 떴다 꺼지기를 반복하며 사장님 작업을 방해한다. 2026-08-24 실제로 발생했고("계속 열렸다 끄는 게 뭐냐"), 오케가 실행 중이던 `playwright test` 를 강제 종료해야 했다.

- ❌ `playwright test` 로 Electron 앱 띄우기 (`launchMarblo`, `electron.launch`)
- ❌ 검증용 스크린샷 촬영
- ❌ 브라우저를 띄우는 확인

대신:

- ✅ `vitest` 단위·렌더 테스트 — 창이 안 뜬다. 대부분 여기서 증명된다.
- ✅ 순수 함수로 떼어내고 로직을 직접 테스트. 시간 의존 코드는 `now`/`setTimer` 주입 지점을 찾아 실시간 없이 돌린다.
- ✅ 타입체크·정적 분석·소스 계측

★실화면 확인이 **정말로** 필요한 지점에 도달하면, 직접 하지 말고 `ask_orchestrator` 로 보고한다. 오케가 사장님 일정에 맞춰 잡는다. "지금은 아니다" 가 기본값이다.

## 대규모 작업 (3개 이상 독립 단계)

1. Marblo MCP로 태스크 티켓을 먼저 생성 (`create_tasks_bulk`)
2. 병렬로 작업 가능한 것은 병렬로 진행
3. 각 단계마다 `add_activity`로 진행 상황을 티켓에 기록
4. 작업 완료 시 `update_task_status`로 상태 변경

## 지식위키 (공유 · `docs/wiki` 하나)

위키는 이 저장소의 `docs/wiki` 뿐이다. 형제 프로젝트에 위키를 만들지 말 것.
홈: `docs/wiki/README.md`. 노트 작성 `/wiki-note`, 커밋 전 `/wiki-ingest`.
조회는 `root_path` 를 반드시 `docs/wiki` 로 넘긴다 — 리포 루트로 ingest 하면 원본 문서가 위키로 빨려들어간다.

```
wiki_query({ root_path: "<MARBLO_CLONE>/docs/wiki", query: "..." })
```
