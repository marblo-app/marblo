---
name: tf-plan
description: 프로젝트 PRD(기능+비기능+제약+리스크)를 작성하고 18-22개 태스크로 분해(모델 추천 포함). 코드를 쓰기 전에 충분히 생각하는 무거운 플래닝 단계입니다.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
argument-hint: [프로젝트 설명 또는 아이디어]
---

# Marblo 프로젝트 플래닝

> 코드를 한 줄도 쓰기 전에, 충분히 생각하고 계획을 세우는 단계입니다.
> 이 스킬은 태스크를 생성하지 않습니다. 계획만 수립합니다.
> 계획이 확정되면 `/tf-start`로 실제 실행합니다.
>
> **`/tf-analyze` 와의 차이**: `/tf-analyze` 는 빠른 컴포넌트·역할·의존성 스케치
> (분 단위). `/tf-plan` 은 PRD 작성 + 18-22개 태스크 분해 + 비기능/제약/리스크
> 식별까지 다루는 무거운 버전 (수십 분~수 시간 단위).
>
> **4 페이즈**: ① 8개 필수 + 5-7개 추가 소크라틱 질문 → ② PRD (기능·NFR·제약·
> KPI·시스템 구성도·리스크·가정) → ③ 18-22개 태스크 분해 (모델 추천 포함) →
> ④ 검토 체크리스트.

---

## ⛔ 필수 규칙: Marblo MCP 전용

> **절대 Claude Code 내장 도구(TaskCreate, TaskList, TaskUpdate, TaskGet)를 사용하지 마세요.**
> 모든 태스크 관련 작업은 반드시 **Marblo MCP 도구**를 사용합니다:
> `create_tasks_bulk`, `create_task`, `get_all_tasks`, `get_available_tasks`,
> `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`,
> `check_feedback`, `get_task_activities`, `get_agent_skill`, `get_task_dependencies`
>
> Claude Code 내장 TaskCreate로 태스크를 만들면 Marblo 대시보드에 표시되지 않습니다.

---

## Phase 0: 프로젝트명 확정

**`/tf-start`에서 사용할 프로젝트명을 먼저 확정합니다.**

1. 사용자에게 프로젝트명을 제안하거나 물어봅니다:
   ```
   📦 프로젝트명을 정해주세요.
   예: youtube-insight, todo-app, my-saas
   (영문 소문자 + 하이픈 권장, 모든 태스크 티켓에 이 이름이 사용됩니다)
   ```
2. 사용자 승인 후 이 이름을 PRD에 기록합니다.
3. **이후 모든 태스크 생성 시 이 프로젝트명을 일관되게 사용합니다.**

---

## Phase 1: 브레인스토밍 (소크라틱 질문법)

사용자의 아이디어를 구체화합니다. 바로 설계하지 말고, 먼저 질문합니다.
모호한 상태로 설계에 들어가면 잘못된 PRD 와 잘못된 태스크가 만들어집니다.

### 필수 질문 — 8개 (모두 답이 나올 때까지 다음 단계 진행 X)

**A. 문제·사용자**

1. **핵심 가치**: "이 프로젝트가 해결하는 문제가 뭔가요? 한 문장으로."
2. **페르소나 페인포인트**: "지금 사용자가 이 문제를 어떻게 해결하고 있나요? 그게 왜 불충분한가요?"
3. **사용자 규모**: "MVP 출시 시점 예상 사용자 수는? (10명? 100명? 10만 명?)"

**B. 스코프·성공지표**

<!-- prettier-ignore-start -->

4. **핵심 기능**: "반드시 있어야 하는 기능 3개만 꼽으면?"
5. **성공지표**: "어떻게 됐을 때 성공인가요? 측정 가능한 지표 1-3개. (DAU, 응답시간, 전환율 등)"
6. **범위 확인**: "MVP 먼저 만들고 확장할까요, 처음부터 풀 기능으로 갈까요?"
<!-- prettier-ignore-end -->

**C. 기술·운영**

<!-- prettier-ignore-start -->

7. **기술 선호**: "선호하는 기술 스택이 있나요? 왜 그 선택인가요? (없으면 추천)"
8. **운영 환경**: "어디서 돌아가나요? (로컬/Docker/AWS/Vercel...) 예산 제약은? 일정 제약은?"
<!-- prettier-ignore-end -->

### 추가 질문 — 상황에 따라 5-7개 (해당되는 것만)

