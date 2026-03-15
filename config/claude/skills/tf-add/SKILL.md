---
name: tf-add
description: 진행 중인 프로젝트에 새로운 태스크를 추가합니다
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

진행 중인 프로젝트에 새로운 태스크를 추가합니다.

## 단계

1. `get_all_tasks`로 현재 프로젝트의 태스크 목록을 확인합니다.
2. 사용자에게 새로 추가할 작업을 물어봅니다.
3. 기존 태스크와의 의존성을 분석합니다:
   - 어떤 태스크가 먼저 완료되어야 하는지 (depends_on)
   - 어떤 태스크와 파일 영역이 겹치는지 (scope)
4. `create_task` 또는 `create_tasks_bulk`로 태스크를 생성합니다.
5. 생성된 태스크의 의존성이 이미 충족되었으면 바로 작업 시작 가능함을 알립니다.

## 예시

```
사용자: "결제 기능도 추가하고 싶어"
→ 기존 태스크 확인
→ TASK-009: 결제 API (backend, depends_on: TASK-001)
→ TASK-010: 결제 UI (frontend, depends_on: TASK-009)
→ TASK-001이 이미 DONE이면 → TASK-009 바로 available
```

## 주의사항

- 기존 태스크와 scope가 겹치지 않도록 주의
- 이미 IN_PROGRESS인 태스크에 의존성을 걸면 대기가 길어질 수 있음
- priority를 적절히 설정해서 기존 작업 흐름에 맞추기
