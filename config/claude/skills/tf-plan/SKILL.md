---
name: tf-plan
description: 프로젝트 PRD를 작성하고 태스크 분해 계획을 수립합니다. 코드를 쓰기 전에 충분히 생각하는 단계입니다.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
argument-hint: [프로젝트 설명 또는 아이디어]
---

# TaskForce 프로젝트 플래닝

> 코드를 한 줄도 쓰기 전에, 충분히 생각하고 계획을 세우는 단계입니다.
> 이 스킬은 태스크를 생성하지 않습니다. 계획만 수립합니다.
> 계획이 확정되면 `/tf-start`로 실제 실행합니다.

---

## Phase 1: 브레인스토밍 (소크라틱 질문법)

사용자의 아이디어를 구체화합니다. 바로 설계하지 말고, 먼저 질문합니다.

### 필수 질문 (모두 확인)

1. **핵심 가치**: "이 프로젝트가 해결하는 문제가 뭔가요? 한 문장으로."
2. **사용자**: "누가 쓰나요? 본인용? 팀용? 일반 공개?"
3. **핵심 기능**: "반드시 있어야 하는 기능 3개만 꼽으면?"
4. **기술 선호**: "선호하는 기술 스택이 있나요? (없으면 추천해드립니다)"
5. **범위 확인**: "MVP 먼저 만들고 확장할까요, 처음부터 풀 기능으로 갈까요?"

### 추가 질문 (상황에 따라)

- "외부 API 연동이 필요한가요?" (인증, 결제, 소셜 로그인 등)
- "데이터는 어디서 오나요?" (사용자 입력, API, 크롤링, 파일)
- "비슷한 서비스가 있나요? 어떤 점이 다른가요?"
- "배포 환경은?" (로컬, Docker, 클라우드)

> **원칙**: 모호한 상태로 설계에 들어가지 않는다. 5개 필수 질문의 답이 나올 때까지 진행하지 않는다.

---

## Phase 2: PRD (Product Requirements Document) 작성

브레인스토밍 결과를 구조화된 문서로 정리합니다.

### PRD 템플릿

```markdown
# [프로젝트명] PRD

## 한 줄 요약
[이 프로젝트가 뭔지 한 문장으로]

## 핵심 문제
[해결하려는 문제]

## 대상 사용자
[누가 쓰는지]

## 기술 스택
- Backend: [예: FastAPI + PostgreSQL]
- Frontend: [예: Next.js 14 + Tailwind CSS]
- AI/API: [예: Claude API, YouTube Data API]
- Infra: [예: Docker Compose]

## 핵심 기능 (MVP)
1. [기능 1] — [한 줄 설명]
2. [기능 2] — [한 줄 설명]
3. [기능 3] — [한 줄 설명]

## 화면 목록
| 화면 | 경로 | 핵심 요소 |
|------|------|----------|
| [화면명] | /path | [입력, 버튼, 데이터 표시 등] |

## API 엔드포인트
| Method | Path | 설명 |
|--------|------|------|
| POST | /api/xxx | [설명] |
| GET | /api/xxx | [설명] |

## DB 테이블
| 테이블 | 주요 컬럼 | 관계 |
|--------|----------|------|
| users | id, email, name | — |
| posts | id, user_id, title | → users |

## 제외 (NOT in scope)
- [MVP에서 빼는 것 1]
- [MVP에서 빼는 것 2]
```

### PRD 작성 규칙

- **구체적으로**: "사용자 관리" ✗ → "이메일+비밀번호 로그인, 프로필 수정" ✓
- **측정 가능하게**: "빠르게" ✗ → "API 응답 500ms 이내" ✓
- **제외 항목 명시**: 안 하는 것도 적어야 scope creep 방지

---

## Phase 3: 태스크 분해

PRD를 기반으로 TaskForce 태스크로 분해합니다.

### 분해 원칙