- **외부 의존**: "외부 API 연동이 필요한가요?" (인증, 결제, 소셜 로그인, LLM 등)
- **데이터 출처**: "데이터는 어디서 오나요?" (사용자 입력, 외부 API, 크롤링, 파일 업로드)
- **경쟁/차별화**: "비슷한 서비스가 있나요? 우리는 어떤 점이 다른가요?"
- **규제·보안**: "개인정보·결제·의료 데이터를 다루나요? GDPR/PCI-DSS 같은 규제 대상인가요?"
- **성능 SLO**: "응답시간 목표가 있나요? (p50/p95) 동시 사용자 목표는?"
- **접근성·다국어**: "i18n 필요? 접근성 (WCAG) 준수 수준은?"
- **인하우스 운영**: "팀에서 누가 운영하나요? 모니터링/알림 어디로?"

> **원칙**: 8개 필수 답이 모두 명확해질 때까지 Phase 2 로 안 넘어간다. 추가 질문은
> 모호함이 남은 만큼만 묻고 멈춘다. "잘 모르겠다" 가 답으로 나오면 가장 합리적인
> 가정을 명시한 뒤 PRD 의 **가정 (Assumptions)** 섹션에 기록한다.

---

## Phase 2: PRD (Product Requirements Document) 작성

브레인스토밍 결과를 구조화된 문서로 정리합니다.

### PRD 템플릿

````markdown
# [프로젝트명] PRD

## 한 줄 요약

[이 프로젝트가 뭔지 한 문장으로]

## 핵심 문제

[해결하려는 문제 + 현재 사용자가 어떻게 해결하고 있는지 + 그게 왜 불충분한지]

## 대상 사용자

- **주요 페르소나**: [예: 30대 1인 창업자, 영업팀 PM]
- **예상 규모**: [MVP 출시 시 N명, 6개월 후 M명]
- **사용 맥락**: [언제·어디서·왜 이걸 쓰는지]

## 성공지표 (KPI)

| 지표           | 목표값       | 측정 방법   |
| -------------- | ------------ | ----------- |
| [예: DAU]      | [예: 100명]  | [측정 도구] |
| [예: p95 응답] | [예: ≤500ms] | [APM]       |
| [예: 전환율]   | [예: 5%]     | [Analytics] |

## 기술 스택

- Backend: [예: FastAPI + PostgreSQL]
- Frontend: [예: Next.js 14 + Tailwind CSS]
- AI/API: [예: Claude API, YouTube Data API]
- Infra: [예: Docker Compose, Vercel, AWS Fargate]

## 시스템 구성도

```text
[ASCII 또는 Mermaid 블록으로 핵심 컴포넌트 + 데이터 흐름 표시]

예시 (ASCII):
  ┌────────┐   HTTPS    ┌──────────┐   SQL    ┌──────────┐
  │ Browser├───────────►│  FastAPI ├─────────►│ Postgres │
  └────────┘            └────┬─────┘          └──────────┘
                             │ HTTP
                             ▼
                       ┌──────────┐
                       │ Claude API│
                       └──────────┘
```
````

## 핵심 기능 (MVP)

1. [기능 1] — [한 줄 설명]
2. [기능 2] — [한 줄 설명]
3. [기능 3] — [한 줄 설명]

## 화면 목록

| 화면     | 경로  | 핵심 요소                    |
| -------- | ----- | ---------------------------- |
| [화면명] | /path | [입력, 버튼, 데이터 표시 등] |

## API 엔드포인트

| Method | Path     | 설명   | 인증 |
| ------ | -------- | ------ | ---- |
| POST   | /api/xxx | [설명] | JWT  |
| GET    | /api/xxx | [설명] | 공개 |

## DB 테이블

| 테이블 | 주요 컬럼          | 관계    |
| ------ | ------------------ | ------- |
| users  | id, email, name    | —       |
| posts  | id, user_id, title | → users |

## 비기능 요구사항 (NFR)

- **성능**: [예: p50 ≤200ms, p95 ≤500ms / 동시 100 req/s]
- **가용성**: [예: 99.5% (MVP), 99.9% (1.0)]
- **보안**: [예: HTTPS-only, bcrypt, OWASP Top 10 점검]
- **데이터/규제**: [예: 개인정보 GDPR/PIPA, 결제 PCI-DSS, 의료 HIPAA]
- **접근성**: [예: WCAG 2.1 AA / 키보드 네비게이션]
- **다국어**: [예: ko, en — i18n-ready 또는 ko-only]
- **관측성**: [예: 구조화 로그, Sentry, p95 알람]

