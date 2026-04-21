---
tags: [레퍼런스, 슬래시스킬]
type: reference
aliases: [슬래시 스킬 레퍼런스, tf 명령어]
---

> [[HOME]] 로 돌아가기

# Marblo (마블로) 슬래시 스킬 레퍼런스

> 21개 슬래시 스킬의 용도, 워크플로우, 내부 MCP 도구 매핑을 정리한 문서입니다.
> 모듈 2 이론 파트와 함께 참고하세요.

---

## 한눈에 보기

```
프로젝트 시작           에이전트 관리        작업 진행           리뷰/소통           정리/운영
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/tf-plan  (기획)    /tf-spawn (물리)    /tf-work  (코딩)    /tf-review  (승인)   /tf-sync  (동기화)
/tf-start (실행)    /tf-agent (논리)    /tf-status(현황)    /tf-feedback(소통)   /tf-done  (완료)
                    /tf-flow  (파이프)  /tf-add   (추가)    /tf-fix     (복구)   /tf-ralph (반복)
                                        /tf-hold  (중단)    /tf-handoff (인수)
                                        /tf-resume(재개)                       /tf-guide (도움말)

프로젝트 시작 (단계별)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/tf-analyze       (분석)    /tf-create-tasks (생성)    /tf-spawn-agents (스폰)
```

---

## 프로젝트 시작

### `/tf-plan` — PRD 작성 + 태스크 분해

| 항목 | 내용 |
|------|------|
| **용도** | 코드 쓰기 전에 충분히 생각하는 단계. PRD 작성 → 태스크 분해 계획 수립 |
| **인자** | `[프로젝트 설명 또는 아이디어]` |
| **언제 쓰나** | 새 프로젝트를 시작할 때 가장 먼저 |
| **다음 단계** | `/tf-start` |

**워크플로우:**

1. **프로젝트명 확정** — 사용자와 이름 합의
2. **소크라틱 질문** — 5개 필수 질문으로 요구사항 정리
   - 핵심 가치 / 사용자 / 핵심 기능 / 기술 스택 / 범위(MVP vs 풀)
3. **PRD 자동 생성** — 한 줄 요약, 문제, 사용자, 기술스택, 핵심기능, 화면, API, DB, 제외항목
4. **태스크 분해** — 레이어별 의존성 그래프 + 태스크 카드 형식
5. **검토 + 확정** — 체크리스트 검증 → `docs/PRD.md` 저장

**내부 MCP 도구:** `get_all_tasks` (기존 태스크 확인)

**사용 예시:**
```
/tf-plan 유튜브 URL을 넣으면 AI가 요약하고 인사이트를 뽑아주는 서비스.
FastAPI + Next.js + Claude API.
```

---

### `/tf-start` — 태스크 생성 + 에이전트 스폰

| 항목 | 내용 |
|------|------|
| **용도** | PRD 기반으로 태스크를 일괄 생성하고 에이전트 팀을 스폰해서 프로젝트 시작 |
| **인자** | `[프로젝트명]` |
| **선행 조건** | `/tf-plan`으로 PRD가 확정된 상태 |
| **언제 쓰나** | 계획이 완성된 후 실행할 때 |

**워크플로우:**

1. **Pre-flight 체크** — PRD 존재 확인, MCP 연결 테스트, 기존 태스크 충돌 확인
2. **태스크 일괄 생성** — PRD → `create_tasks_bulk` **한 번 호출**로 전체 생성
3. **에이전트 스폰** — `get_agent_skill`로 역할별 스킬 로드 → Agent Teams 병렬 작업
4. **모니터링** — 태스크 완료 시 의존성 풀린 다음 태스크 자동 시작

**내부 MCP 도구:** `create_tasks_bulk`, `get_agent_skill`, `get_available_tasks`, `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`, `check_feedback`

**`/tf-work`와의 차이:**

