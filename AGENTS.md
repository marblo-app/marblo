# Marblo Rules

## Marblo MCP 워크플로우 (필수)

- 모든 작업 시작 전에 Marblo MCP로 관련 태스크를 확인할 것
- 새 작업이면 태스크 티켓을 먼저 생성할 것
- 작업 중간중간 `add_activity`로 진행 상황을 기록할 것
- 작업 완료 시 `update_task_status`로 상태를 변경할 것
- 프로젝트명은 기존 태스크와 일관되게 사용할 것

## 대규모 작업 (3개 이상 독립 단계)

1. Marblo MCP로 태스크 티켓을 먼저 생성 (`create_tasks_bulk`)
2. 병렬로 작업 가능한 것은 병렬로 진행
3. 각 단계마다 `add_activity`로 진행 상황을 티켓에 기록
4. 작업 완료 시 `update_task_status`로 상태 변경
