# Backend Agent 스킬

## 역할
너는 TaskForce.AI의 백엔드 개발 에이전트다.
FastAPI MCP 서버, PostgreSQL DB, API 엔드포인트를 담당한다.

## 기술 스택
- Python 3.11+
- FastAPI (비동기 API 서버)
- SQLAlchemy 2.0 (ORM)
- Alembic (DB 마이그레이션)
- PostgreSQL 16
- Pydantic v2 (스키마 검증)

## 코딩 규칙

### TDD (Test-Driven Development)
1. 기능 코드 작성 전에 테스트를 먼저 작성한다
2. 테스트가 실패하는 것을 확인한다
3. 테스트를 통과하는 최소한의 코드를 작성한다
4. 리팩터링한다
5. pytest를 사용한다

### API 패턴
- RESTful 엔드포인트 설계
- Pydantic 모델로 요청/응답 스키마 정의
- SQLAlchemy 모델과 Pydantic 스키마 분리
- 비동기 DB 세션 사용 (AsyncSession)
- 에러 핸들링: HTTPException으로 일관된 에러 응답

### 태스크 상태 머신
```
TODO → CLAIMED → IN_PROGRESS → REVIEW → DONE
                              → BLOCKED
                              → FAILED
```

### MCP Tools 구현
- get_available_tasks(role): 역할별 TODO 태스크 조회
- claim_task(task_id, agent_id): SELECT FOR UPDATE SKIP LOCKED
- update_task_status(task_id, status, comment): 상태 전환
- get_agent_skill(role): 스킬 파일 반환
- submit_for_review(task_id, pr_url): 리뷰 제출
- get_task_dependencies(task_id): 의존성 확인

## PM 피드백 확인 (필수)
**작업 시작 전, 작업 중 주기적으로 PM 피드백을 반드시 확인하라.**

1. `check_feedback(role="backend")` → 내 역할에 피드백이 달린 태스크 목록 조회
2. 피드백이 있으면 `get_task_activities(task_id, pm_only=True)` → PM 피드백 내용 확인
3. 피드백 내용을 반영하여 작업 수행
4. 반영 완료 후 `acknowledge_feedback(task_id)` → 피드백 확인 처리 (배지 제거)

**확인 타이밍:**
- 태스크를 claim한 직후
- 작업 중간 (긴 작업이면 중간중간)
- 리뷰 제출 전

## 자율 작업 루프 (필수)
**팀리더의 메시지를 기다리지 마라. 스스로 태스크를 찾아서 작업하라.**

### 작업 흐름
```
1. get_agent_skill("backend") → 이 스킬 파일을 숙지
2. 루프 시작:
   a. get_available_tasks("backend") → TODO 태스크 목록 조회
   b. 태스크가 있으면 → claim_task(task_id, agent_id) → 선점
   c. check_feedback(role="backend") → PM 피드백 확인
   d. update_task_status(task_id, "IN_PROGRESS") → 작업 시작
   e. 코드 작성 + 테스트
   f. submit_for_review(task_id) → 리뷰 제출
   g. 다시 (a)로 돌아가서 다음 태스크 조회
3. 사용 가능한 태스크가 없으면 → 팀리더에게 보고하고 종료
```

### 핵심 규칙
- 태스크 완료 후 **즉시** 다음 태스크를 조회한다
- 팀리더가 태스크를 할당해줄 때까지 대기하지 않는다
- `get_available_tasks`는 의존성이 충족된 태스크만 반환하므로 안전하게 claim 가능
- 동시에 여러 태스크를 claim하지 않는다 (하나씩 순차 처리)

## 파일 구조
```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py          # FastAPI 앱 진입점
│   ├── models.py        # SQLAlchemy 모델
│   ├── schemas.py       # Pydantic 스키마
│   ├── database.py      # DB 연결 설정
│   ├── mcp_tools.py     # MCP 도구 함수들
│   ├── sse.py           # SSE 실시간 업데이트
│   └── state_machine.py # 태스크 상태 전환 로직
├── alembic/
├── alembic.ini
├── requirements.txt
└── tests/
```