## 제약조건 (Constraints)

- **예산**: [예: 월 인프라 비용 $100 이내]
- **일정**: [예: MVP 4주, β 8주]
- **팀**: [예: 풀스택 1명 / Backend 2 + Frontend 1]
- **외부 의존**: [예: Stripe 한국 결제 미지원 → Toss 사용]
- **기술적 제약**: [예: 기존 시스템과 OAuth 통합 필수]

## 리스크 (Risks)

| 리스크      | 영향 | 확률 | 대응                        |
| ----------- | ---- | ---- | --------------------------- |
| [기술]      | 高   | 中   | [PoC, 백업 라이브러리 식별] |
| [일정]      | 中   | 高   | [scope 축소 트리거 정의]    |
| [외부 의존] | 高   | 低   | [SLA 확인, fallback 경로]   |

## 가정 (Assumptions)

> Phase 1 에서 "잘 모르겠다" 였던 항목과 합리적 추측을 기록.
> 가정이 깨지면 PRD 재검토 트리거.

- [가정 1 + 만약 틀리면 어떻게 되는지]
- [가정 2]

## 제외 (NOT in scope)

- [MVP에서 빼는 것 1]
- [MVP에서 빼는 것 2]

```

### PRD 작성 규칙

- **구체적으로**: "사용자 관리" ✗ → "이메일+비밀번호 로그인, 프로필 수정" ✓
- **측정 가능하게**: "빠르게" ✗ → "API 응답 p95 500ms 이내" ✓
- **제외 항목 명시**: 안 하는 것도 적어야 scope creep 방지
- **가정 명시**: "잘 모르겠다" 영역은 가정으로 박제 — 추후 검증 가능

---

## Phase 3: 태스크 분해

PRD를 기반으로 Marblo 태스크로 분해합니다.

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
model: opus | sonnet | haiku # ← 모델 추천 (아래 가이드 참고)
priority: 5(긴급) ~ 1(낮음)
depends_on: [TASK-NNN, ...]
scope: [수정할 파일 경로들]
완료 기준: [어떻게 되면 끝인지 — 측정 가능하게]
예상 산출물: [생성/수정할 파일 목록]

```

### 모델 추천 가이드

태스크 복잡도에 맞춰 모델을 매칭해 비용·속도를 최적화합니다.

| 복잡도 | 모델 | 적합한 태스크                                                  |
| ------ | ------- | --------------------------------------------------------------- |
| 高     | **opus**   | 아키텍처 설계, DB 스키마 + 마이그레이션, 복잡한 알고리즘, AI 프롬프트 엔지니어링, 보안·인증 구현 |
| 中     | **sonnet** | 일반 API 엔드포인트, 비즈니스 로직, React 화면, 통합 테스트, Docker/CI 파이프라인 |
| 低     | **haiku**  | 단순 CRUD, 정적 UI 컴포넌트, 문서/주석, 환경변수 정리, 간단한 수정 |

> **원칙**: 의심되면 한 단계 위로. opus 가 sonnet 보다 비싸지만 재작업 비용보다 싸다.

---

### 카테고리별 태스크 분해 템플릿

각 카테고리는 18-22개의 표준 태스크를 제공합니다. 프로젝트 특성에 맞춰 일부를
빼거나 합쳐도 됩니다. **하한 18개를 너무 쉽게 깎지 말 것** — 테스트·관측성·문서는
나중에 항상 필요합니다.

#### A. SaaS 웹앱 (18~22개)

