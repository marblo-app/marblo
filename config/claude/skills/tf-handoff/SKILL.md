---
name: tf-handoff
description: 에이전트가 실패한 태스크를 직접 이어받아서 완료합니다
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

에이전트가 처리하지 못한 태스크를 내가 직접 이어받아서 완료합니다.

## 단계

1. `get_all_tasks`로 FAILED, BLOCKED, 또는 오래된 IN_PROGRESS 태스크를 찾습니다.
2. 대상 태스크의 상태를 확인합니다:
   - FAILED → `update_task_status`로 TODO(retry) → 다시 claim
   - BLOCKED → 차단 원인 확인 → 해결 후 resolve
   - IN_PROGRESS (오래됨) → 에이전트가 중단된 것. 활동 로그로 어디까지 했는지 확인
3. `get_task_activities`로 에이전트가 어디까지 작업했는지 확인합니다.
4. `get_agent_skill`로 해당 역할의 스킬 파일을 로드합니다.
5. 에이전트가 남긴 코드를 확인하고 이어서 작업합니다:
   - 이미 생성된 파일이 있으면 그 위에 이어서 작업
   - 테스트가 실패했으면 수정
   - 빠진 부분 보완
6. 작업 중 `add_activity`로 "수동 핸드오프: [작업 내용]" 기록합니다.
7. 완료 후 `submit_for_review` 또는 바로 DONE 처리합니다.

## 핸드오프 판단 기준

- 에이전트가 3번 이상 같은 태스크에서 FAILED → 직접 하는 게 빠름
- 환경 설정이 필요한 작업 (API 키, 외부 서비스 연동)
- 에이전트가 scope 밖 수정이 필요한 복잡한 작업