| | `/tf-start` | `/tf-work` |
|--|------------|------------|
| 역할 | PM/리더 (프로젝트 킥오프) | 개발자 (개별 작업) |
| 규모 | 태스크 N개 일괄 생성 + 에이전트 팀 | 태스크 1개 선택 + 코딩 |
| 언제 | 프로젝트 처음 | 태스크가 이미 있을 때 |

---

## 프로젝트 시작 (단계별)

### `/tf-analyze` — 요구사항 분석

| 항목 | 내용 |
|------|------|
| **용도** | 요구사항을 분석하고 컴포넌트, 역할, 의존성을 파악 |
| **인자** | `[요구사항 또는 프로젝트 설명]` |
| **언제 쓰나** | 복잡한 프로젝트에서 태스크 생성 전에 분석부터 할 때 |
| **다음 단계** | `/tf-create-tasks` |

**워크플로우:**

1. **요구사항 수집** — 5개 필수 질문으로 핵심 파악
2. **코드베이스 분석** — 기존 프로젝트면 구조/패턴/영향 범위 파악
3. **분석 결과 출력** — 컴포넌트, 역할, 의존성 그래프, 리스크

**내부 MCP 도구:** `get_all_tasks` (기존 태스크 확인)

**사용 예시:**
```
/tf-analyze 유튜브 URL을 넣으면 AI가 요약하고 인사이트를 뽑아주는 서비스.
```

---

### `/tf-create-tasks` — 분석 기반 태스크 일괄 생성

| 항목 | 내용 |
|------|------|
| **용도** | 분석 결과를 기반으로 태스크를 확인받고 일괄 생성 |
| **인자** | `[프로젝트명]` |
| **선행 조건** | `/tf-analyze`로 분석이 완료된 상태 |
| **다음 단계** | `/tf-spawn-agents` |

**워크플로우:**

1. **태스크 목록 구성** — 분석 결과에서 태스크 카드 형식으로 변환
2. **사용자 확인** — 태스크 목록 보여주고 승인 받기
3. **일괄 생성** — `create_tasks_bulk` 한 번 호출
4. **결과 보고** — 생성 결과 + 의존성 체인 표시

**내부 MCP 도구:** `create_tasks_bulk`, `get_all_tasks`

---

### `/tf-spawn-agents` — 에이전트 라인업 제안 + 스폰

| 항목 | 내용 |
|------|------|
| **용도** | 태스크 확인 후 에이전트 라인업 제안 → 확인 후 스폰 |
| **인자** | `[프로젝트명]` |
| **선행 조건** | `/tf-create-tasks`로 태스크가 생성된 상태 |
| **언제 쓰나** | 태스크 생성 후 에이전트를 배치할 때 |

**워크플로우:**

1. **태스크 확인** — `get_available_tasks`로 시작 가능한 태스크 확인
2. **라인업 제안** — 역할별 에이전트 + 담당 태스크 배치안 제안
3. **사용자 확인** — 라인업 승인 받기
4. **에이전트 스폰** — `get_agent_skill`로 스킬 로드 → Agent Teams 실행
5. **모니터링** — 완료 시 의존성 풀린 다음 태스크 자동 시작

**내부 MCP 도구:** `get_all_tasks`, `get_available_tasks`, `get_agent_skill`, `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`

---

---

## 에이전트 관리

### `/tf-spawn` — 물리 에이전트 스폰 (Electron 터미널 탭)

| 항목 | 내용 |
|------|------|
| **용도** | `spawn_agent` MCP 도구로 독립적인 CLI 프로세스를 Electron 터미널 탭에 스폰 |
| **인자** | 없음 |
| **언제 쓰나** | 병렬 코딩이 필요할 때, 역할별 에이전트를 터미널에 배치할 때 |

**워크플로우:**

1. **태스크 확인** — `get_available_tasks`로 시작 가능한 태스크 확인
2. **라인업 제안** — 역할별 에이전트 구성 + 담당 태스크 제안
3. **사용자 확인** — 라인업 승인 받기
4. **물리 스폰** — `spawn_agent` MCP → HTTP 브릿지 → Electron PTY 터미널 탭 생성
5. **초기 프롬프트** — 스킬 파일 로드 + 태스크 claim 지시