```

=== Layer 1: 기반 ===
TASK-001: 프로젝트 초기 세팅 (devops, sonnet, p:5) — repo, 린트, 포매터, 기본 CI skeleton
TASK-002: DB 스키마 설계 + 마이그레이션 (backend, opus, p:5) — ERD, 인덱스, 제약조건
TASK-003: 환경변수/시크릿 관리 (devops, haiku, p:5) — .env.example, secrets 정책

=== Layer 2: 인증·핵심 API ===
TASK-004: 인증 시스템 (backend, opus, p:5, deps:002) — JWT/세션, bcrypt, refresh
TASK-005: 사용자 프로필 API (backend, sonnet, p:4, deps:004) — GET/PATCH /me
TASK-006: 핵심 도메인 API #1 (backend, sonnet, p:4, deps:002) — CRUD 1
TASK-007: 핵심 도메인 API #2 (backend, sonnet, p:4, deps:002) — CRUD 2
TASK-008: 권한/RBAC 미들웨어 (backend, opus, p:4, deps:004) — 역할별 가드

=== Layer 3: 결제·외부 연동 ===
TASK-009: 결제 연동 (backend, opus, p:3, deps:004) — webhook, idempotency
TASK-010: 이메일/알림 시스템 (backend, sonnet, p:3, deps:004) — 트랜잭션 메일

=== Layer 4: 프론트엔드 ===
TASK-011: 디자인 시스템/공통 컴포넌트 (frontend, sonnet, p:4, deps:001)
TASK-012: 로그인/회원가입 UI (frontend, sonnet, p:4, deps:004)
TASK-013: 대시보드 화면 (frontend, sonnet, p:3, deps:006)
TASK-014: 핵심 기능 화면 #1 (frontend, sonnet, p:3, deps:007)
TASK-015: 설정/프로필 화면 (frontend, haiku, p:2, deps:005)
TASK-016: 결제·구독 관리 화면 (frontend, sonnet, p:3, deps:009)

=== Layer 5: 품질·운영 ===
TASK-017: 단위 테스트 (test, sonnet, p:2, deps:008) — 핵심 API/비즈니스 로직
TASK-018: E2E 테스트 (test, sonnet, p:2, deps:014) — 골든 패스
TASK-019: 관측성 (devops, sonnet, p:2, deps:008) — 로그·메트릭·Sentry
TASK-020: Docker + CI/CD (devops, sonnet, p:2, deps:017)
TASK-021: README/운영 문서 (devops, haiku, p:1, deps:020)
TASK-022: 보안 점검 (test, opus, p:2, deps:020) — OWASP 체크리스트

```

#### B. 데이터 파이프라인 (18~20개)

```

=== Layer 1: 기반 ===
TASK-001: 프로젝트 세팅 + 환경 (devops, sonnet, p:5)
TASK-002: 데이터 모델/스키마 (backend, opus, p:5) — raw / staged / mart
TASK-003: 시크릿/외부 자격증명 관리 (devops, haiku, p:5)

=== Layer 2: 수집 ===
TASK-004: 데이터 소스 #1 커넥터 (backend, sonnet, p:5, deps:003)
TASK-005: 데이터 소스 #2 커넥터 (backend, sonnet, p:5, deps:003)
TASK-006: 수집 스케줄러 (devops, sonnet, p:4, deps:004) — cron / Airflow / Cloud Scheduler
TASK-007: rate-limit/retry/idempotency (backend, opus, p:4, deps:004) — 재시도·중복방지

=== Layer 3: 변환·AI ===
TASK-008: 데이터 정제/검증 (backend, sonnet, p:4, deps:002) — Pydantic/Pandera
TASK-009: 데이터 변환 ETL (backend, sonnet, p:4, deps:008)
TASK-010: AI 분석/요약 모듈 (backend, opus, p:4, deps:009) — 프롬프트, 결과 검증
TASK-011: 결과 저장/캐시 (backend, sonnet, p:3, deps:010)

=== Layer 4: 출력·관측 ===
TASK-012: REST API for 결과 조회 (backend, sonnet, p:3, deps:011)
TASK-013: 대시보드 UI (frontend, sonnet, p:3, deps:012)
TASK-014: 다운로드/Export (CSV/JSON) (backend, haiku, p:2, deps:012)
TASK-015: 데이터 품질 모니터링 (devops, sonnet, p:3, deps:008) — null/drift 알람

=== Layer 5: 품질·운영 ===
TASK-016: 단위 테스트 (test, sonnet, p:2, deps:010)
TASK-017: 통합 테스트 (test, sonnet, p:2, deps:013)
TASK-018: 비용 모니터링 (devops, sonnet, p:2, deps:010) — AI/스토리지 비용 알람
TASK-019: Docker + CI/CD (devops, sonnet, p:2, deps:016)
TASK-020: 운영 문서/runbook (devops, haiku, p:1, deps:019)

```

#### C. 크롬 확장/봇 (18~20개)