1. **크기**: 태스크 1개 = 1~2시간 분량. 더 크면 쪼개고, 더 작으면 합친다.
2. **단위**: API 엔드포인트 1개 = 태스크 1개가 좋은 기준.
3. **의존성**: 반드시 순서가 있는 것만 depends_on. 독립적이면 병렬 처리 가능.
4. **scope**: 각 태스크가 수정할 파일을 미리 지정 → Git 충돌 방지.
5. **검증**: 각 태스크에 "완료 기준"을 명시 (테스트 통과, API 응답 확인 등).

### 분해 순서 (의존성 그래프)

```
Layer 1: 기반 (의존성 없음)
├── DB 스키마/모델 설계
├── 프로젝트 초기 세팅
└── 독립 유틸리티

Layer 2: 핵심 API (Layer 1에 의존)
├── API 엔드포인트 A
├── API 엔드포인트 B
└── 인증/권한

Layer 3: 프론트엔드 (Layer 2에 의존)
├── 화면 A
├── 화면 B
└── 공통 컴포넌트

Layer 4: 통합 (Layer 2, 3에 의존)
├── 통합 테스트
├── E2E 테스트
└── Docker/배포
```

### 태스크 카드 형식

각 태스크를 이 형식으로 정리합니다:

```
TASK-001: [제목]
  role: backend | frontend | test | devops
  priority: 5(긴급) ~ 1(낮음)
  depends_on: [TASK-NNN, ...]
  scope: [수정할 파일 경로들]
  완료 기준: [어떻게 되면 끝인지]
  예상 산출물: [생성/수정할 파일 목록]
```

### 카테고리별 태스크 분해 템플릿

**A. SaaS 웹앱** (8~12개 태스크):
```
TASK-001: DB 스키마 설계 (backend, priority: 5)
TASK-002: 인증 API (backend, priority: 5, depends_on: 001)
TASK-003: 핵심 비즈니스 API (backend, priority: 4, depends_on: 001)
TASK-004: 로그인 UI (frontend, priority: 4, depends_on: 002)
TASK-005: 메인 대시보드 UI (frontend, priority: 3, depends_on: 003)
TASK-006: 결제 연동 (backend, priority: 3, depends_on: 003)
TASK-007: 통합 테스트 (test, priority: 2, depends_on: 005)
TASK-008: Docker + CI/CD (devops, priority: 2, depends_on: 007)
```

**B. 데이터 파이프라인** (6~8개 태스크):
```
TASK-001: 데이터 소스 연결 (backend, priority: 5)
TASK-002: 데이터 수집/크롤링 (backend, priority: 5, depends_on: 001)
TASK-003: 데이터 처리/변환 (backend, priority: 4, depends_on: 002)
TASK-004: AI 분석/요약 (backend, priority: 4, depends_on: 003)
TASK-005: 결과 대시보드 (frontend, priority: 3, depends_on: 004)
TASK-006: 스케줄러/자동화 (devops, priority: 2, depends_on: 003)
```

**C. 크롬 확장/봇** (5~7개 태스크):
```
TASK-001: 핵심 로직 모듈 (backend, priority: 5)
TASK-002: 외부 API 연동 (backend, priority: 4, depends_on: 001)
TASK-003: UI/팝업 (frontend, priority: 4, depends_on: 001)
TASK-004: 설정/옵션 페이지 (frontend, priority: 3, depends_on: 003)
TASK-005: 테스트 (test, priority: 2, depends_on: 002)
```

---

## Phase 4: 검토 + 확정

계획을 사용자에게 보여주고 확인을 받습니다.

### 검토 체크리스트

- [ ] 모든 핵심 기능이 태스크에 포함되어 있는가?
- [ ] 의존성 순서가 맞는가? (순환 의존성 없는가?)
- [ ] 각 태스크의 scope가 겹치지 않는가?
- [ ] 태스크 크기가 적절한가? (너무 크거나 작지 않은가?)
- [ ] 제외 항목이 명확한가?

### 확정 후

1. PRD 파일을 프로젝트에 저장합니다: `docs/PRD.md`
2. 사용자에게 안내합니다:
   > "계획이 확정되었습니다. `/tf-start`를 실행하면 태스크가 생성되고 에이전트가 작업을 시작합니다."

> **중요**: 이 단계에서 `create_tasks_bulk`를 실행하지 않습니다. 계획만 수립합니다.