**`/tf-spawn-agents`와의 차이:**

| | `/tf-spawn` | `/tf-spawn-agents` |
|--|-------------|---------------------|
| 타이밍 | 언제든 (추가 스폰) | 프로젝트 킥오프 직후 |
| 선행 조건 | 태스크가 있으면 됨 | `/tf-create-tasks` 완료 후 |
| 용도 | 개별/추가 에이전트 스폰 | 초기 전체 에이전트 배치 |

**제약 사항:**
- 한 번에 최대 5개 에이전트
- 같은 role의 에이전트는 최대 2개
- Claude Code 내부 팀(TeamCreate/Task 도구) 사용 금지

**내부 MCP 도구:** `spawn_agent`, `get_available_tasks`, `get_all_tasks`, `get_agent_skill`

---

### `/tf-agent` — 논리 서브에이전트 (빠른 조사)

| 항목 | 내용 |
|------|------|
| **용도** | Claude Code 내부 Task 도구로 서브에이전트를 생성. 물리 터미널 없이 빠른 조사/탐색 |
| **인자** | `[조사할 내용]` |
| **언제 쓰나** | 코드베이스 분석, 파일 검색, 아키텍처 조사 등 일회성 탐색 작업 |

**`/tf-spawn`과의 차이:**

| | `/tf-spawn` (물리) | `/tf-agent` (논리) |
|--|--------------------|--------------------|
| 프로세스 | 독립 CLI (Electron PTY) | Claude Code 내부 서브에이전트 |
| 터미널 탭 | 생성됨 | 없음 |
| 지속성 | 세션 동안 유지 | 작업 완료 즉시 종료 |
| 용도 | 코딩, 장기 작업 | 조사, 탐색, 일회성 |
| MCP 도구 | `spawn_agent` | Claude Code Task 도구 |

**워크플로우:**

1. **요청 분석** — 어떤 종류의 조사인지 파악
2. **에이전트 타입 선택** — Explore(탐색), Plan(설계), general-purpose(범용) 중 선택
3. **서브에이전트 실행** — Task 도구로 내부 에이전트 생성
4. **결과 반환** — 조사 결과를 메인 컨텍스트로 반환

**내부 MCP 도구:** 없음 (Claude Code 내부 Task 도구 사용)

---

### `/tf-flow` — 플로우 파이프라인 설계

| 항목 | 내용 |
|------|------|
| **용도** | 에이전트 작업 흐름을 DAG(방향 비순환 그래프) 파이프라인으로 설계 |
| **인자** | 없음 |
| **언제 쓰나** | 복잡한 의존성 체인, 조건 분기, 병렬 처리가 필요할 때 |

**워크플로우:**

1. **현황 분석** — 태스크 + 의존성 확인
2. **플로우 설계** — 노드(agent/condition/parallel/review/test/deploy) + 엣지 구성
3. **시각화** — 플로우 그래프를 ASCII 또는 JSON으로 표시
4. **사용자 확인** — 구조 승인 받기
5. **플로우 생성** — `create_flow` MCP 도구로 저장
6. **실행/모니터링** — `update_flow`로 상태 관리

**노드 타입:**

| 타입 | 설명 |
|------|------|
| `agent` | 에이전트가 태스크 수행 |
| `condition` | 조건 분기 (if/else) |
| `parallel` | 병렬 실행 그룹 |
| `review` | 리뷰 게이트 |
| `test` | 테스트 실행 |
| `deploy` | 배포 단계 |

**내부 MCP 도구:** `create_flow`, `get_flows`, `update_flow`, `get_all_tasks`

---

**`/tf-plan` + `/tf-start` vs 단계별 (`/tf-analyze` → `/tf-create-tasks` → `/tf-spawn-agents`)**