```

=== Layer 1: 기반 ===
TASK-001: 프로젝트 세팅 + manifest v3 (devops, sonnet, p:5)
TASK-002: 빌드 파이프라인 (vite/webpack) (devops, sonnet, p:5)
TASK-003: 시크릿/API 키 저장 정책 (backend, opus, p:5) — chrome.storage / safeStorage

=== Layer 2: 핵심 로직 ===
TASK-004: 핵심 도메인 모듈 (backend, opus, p:5, deps:001)
TASK-005: 외부 API 클라이언트 (backend, sonnet, p:4, deps:003)
TASK-006: rate-limit/retry/캐시 (backend, sonnet, p:4, deps:005)
TASK-007: 백그라운드 서비스워커 (backend, opus, p:4, deps:004)
TASK-008: content script + 페이지 통신 (backend, sonnet, p:4, deps:007)

=== Layer 3: UI ===
TASK-009: 공통 UI 컴포넌트 (frontend, haiku, p:3, deps:002)
TASK-010: 팝업 UI (frontend, sonnet, p:4, deps:004)
TASK-011: 옵션/설정 페이지 (frontend, sonnet, p:3, deps:010)
TASK-012: 사이드패널/오버레이 (frontend, sonnet, p:3, deps:008)
TASK-013: 첫 실행 온보딩 (frontend, haiku, p:2, deps:010)

=== Layer 4: 권한·보안 ===
TASK-014: 권한 요청·검증 흐름 (backend, opus, p:3, deps:007) — 최소 권한 원칙
TASK-015: 사용자 동의·텔레메트리 (backend, sonnet, p:2, deps:014)

=== Layer 5: 품질·운영 ===
TASK-016: 단위 테스트 (test, sonnet, p:2, deps:004)
TASK-017: 통합/E2E 테스트 (test, sonnet, p:2, deps:012) — Playwright + 확장 로드
TASK-018: 스토어 등록 자료 (devops, haiku, p:2, deps:017) — 스크린샷·설명·정책
TASK-019: CI 자동 빌드/패키징 (devops, sonnet, p:2, deps:002)
TASK-020: 사용자 문서/FAQ (devops, haiku, p:1, deps:018)

```

> **태스크 수가 줄어드는 케이스**: 본격 운영 없음(개인 사이드 프로젝트),
> 외부 결제·인증 없음, 단일 화면 등. 그래도 **테스트·CI·문서**는 빼지 말 것.

---

## Phase 4: 검토 + 확정

계획을 사용자에게 보여주고 확인을 받습니다.

### 검토 체크리스트

**PRD 완성도**
- [ ] 모든 핵심 기능이 태스크에 포함되어 있는가?
- [ ] 성공지표 (KPI) 가 측정 가능한가?
- [ ] 비기능 요구사항 (성능·보안·규제·접근성·관측성) 이 명시되어 있는가?
- [ ] 제약조건 (예산·일정·외부 의존) 이 명시되어 있는가?
- [ ] 리스크 + 대응 방안이 식별되어 있는가?
- [ ] 가정 (Assumptions) 이 명시되어 있고 깨졌을 때 대처가 보이는가?
- [ ] 제외 (NOT in scope) 항목이 명확한가?
- [ ] 시스템 구성도가 핵심 데이터 흐름을 보여주는가?

**태스크 분해 완성도**
- [ ] 태스크 개수가 적정 범위(18-22) 안에 있는가? (이탈 시 사유 명시)
- [ ] 의존성 순서가 맞는가? (순환 의존성 없는가?)
- [ ] 각 태스크의 scope 가 겹치지 않는가?
- [ ] 태스크 크기가 적절한가? (너무 크거나 작지 않은가? 1-2시간 분량?)
- [ ] 각 태스크에 모델 추천 (opus/sonnet/haiku) 이 붙어 있는가?
- [ ] 테스트 · CI/CD · 문서 태스크가 빠지지 않았는가?
- [ ] 완료 기준이 측정 가능한가?

### 확정 후

1. PRD 파일을 프로젝트에 저장합니다: `docs/PRD.md`
2. 사용자에게 안내합니다:
   > "계획이 확정되었습니다. `/tf-start`를 실행하면 태스크가 생성되고 에이전트가 작업을 시작합니다."

> **중요**: 이 단계에서 `create_tasks_bulk`를 실행하지 않습니다. 계획만 수립합니다.
> **중요**: PRD에 프로젝트명이 반드시 포함되어야 합니다. `/tf-start`가 이 이름으로 태스크를 생성합니다.
```
