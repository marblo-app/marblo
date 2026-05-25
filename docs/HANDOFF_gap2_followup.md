# 핸드오프 — 마블로 갭 2/3 + 인프라 후속 작업

**작성일**: 2026-05-12
**이전 에이전트**: claude-opus-4-7
**다음 에이전트의 임무**: 아래 3개 TODO 티켓을 우선순위 순으로 진행

---

## 0. 30초 컨텍스트 복원

마블로 v3는 PTY로 격리된 이종 에이전트(Claude/Gemini/Codex)를 MCP 표준 프로토콜과 Firestore 태스크보드로 오케스트레이션하는 데스크탑 앱. 본 시리즈는 **팀 협업 시나리오의 cross-machine PTY 주입 갭**을 메우는 작업.

이전 세션에서 완료된 것:

- **갭 2 메인** (티켓 `ea0b28b3`, DONE): `pendingInstructions` Firestore 큐 + `PendingInstructionListener` + `targetAgentId` 기반 onSnapshot + `runTransaction` atomic flip. 팀챗 `@agent` fallback. TaskCard 활성 상태 dot + 오프라인 안내 + claim 회수 버튼. heartbeat 인프라. `firestore.rules.test.ts`에 7개 보안 규칙 테스트 추가.
- **갭 2 follow-up A/B/C** (티켓 `ec4e02f4`, DONE): MCP `add_pending_instruction`의 `task_id` 옵셔널, backend `VALID_TRANSITIONS`에 `CLAIMED → TODO` 추가, 팀챗 `@orchestrator` silent failure → system message 가시화.

타입체크는 모두 통과했고, Vitest는 사전부터 ESM 호환 이슈로 실행 불가 (티켓 `39e8a0db`에서 해결 예정).

상세 산출물은 갭 2 메인 티켓(`ea0b28b3`)의 add_activity 로그 + `docs/IP_amendment_request.md`(특허) 참고.

---

## 1. 남은 작업 3개 (추천 순서)

### 1순위 — `39e8a0db` Vitest ESM 호환 수리 (P2, devops)

**왜 먼저**: 가장 작고, 성공 시 firestore.rules.test.ts에 새로 추가한 pendingInstructions 7개 테스트를 실제 실행 가능. 갭 2 회귀 안전망 즉시 완성.

**증상**:

```
$ npx vitest run
Error [ERR_REQUIRE_ESM]: require() of ES Module
  .../node_modules/std-env/dist/index.mjs not supported.
  at .../node_modules/vitest/dist/config.cjs:4:14
```

**환경**: node 22.6.0, vitest 4.1.0, std-env (transitive)

**추천 시도 순서**:

1. `v3/vitest.config.ts` → `v3/vitest.config.mjs` 리네임. ESM 모드로 가면 std-env import 정상화 가능성.
2. 안 되면 `v3/package.json`에 `"type": "module"` 추가 후 영향 점검. 다만 marblo는 Electron + Vite + Next 혼재라 영향 클 수 있음.
3. 그래도 안 되면 std-env를 호환 버전으로 다운그레이드 (vitest 의존성이라 직접 핀 가능).
4. 마지막 수단: node를 20 LTS로 다운그레이드 (CI 영향 큼).

**완료 기준**:

- `npx vitest run --exclude '**/firestore.rules.test.ts'` 정상 실행
- 기존 `tests/unit/*.test.ts` 모두 통과
- (선택) `firebase emulators:start --only firestore` 띄우고 firestore.rules.test.ts 추가된 pendingInstructions 7개 테스트 실행 → 모두 통과 확인

### 2순위 — `32c301cb` git remote URL 기반 프로젝트 매칭 (P3, backend)

**왜**: 팀 온보딩 UX 갭. 팀원 A는 `~/repo/marblo`, B는 `~/Documents/projects/marblo`로 클론하면 folderPath 불일치로 자동 매칭 실패 → 수동 매핑 필요. git remote URL을 추가 매칭 키로 쓰면 해결.

**설계 요지**:

1. `v3/src/types/project.ts`의 `Project`에 `gitRemoteUrl?: string` 추가
2. 프로젝트 생성 시 Electron main에서 `git remote get-url origin` 결과 저장 (child_process)
3. `v3/src/services/projectService.ts` `findProjectByPath`를 확장하여 매칭 우선순위: ① gitRemoteUrl + members, ② folderPath + members
4. URL 정규화 함수 (`git@github.com:foo/bar.git` ↔ `https://github.com/foo/bar.git`, `.git` 접미사 제거)
5. non-git 폴더는 기존 folderPath 매칭으로 fallback