| | 한번에 (`/tf-plan` → `/tf-start`) | 단계별 (analyze → create → spawn) |
|--|----------------------------------|-----------------------------------|
| 속도 | 빠름 (2단계) | 정밀 (3단계) |
| 제어 | PRD 확정 후 한번에 실행 | 각 단계마다 확인/수정 가능 |
| 적합한 상황 | 소규모, 명확한 요구사항 | 복잡한 프로젝트, 유튜브 시연 |
| 추천 | 워밍업 프로젝트, 빠른 시작 | 실전 프로젝트, 팀 리뷰 필요 시 |

---

## 작업 진행

### `/tf-work` — 태스크 claim + 코딩 + 자동 기록

| 항목 | 내용 |
|------|------|
| **용도** | 가능한 태스크 중 하나를 골라서 claim → 코딩 → 리뷰 제출 |
| **인자** | 없음 |
| **언제 쓰나** | 이미 태스크가 있고, 하나를 잡아서 작업할 때 |

**워크플로우:**

1. **태스크 선택** — `get_available_tasks`로 목록 표시 → 사용자 선택 (priority 높은 순 추천)
2. **태스크 시작** — `claim_task` → `update_task_status(IN_PROGRESS)` → 스킬 파일 로드
3. **코딩 + 자동 기록** — 작업하면서 `add_activity` 자동 호출
   - 파일 생성/수정, 테스트 결과, 이슈 발생, 결정 사항
   - 형식: `[동작] [대상] — [상세 내용]`
4. **완료 + 리뷰** — `check_feedback` → `submit_for_review`

**내부 MCP 도구:** `get_available_tasks`, `claim_task`, `update_task_status`, `add_activity`, `check_feedback`, `submit_for_review`, `get_agent_skill`

---

### `/tf-status` — 진행 상태 대시보드 요약

| 항목 | 내용 |
|------|------|
| **용도** | 프로젝트 전체 태스크 현황을 텍스트 대시보드로 요약 |
| **인자** | 없음 |
| **언제 쓰나** | 현재 진행 상황을 빠르게 확인할 때 |

**출력 예시:**
```
📊 프로젝트: youtube-insight
━━━━━━━━━━━━━━━━━━
  ✅ DONE          3개
  🔄 IN_PROGRESS   2개
  👀 REVIEW        1개  ← 리뷰 필요!
  📋 TODO          2개
  ━━━━━━━━━━━━━━━
  진행률: 3/8 (37%)
```

**내부 MCP 도구:** `get_all_tasks`, `check_feedback`

---

### `/tf-add` — 태스크 추가/수정

| 항목 | 내용 |
|------|------|
| **용도** | 진행 중 프로젝트에 새 태스크 추가 또는 기존 태스크 수정 |
| **인자** | 없음 |
| **언제 쓰나** | 빠진 기능 발견, 요구사항 변경, 우선순위 조정 |

**워크플로우:**

1. 현재 태스크 목록 확인
2. 새 태스크 → `create_task` 또는 `create_tasks_bulk`
3. 기존 태스크 수정 → API 직접 호출 (priority, description 등)
4. 의존성 자동 분석 + 반영

**내부 MCP 도구:** `get_all_tasks`, `get_available_tasks`, `create_task`, `create_tasks_bulk`

---

### `/tf-hold` — 작업 일시 중단 + 현황 정리

| 항목 | 내용 |
|------|------|
| **용도** | 혼란스럽거나 방향 전환이 필요할 때 멈추고 정리 |
| **인자** | 없음 |
| **언제 쓰나** | 에이전트가 너무 빠르게 돌아갈 때, 중간 점검이 필요할 때 |

**워크플로우:**

1. **현황 스냅샷** — 상태별 태스크 정리
2. **진행 중 태스크 상세** — 활동 로그 + 피드백 확인
3. **다음 행동 제안** — 상황별 추천 스킬 제시
4. **중단 메모 기록** — `add_activity`로 기록

**출력 예시:**
```
⏸️ 작업 일시 중단 — 현황 정리
━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ 완료: TASK-001, TASK-002
  🔄 진행 중: TASK-003 ← 여기서 멈춤
  📋 대기: TASK-004, TASK-005

  💡 다음 행동:
  • /tf-review — REVIEW 1개 처리
  • /tf-resume — 이어서 진행
```

