# Marblo (마블로) Project Rules

- Backend: FastAPI (port 8001), Frontend: Next.js (port 3001)
- Docker Compose로 운영. 코드 변경 후 `docker compose up -d --build` 필요
- SQLAlchemy 관계 조회 시 반드시 `selectinload()` 사용
- v3 포매팅은 `./v3/node_modules/.bin/prettier` 만 쓴다. `npx prettier`는 절대 금지 — npx는 전역 캐시가 물고 있는 버전을 해석해서 repo가 고정한 `v3/package.json`의 `^3.8.3`(설정은 `v3/.prettierrc`)과 다른 결과를 낼 수 있다
