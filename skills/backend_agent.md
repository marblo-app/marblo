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