**내부 MCP 도구:** `get_all_tasks`, `get_task_activities`, `check_feedback`, `add_activity`

---

### `/tf-resume` — 중단된 프로젝트 이어하기

| 항목 | 내용 |
|------|------|
| **용도** | 세션이 끊기거나 중단된 후 전체 컨텍스트를 복원하고 이어서 진행 |
| **인자** | `[프로젝트명]` |
| **언제 쓰나** | 다음 날 이어할 때, 세션 끊긴 후, `/tf-hold` 후 재개 |

**워크플로우:**

1. **전체 컨텍스트 복원** — PRD, 프로젝트 문서, 모든 태스크, 활동 로그, 미확인 피드백
2. **상황 진단** — 순조로움 / 문제 있음 / 재점검 필요 분류
3. **계획 재점검** — PRD 대비 현황, 기존 태스크 정리, 새 태스크 추가
4. **작업 재개** — 피드백/리뷰 처리 → 코딩 재개

**내부 MCP 도구:** `get_all_tasks`, `get_available_tasks`, `get_task_activities`, `check_feedback`, `add_activity`, `submit_for_review`, `claim_task`, `update_task_status`, `create_task`, `create_tasks_bulk`

> `/tf-resume`는 가장 많은 MCP 도구를 사용하는 스킬입니다. 전체 상태를 한꺼번에 복원해야 하기 때문.

---

## 리뷰 / 소통

### `/tf-review` — PM 코드 리뷰 승인/반려

| 항목 | 내용 |
|------|------|
| **용도** | REVIEW 상태 태스크를 검토하고 코드 품질 확인 후 승인/반려 |
| **인자** | 없음 |
| **언제 쓰나** | `/tf-status`에서 REVIEW 태스크가 보일 때 |

**워크플로우:**

1. REVIEW 상태 태스크 조회
2. 각 태스크별 활동 로그 + 코드 검토 + 체크리스트
3. **승인:** `update_task_status` → DONE
4. **반려:** `update_task_status` → TODO + 피드백 기록

**내부 MCP 도구:** `get_all_tasks`, `update_task_status`, `add_activity`, `get_task_activities`

---

### `/tf-feedback` — PM 피드백 확인 + 답변

| 항목 | 내용 |
|------|------|
| **용도** | PM이 대시보드에서 남긴 피드백을 확인하고 답변/반영 (양방향 소통) |
| **인자** | 없음 |
| **언제 쓰나** | 대시보드에서 코멘트를 남긴 후, 에이전트 반응이 필요할 때 |

**워크플로우:**

1. `check_feedback`으로 미확인 피드백 조회
2. 각 피드백 상세 확인 (활동 로그 맥락 + 코드 분석)
3. 답변 + 코드 반영 (`add_activity`로 답변 기록)
4. `acknowledge_feedback`으로 피드백 처리 완료

**내부 MCP 도구:** `check_feedback`, `acknowledge_feedback`, `add_activity`, `get_task_activities`, `get_all_tasks`

---

### `/tf-fix` — FAILED/BLOCKED 태스크 진단 + 복구

| 항목 | 내용 |
|------|------|
| **용도** | 실패하거나 막힌 태스크의 원인을 진단하고 복구. 불필요한 태스크 취소/삭제도 가능 |
| **인자** | 없음 |
| **언제 쓰나** | `/tf-status`에서 FAILED/BLOCKED가 보일 때 |

**워크플로우:**

1. FAILED/BLOCKED 태스크 조회
2. 활동 로그로 실패 원인 파악
3. 원인 분류: 환경 문제 / 코드 문제 / 의존성 문제 / 스킬 문제
4. 해결책 제시 + 실행
5. 태스크 취소/삭제 처리 (필요 시)

**내부 MCP 도구:** `get_all_tasks`, `get_task_activities`, `update_task_status`, `add_activity`

---

### `/tf-handoff` — 에이전트 실패 → 직접 이어받기

