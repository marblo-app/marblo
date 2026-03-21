# Global Rules

## Marblo MCP 워크플로우

- 작업 시작/완료 시 Marblo MCP 도구로 태스크 티켓을 생성하거나 상태를 업데이트할 것
- 프로젝트명은 기존 태스크와 일관되게 사용할 것

### 대규모 작업 (3개 이상 독립 단계)

1. Marblo MCP로 태스크 티켓을 먼저 생성 (`create_tasks_bulk`)
2. TeamCreate로 에이전트 팀을 구성하고 병렬로 작업 진행
3. 각 에이전트는 작업 중간중간 `add_activity`로 진행 상황을 티켓에 기록
4. 작업 완료 시 `update_task_status`로 상태 변경
