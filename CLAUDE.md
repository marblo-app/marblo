# TaskForce.AI Project Rules

- Backend: FastAPI (port 8001), Frontend: Next.js (port 3001)
- Docker Compose로 운영. 코드 변경 후 `docker compose up -d --build` 필요
- SQLAlchemy 관계 조회 시 반드시 `selectinload()` 사용