| 항목 | 내용 |
|------|------|
| **용도** | 에이전트가 실패한 태스크를 사람이 직접 이어받아서 완료 |
| **인자** | 없음 |
| **언제 쓰나** | `/tf-fix`로 해결 안 될 때, 직접 코딩이 필요할 때 |

**워크플로우:**

1. FAILED/BLOCKED/오래된 IN_PROGRESS 태스크 확인
2. 에이전트가 어디까지 했는지 활동 로그 + 코드 확인
3. 스킬 파일 로드 → 이어서 코딩
4. "수동 핸드오프" 기록 → 리뷰 제출 또는 DONE

**`/tf-fix`와의 차이:**

| | `/tf-fix` | `/tf-handoff` |
|--|-----------|---------------|
| 방식 | 원인 진단 + 환경/설정 수정 | 직접 코딩으로 완료 |
| 대상 | 환경/설정 문제 | 코드 로직 문제 |
| 결과 | 태스크를 에이전트에게 다시 넘김 | 사람이 직접 완료 |

**내부 MCP 도구:** `get_all_tasks`, `get_task_activities`, `update_task_status`, `claim_task`, `add_activity`, `submit_for_review`, `get_agent_skill`

---

## 동기화 / 정리

### `/tf-sync` — 코드 상태와 티켓 동기화

| 항목 | 내용 |
|------|------|
| **용도** | 실제 코드 상태와 Marblo 티켓 상태의 불일치를 감지하고 동기화 |
| **인자** | 없음 |
| **언제 쓰나** | 수동으로 코드를 수정한 후, 에이전트가 티켓 업데이트를 빠뜨렸을 때 |

**불일치 예시:**
- 코드는 완성됐는데 티켓이 아직 TODO
- 티켓은 IN_PROGRESS인데 활동 로그가 하루째 없음
- 파일이 삭제됐는데 티켓은 DONE

**내부 MCP 도구:** `get_all_tasks`, `update_task_status`, `add_activity`, `submit_for_review`, `claim_task`

---

### `/tf-done` — 프로젝트 완료 + 아카이브

| 항목 | 내용 |
|------|------|
| **용도** | 프로젝트 마무리. 결과 요약 + DONE 태스크 아카이브 + 회고 |
| **인자** | `[프로젝트명]` |
| **언제 쓰나** | 모든 태스크가 DONE이고 프로젝트를 정리할 때 |

**워크플로우:**

1. 프로젝트 현황 최종 확인 (완료율, 미완료 태스크 처리)
2. 결과 요약 — 산출물, 타임라인, 에이전트별 통계
3. 회고 — 잘 된 것, 개선할 점, 다음 프로젝트 반영사항
4. 아카이브 — DONE 태스크 일괄 아카이브

**내부 MCP 도구:** `get_all_tasks`, `get_task_activities`, `add_activity`

---

## 반복 작업

### `/tf-ralph` — 같은 작업 N개 대상에 일괄 처리

| 항목 | 내용 |
|------|------|
| **용도** | 동일한 작업을 여러 대상에 반복 적용 (티켓 단위 추적) |
| **인자** | 없음 |
| **언제 쓰나** | API 10개에 테스트 추가, 컴포넌트 8개에 접근성 개선 등 |

**`/tf-start`와의 차이:**

| | `/tf-start` | `/tf-ralph` |
|--|------------|-------------|
| 태스크 종류 | 서로 다른 작업 (협업) | 같은 작업 반복 |
| 에이전트 | 여러 개 병렬 | 1개 순차 |
| 결과 | 프로젝트 완성 | DONE N개, FAILED M개 |

**워크플로우:**

1. 대상 + 작업 + 프로젝트명 확인
2. 대상 파일/컴포넌트 목록 분석
3. `create_tasks_bulk`로 대상 1개당 티켓 1장 생성
4. 순서대로: claim → 작업 → `add_activity` → 완료/실패
5. 결과 요약: DONE/FAILED 개수 + 실패 원인

**내부 MCP 도구:** `create_tasks_bulk`, `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`, `get_all_tasks`

---

## 도움말

### `/tf-guide` — 전체 명령어 가이드 + 상황별 추천