**완료 기준**: 같은 GitHub 레포를 다른 경로로 클론한 팀원이 자동 매칭, non-git 폴더는 기존 동작 유지.

### 3순위 — `a4a85476` 오케스트레이터 cross-machine 큐 라우팅 (P2, backend)

**왜**: 갭 2의 정합성 마무리. 일반 agent는 큐 라우팅 되지만 orchestrator는 안 됨. 현재는 silent failure만 가시화한 상태(`ec4e02f4`에서 sendSystemMessage 추가).

**선행 학습 필요**: `v3/electron/orchestrator-manager.ts` 흐름. orchestrator가 어떻게 spawn되고 PTY가 어떻게 연결되는지. agents 컬렉션에는 등록 안 됨 → 별도 식별자 협약 필요.

**추천 설계 (옵션 A)**:

1. orchestrator spawn 시점에 `pendingListener.attach(\`orch-${projectId}\`, orchPtySessionId)` 호출
2. `ProjectChat.tsx`에서 @orchestrator 매칭 실패 시 `addPendingInstruction({ targetAgentId: \`orch-${projectId}\`, taskId: null, sourceType: 'orchestrator', ... })`
3. 그 머신의 listener가 atomic flip 후 PTY 주입

**왜 3순위**: orchestrator-manager 흐름 파악에 deep dive 필요. 다른 두 작업보다 코드 readthrough 비중 큼.

---

## 2. 마블로 v3 컨벤션 (필수 숙지)

작업 시작 전 반드시 읽고 따라야 할 규칙들:

### TaskForce MCP (강제)

- 시스템 리마인더가 매 턴마다 강조함
- **모든 코드 수정 전**: 관련 티켓 `add_activity`로 진행 기록, 없으면 `create_task` 생성
- **작업 완료 시**: `update_task_status` (TODO → CLAIMED → IN_PROGRESS → REVIEW → DONE 순서 강제)
- **금지**: Claude Code 내장 `TaskCreate`/`TaskUpdate` 절대 사용 금지. `mcp__taskforce__*` 도구만 사용
- **단순 파일 읽기/질문은 티켓 불필요**

### Firestore 패턴

- Renderer는 `v3/src/services/firestore.ts`의 헬퍼 사용 (createDocument, updateDocument, subscribeToCollection, subscribeToDocument, toTimestamp, convertTimestamps)
- Electron main은 별도 named Firebase app (`flow-engine`, `pending-instruction-listener` 등)으로 격리
- 보안 규칙은 `v3/firestore.rules`. 변경 시 `v3/firestore.rules.test.ts`에 테스트 추가 필수
- 인덱스는 `v3/firestore.indexes.json`

### Electron ↔ Renderer

- main이 직접 mutate해야 하는 경우 named Firebase app 사용 (renderer Auth와 분리)
- renderer에서 PTY 조작은 IPC 통해 main으로 (`window.electronAPI.pty.*`)
- main의 lifecycle hook들: `setAgentSpawnedHook` (spawn), AgentManager status callback (stopped/error)

### State Machine 일관성

- task 상태는 renderer `v3/src/services/stateMachine.ts`와 backend `v3/electron/mcp-server/tools.ts:31` 두 곳에 정의. **두 곳을 항상 동기화**
- 갭 2에서 CLAIMED → TODO transition을 양쪽에 추가했음 (ec4e02f4)

### 포매터 주의

- 마블로 v3는 저장 시 포매터가 자동 적용됨 (single quote ↔ double quote, trailing comma 등)
- Edit 후 다음 Edit이 "string not found" 실패하면 Read로 재확인 후 정확한 텍스트로 재시도

### 사전 미완성 영역 (건드리지 말 것)

- `v3/src/app/onboarding/`, `v3/src/components/onboarding/` — lucide-react 모듈 누락
- `v3/src/services/paymentClient.ts` — 결제 관련 미완성
- `v3/src/components/code/CodeEditor.tsx` — monaco-editor 모듈 누락
- 타입체크 시 이 파일들 에러는 무시 (사전 상태)

### gstack (글로벌)

- `/plan-eng-review`, `/ship`, `/review`, `/qa` 등 글로벌 슬래시 커맨드 사용 가능
- 웹 브라우징은 `mcp__claude-in-chrome__*` 대신 `/browse` 사용
- 자세한 건 `~/.claude/CLAUDE.md` (사용자 글로벌)

