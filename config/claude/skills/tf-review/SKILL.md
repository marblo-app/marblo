---
name: tf-review
description: PM으로서 REVIEW 상태 태스크를 검토하고 코드 품질을 확인한 후 승인/반려합니다
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep
---

# TaskForce PM 리뷰

> 에이전트가 올린 REVIEW 태스크를 검토합니다.
> 코드 품질을 확인하고 승인(DONE) 또는 반려(TODO로 되돌림) 합니다.

---

## ⛔ 필수 규칙: TaskForce MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 태스크 조회/상태변경은 반드시 **TaskForce MCP 도구**를 사용합니다:
> `get_all_tasks`, `update_task_status`, `add_activity`, `get_task_activities`

---

## Step 1: 리뷰 대기 태스크 조회

`get_all_tasks`에서 REVIEW 상태만 필터링합니다.

```
👀 리뷰 대기: {n}개
━━━━━━━━━━━━━

1. TASK-002: 유저 API (backend)
   제출: 30분 전 | 담당: backend-agent

2. TASK-004: URL 입력 화면 (frontend)
   제출: 15분 전 | 담당: frontend-agent
```

---

## Step 2: 각 태스크 리뷰

태스크 하나씩 다음을 확인합니다:

### 2-1. 활동 로그 확인

`get_task_activities`로 에이전트가 뭘 했는지 파악합니다.

### 2-2. 코드 확인

태스크의 scope 필드에 명시된 파일들을 읽고 검토합니다.

### 2-3. 리뷰 체크리스트

```
□ 기능 완성도: 태스크 설명의 요구사항이 모두 구현되었는가?
□ 코드 품질: 스킬 파일 규칙(프레임워크, 패턴)을 따랐는가?
□ 테스트 포함: 테스트 코드가 있고 통과하는가?
□ 에러 핸들링: 예외 상황이 적절히 처리되는가?
□ scope 준수: scope 밖의 파일을 수정하지 않았는가?
□ 보안: SQL 인젝션, XSS 등 취약점이 없는가?
```

### 2-4. 판정

리뷰 결과를 사용자에게 보여줍니다:

```
📝 TASK-002: 유저 API 리뷰 결과
━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 기능 완성도: 회원가입, 로그인, 프로필 조회 — OK
✅ 코드 품질: FastAPI + Pydantic v2 — OK
✅ 테스트: 5/5 pass — OK
⚠️ 에러 핸들링: 비밀번호 유효성 검사 없음
✅ scope 준수: OK

판정: 승인 or 반려?
```

---

## Step 3: 승인 / 반려

### 승인 (Approve)
- `update_task_status` → DONE
- 의존성이 풀리는 태스크가 있으면 알려줌:
  ```
  ✅ TASK-002 승인 → DONE
  🔓 TASK-004, TASK-005가 이제 작업 가능합니다
  ```

### 반려 (Reject)
- `update_task_status` → TODO (피드백 코멘트 포함)
- `add_activity`로 구체적인 수정 요청 기록:
  ```
  ❌ TASK-002 반려 → TODO
  피드백: "비밀번호 유효성 검사 추가 (8자 이상, 특수문자 포함).
          에러 메시지도 사용자 친화적으로."
  ```

---

## 리뷰 완료 후

모든 REVIEW 처리 후 현황을 보여줍니다:

```
📊 리뷰 완료:
   승인: {n}개
   반려: {n}개

   새로 available된 태스크: {list}
   다음 행동: /tf-work 또는 에이전트 재실행
```