| 항목 | 내용 |
|------|------|
| **용도** | 뭘 해야 할지 모를 때 상황별 추천 |
| **인자** | 없음 |
| **언제 쓰나** | 처음 쓸 때, 어떤 스킬을 써야 할지 모를 때 |

**상황별 추천:**

| 상황 | 추천 스킬 |
|------|----------|
| 새 프로젝트 시작 (빠르게) | `/tf-plan` → `/tf-start` |
| 새 프로젝트 시작 (정밀하게) | `/tf-analyze` → `/tf-create-tasks` → `/tf-spawn-agents` |
| 태스크 하나 작업 | `/tf-work` |
| 현황 확인 | `/tf-status` |
| 리뷰 처리 | `/tf-review` |
| 에이전트 추가 스폰 | `/tf-spawn` |
| 빠른 조사/탐색 | `/tf-agent` |
| 복잡한 작업 흐름 설계 | `/tf-flow` |
| 실패 태스크 | `/tf-fix` → (안 되면) `/tf-handoff` |
| 세션 끊김 | `/tf-resume` |
| 반복 작업 | `/tf-ralph` |
| 프로젝트 끝 | `/tf-done` |

---

## MCP 도구 ↔ 슬래시 스킬 매핑

어떤 MCP 도구가 어떤 슬래시 스킬에서 쓰이는지 역방향 매핑:

| MCP 도구 | 사용하는 슬래시 스킬 |
|----------|---------------------|
| `get_all_tasks` | status, review, hold, handoff, fix, sync, done, resume, add, ralph, analyze, create-tasks, spawn-agents, **spawn**, **flow** |
| `get_available_tasks` | work, start, resume, add, ralph, spawn-agents, **spawn** |
| `create_task` | add, resume |
| `create_tasks_bulk` | plan, start, add, ralph, resume, create-tasks |
| `claim_task` | work, start, handoff, sync, resume, ralph, spawn-agents |
| `update_task_status` | work, start, review, fix, handoff, sync, resume, ralph, spawn-agents |
| `add_activity` | work, start, hold, handoff, fix, feedback, sync, done, resume, ralph, spawn-agents |
| `submit_for_review` | work, start, handoff, sync, resume, ralph, spawn-agents |
| `check_feedback` | status, hold, feedback, resume |
| `acknowledge_feedback` | feedback |
| `get_task_activities` | review, hold, handoff, fix, feedback, done, resume |
| `get_agent_skill` | work, start, handoff, spawn-agents, **spawn** |
| `get_task_dependencies` | (직접 호출 시) |
| `spawn_agent` | **spawn**, spawn-agents |
| `create_flow` | **flow** |
| `get_flows` | **flow** |
| `update_flow` | **flow** |

---

## 전체 흐름 요약

```
한번에:  /tf-plan  ──────►  /tf-start  ──────►  /tf-status
           (기획)              (실행)              (모니터링)

단계별:  /tf-analyze ────► /tf-create-tasks ────► /tf-spawn-agents ────► /tf-status
           (분석)              (생성)                 (스폰)              (모니터링)
                                                                            │
                                          ┌─────────────────────────────────┼──────────────────┐
                                          ▼                                 ▼                  ▼
                                     /tf-review                        /tf-work           /tf-hold
                                     (리뷰 처리)                       (추가 작업)        (멈추고 정리)
                                          │                                                    │
                                          ▼                                                    ▼
                                     /tf-done                                             /tf-resume
                                     (프로젝트 완료)                                       (이어하기)

에이전트 관리:
  /tf-spawn  ─── 물리 에이전트 (Electron 터미널 탭, 병렬 코딩)
  /tf-agent  ─── 논리 서브에이전트 (빠른 조사/탐색, 터미널 없음)
  /tf-flow   ─── 플로우 파이프라인 (DAG, 조건 분기, 병렬 처리)

문제 발생 시: /tf-fix → /tf-handoff
피드백: /tf-feedback
동기화: /tf-sync
반복 작업: /tf-ralph
도움말: /tf-guide
```