### 디렉토리 단축어

- 마블로 루트: `/Users/dongwonkim/Documents/programming/marblo`
- v3 디렉토리: `/Users/dongwonkim/Documents/programming/marblo/v3`
- Bash 작업 시 `cd v3 && ...` 또는 `cwd: v3` 권장 (`tsc -p electron/tsconfig.json` 등)

---

## 3. 작업 시작 절차 (모든 티켓 공통)

```
1. mcp__taskforce__get_task_activities(task_id=<티켓ID>)
   → 이전 진행 사항 + 컨텍스트 복원

2. mcp__taskforce__update_task_status(task_id, status="CLAIMED",
                                     comment="claim — <agent_id>")
   → CLAIMED로 전환

3. mcp__taskforce__update_task_status(task_id, status="IN_PROGRESS",
                                     comment="작업 시작")
   → 실작업 시작

4. 작업 진행하면서 의미 있는 결정/변경마다:
   mcp__taskforce__add_activity(task_id, message="...")

5. 완료 후 타입체크:
   cd v3 && npx tsc -p electron/tsconfig.json --noEmit
   cd v3 && npx tsc --noEmit

6. mcp__taskforce__update_task_status(task_id, status="REVIEW",
                                     comment="구현 완료, 검증 통과")
   → REVIEW로 전환 (IN_PROGRESS에서 DONE 직접 못 감)

7. mcp__taskforce__update_task_status(task_id, status="DONE",
                                     comment="<요약>")
   → DONE으로 마감
```

---

## 4. 산출물 위치 빠른 인덱스

### 이전 세션의 핵심 파일

- `v3/electron/pending-instruction-listener.ts` — atomic flip + PTY 주입 (이 파일 패턴이 핵심 참고)
- `v3/electron/mcp-server/tools.ts:31-39` — VALID_TRANSITIONS (renderer stateMachine과 동기화)
- `v3/electron/mcp-server/tools.ts:1655-` — add_pending_instruction / get_pending_instructions / mark_instruction_delivered (3개 MCP 도구)
- `v3/electron/main.ts:138, 152, 384-388, 1893, 1906` — listener wiring 4곳 (spawn/stop/shutdown)
- `v3/src/services/pendingInstructionService.ts` — renderer addPendingInstruction (taskId nullable)
- `v3/src/components/board/TaskCard.tsx` — 활성 상태 dot + 오프라인 안내 + 회수 버튼
- `v3/src/components/chat/ProjectChat.tsx` — @agent 큐 fallback + @orchestrator system message
- `v3/firestore.rules` — pendingInstructions 컬렉션 규칙 (delivery flip만, 핵심 필드 immutable)
- `v3/firestore.rules.test.ts` — pendingInstructions 7개 테스트

### 특허 산출물

- `docs/IP_review.md` — 변리사 작성 명세서 원본
- `docs/IP_amendment_request.md` — 변리사 제출용 수정 요청서 (A~G 항목)

---

## 5. 변경 금지 사항 (이전 세션의 의도적 결정)

다음 결정들은 trade-off를 고민해서 내린 의도적 선택. 회귀하지 말 것:

- **PTY stdout 라이브 미러링 안 함** — 프라이버시 / Firestore 비용 / UX 노이즈 종합 판단. add_activity로 의미 있는 진행만 공유.
- **claim 자동 회수 안 함** — 점심·회의 중 자동 해제 부작용. 수동 [회수] 버튼만.
- **PendingInstructions 별도 컬렉션** — Task 문서 내 array 안 함 (1MB 한계 + 쿼리 친화성).
- **isDelivered: boolean** — `deliveredAt == null` 비교 안 함 (Firestore 인덱스 친화).
- **runTransaction 사용 강제** — 멀티 머신 race 시 at-most-once PTY 주입 보장.
- **status=="stopped"에서만 listener detach** — "error"는 transient (auto-restart 가능성).

---

## 6. 다음 에이전트에게

각 티켓에 컨텍스트가 자세히 적혀 있고 본 핸드오프 문서가 빠른 진입점입니다. 39e8a0db → 32c301cb → a4a85476 순서가 가장 효율적이지만, 작업 시작 전 사용자에게 우선순위 확인 권장. 의문이 생기면 갭 2 메인 티켓(`ea0b28b3`)의 activity 로그가 가장 풍부한 컨텍스트 소스입니다.

행운을 빕니다.
