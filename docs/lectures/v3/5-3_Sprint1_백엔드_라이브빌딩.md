---
tags: [강의, v3, 모듈5]
type: lecture
aliases: [Sprint 1 백엔드, 라이브 빌딩]
---

# Sprint 1 — 백엔드 라이브 빌딩

> 모듈 5 · 섹션 5-3 · 약 40분
> 관련: [[5-2_태스크일괄생성_이종배정]] | [[5-4_Sprint2_프론트_병렬통합]]

---

## 이 강의에서 다루는 것

- **학습목표:** 레인에서 Claude·Codex가 백엔드 12개 태스크를 **동시에** 짓는 모습을 관찰하고, REVIEW 사이클로 의존성을 연쇄 해제하는 라이브 빌딩의 리듬을 체득한다.
- **시연할 마블로 화면·기능:** 레인 탭(병렬 레인 + PTY attach) + 보드 탭(REVIEW 이동·의존성 해제) + `/tf-review`.
- **진행할 프로젝트 단계:** P3 백엔드 — DB·OAuth·CSV·LLM 분석·5톤 생성·발송 큐·결제.
- **핵심 메시지:** "라이브로 짓는다 — 에러도 교육 자료. 모델 분담은 PRD에서 잡아두면 매끄럽다."

---

## 도입 — 두 모델이 동시에 (5분)

본격적인 라이브 빌딩입니다. 22개 중 백엔드 12개를 두 이종 에이전트가 분담합니다.

> 화면: 레인 탭 — 의존성 풀린 카드가 IN_PROGRESS로 이동

이번 Sprint의 백엔드 분담은 이렇습니다.

```
[backend-codex 담당 — 6개] (codex)
  TASK-001 Postgres + Alembic     TASK-003 CSV 임포트
  TASK-006 메일 발송 + 큐         TASK-008 발송 Webhook 수신
  TASK-012 사용량 한도 미들웨어   TASK-019 Docker Compose

[backend-claude 담당 — 7개] (claude)
  TASK-002 Email + Google OAuth   TASK-004 회사·직책 LLM 분석
  TASK-005 5톤 메일 병렬 생성     TASK-007 A/B 실험 분할
  TASK-009 응답률 집계 + 대시보드 API
  TASK-010 토스 결제 위젯         TASK-011 토스 webhook + 정기결제
```

**왜 같은 백엔드인데 모델이 다른가:** 패턴이 명확한 보일러플레이트(DB 스키마·큐·webhook 수신·Docker)는 Codex가 빠르고 정확하게, 견고함과 설계 판단이 필요한 것(OAuth·LLM 호출 설계·결제 정합성·집계 쿼리)은 Claude가 맡습니다. 수강자가 손으로 모델을 지정하지 않아도 마블로가 역할·태그를 보고 골고루 보냅니다.

---

## 본문

### 1. TASK-001 + 019 — backend-codex 병렬 (7분)

> 화면: 레인 탭 — backend-codex 행, 두 태스크 동시 로그(PTY attach)

backend-codex는 의존성 없는 두 태스크를 병렬로 잡습니다.

```
[backend-codex] claimed TASK-001 (Postgres + Alembic)
[backend-codex] claimed TASK-019 (Docker Compose) — parallel
[backend-codex] add_activity: "두 태스크 병렬 착수. Docker 먼저 완료 예정."
```

**TASK-019 Docker Compose** (먼저 끝남 — boilerplate, codex 우위):

```yaml
# docker-compose.yml (에이전트 자동 생성)
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: reachwave
      POSTGRES_USER: reachwave
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes: [pgdata:/var/lib/postgresql/data]
    ports: ["5432:5432"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  backend:
    build: ./backend
    env_file: .env
    depends_on: [postgres, redis]
    ports: ["8000:8000"]
  frontend:
    build: ./frontend
    env_file: .env.local
    ports: ["3000:3000"]
volumes:
  pgdata:
```

**TASK-001 Postgres 스키마** (병렬 진행):

```python
# backend/app/models.py (발췌)
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, index=True)
    provider = Column(String)           # "email" | "google"
    plan = Column(String, default="free")  # free | pro | team
    monthly_send_count = Column(Integer, default=0)
    leads = relationship("Lead", back_populates="owner", lazy="selectin")

class Lead(Base):
    __tablename__ = "leads"
    id = Column(Integer, primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id"))
    email = Column(String, index=True)
    first_name = Column(String)
    company = Column(String)
    job_title = Column(String)
    company_analysis = Column(JSON)     # LLM 분석 결과 캐시

class MailTemplate(Base):
    __tablename__ = "mail_templates"
    id = Column(Integer, primary_key=True)
    lead_id = Column(Integer, ForeignKey("leads.id"))
    tone = Column(String)               # cold|warm|deal|followup|reminder
    subject = Column(String)
    body = Column(Text)

class MailSend(Base):
    __tablename__ = "mail_sends"
    id = Column(Integer, primary_key=True)
    template_id = Column(Integer, ForeignKey("mail_templates.id"))
    owner_id = Column(Integer, ForeignKey("users.id"))
    scheduled_at = Column(DateTime, index=True)
    sent_at = Column(DateTime, nullable=True)
    opened_at = Column(DateTime, nullable=True)
    replied_at = Column(DateTime, nullable=True)
    ab_variant = Column(String, nullable=True)   # "A" | "B" | null

class Subscription(Base):
    __tablename__ = "subscriptions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    toss_billing_key = Column(String)
    status = Column(String)             # active|paused|cancelled|grace
    next_billing_at = Column(DateTime)
```

`lazy="selectin"`은 N+1 방지 패턴(마블로 프로젝트 규칙). 에이전트가 자동으로 적용합니다. Alembic 마이그레이션도 함께:

```bash
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```

### 2. TASK-002 OAuth — backend-claude 병행 (6분)

같은 시점에 backend-claude는 OAuth(설계 비중 큼)를 짓습니다.

> 화면: 레인 탭 — backend-claude 행

```
[backend-claude] claimed TASK-002 (Email + Google OAuth)
[backend-claude] designing session flow + id_token 검증
```

```python
# backend/app/routers/auth.py (발췌)
@router.post("/google")
async def google_oauth(payload: GoogleOAuthRequest, db: AsyncSession = Depends(get_db)):
    """프론트가 Google에서 받은 id_token을 검증 후 우리 JWT 발급."""
    google_user = await verify_google_token(payload.id_token)
    user = await get_or_create_user(db, email=google_user.email, provider="google")
    token = create_access_token({"sub": str(user.id), "plan": user.plan})
    return {"access_token": token, "token_type": "bearer"}

@router.post("/email/register")
async def register(data: EmailRegister, db: AsyncSession = Depends(get_db)):
    if await user_exists(db, data.email):
        raise HTTPException(409, "이미 가입된 이메일입니다")
    user = await create_user(db, email=data.email, password_hash=bcrypt.hash(data.password))
    return {"user_id": user.id}
```

Claude가 잡은 부분: **세션 만료·갱신·id_token 서명 검증·plan claim을 토큰에 임베드** 같은 설계 결정. 검증 누락이 생기기 쉬운 영역이라 자동 추천이 Claude로 갔습니다.

### 3. 첫 REVIEW 사이클 — 의존성 연쇄 해제 (8분)

> 화면: 보드 탭 — TASK-001/019/002가 REVIEW로 이동

```
/tf-status
```

```
🔵 REVIEW: 3 (TASK-001, 019, 002)
⏸  TODO: 19 (리뷰 끝나면 6개 unblock 예정)
```

**(실습)** 일괄 리뷰:

```
/tf-review
```

3개를 차례로 보여줍니다. 체크 포인트:

| 태스크            | PM 확인 사항                                                  |
| ----------------- | ------------------------------------------------------------- |
| TASK-001 (DB)     | selectin 적용 / 인덱스(`email`,`scheduled_at`) / Alembic 정상 |
| TASK-019 (Docker) | env 분리 / volumes 영속 / depends_on 순서                     |
| TASK-002 (OAuth)  | id_token 서명 검증 / JWT plan claim / 비밀번호 bcrypt         |

문제 없으면 Approve. 의존성이 한 번에 풀립니다.

```
✓ TASK-001 → unblocks: 004, 006, 010, 022
✓ TASK-002 → unblocks: 012, 013
✓ TASK-019 → (no children)
🎉 6 tasks newly unblocked
```

`/tf-status`를 다시 보면 두 에이전트가 자동으로 다음 라운드를 잡습니다.

```
backend-codex   claims TASK-003 (CSV 임포트), TASK-006 (메일 큐)
backend-claude  claims TASK-004 (회사 LLM 분석), TASK-010 (토스 결제)
frontend-codex  WAKES UP! claims TASK-013 (로그인 UI) — Sprint 2 발진!
```

여기서 **frontend-codex가 깨어납니다.** OAuth가 끝났으니 로그인 UI 시작 가능. 이제 백엔드와 프론트가 동시에 흐릅니다 — 진짜 병렬 라이브 빌딩.

### 4. 하이라이트 — 5톤 병렬 생성 + 서비스 LLM 추상화 (9분)

backend-claude가 TASK-004(회사 분석)에 이어 잡는 **TASK-005**가 이 강의의 하이라이트입니다. **서비스 LLM 하나**로 5톤을 **병렬 호출**해요.

> 화면: 레인 탭 — backend-claude 행, TASK-005 작업 로그

```python
# backend/app/services/mail_generator.py (에이전트 생성)
from app.llm.client import llm   # 추상화된 단일 진입점
import asyncio, json

TONES = ["cold", "warm", "deal-focused", "follow-up", "reminder"]
TONE_PROMPTS = {
    "cold": "Write a formal cold outreach email. No fluff, value-first opening.",
    "warm": "Write a friendly, conversational email. Reference shared context if any.",
    "deal-focused": "Write a benefit-led email. Lead with a specific offer or ROI.",
    "follow-up": "Write a polite follow-up assuming no prior reply.",
    "reminder": "Write a soft reminder one week after a follow-up.",
}

async def generate_one_tone(lead: Lead, tone: str) -> MailTemplate:
    prompt = f"""
You are an expert B2B sales copywriter.
Lead: {lead.first_name} ({lead.job_title} at {lead.company})
Company brief: {lead.company_analysis.get('summary', 'N/A')}
Instruction: {TONE_PROMPTS[tone]}
Length: 90-130 words. Output JSON: {{"subject": "...", "body": "..."}}
"""
    raw = await llm.complete(prompt, response_format="json")
    parsed = json.loads(raw)
    return MailTemplate(lead_id=lead.id, tone=tone,
                        subject=parsed["subject"], body=parsed["body"])

async def generate_all_tones(lead: Lead) -> list[MailTemplate]:
    """5톤을 병렬로 생성. 약 6~8초."""
    return await asyncio.gather(*[generate_one_tone(lead, t) for t in TONES])
```

핵심은 `app/llm/client.py`의 **추상화**입니다.

```python
# backend/app/llm/client.py — 서비스 LLM 추상화 (모델 1줄로 교체)
MODEL = "low-cost-model"   # ← 저비용 모델 1개. 운영 시 이 한 줄만 바꾸면 교체

class LLMClient:
    def __init__(self):
        self.client = make_client(api_key=settings.LLM_API_KEY)

    async def complete(self, prompt: str, response_format: str = "text") -> str:
        resp = await self.client.generate(MODEL, prompt, response_format=response_format)
        return resp.text

llm = LLMClient()
```

> **(강의 포인트)** 강조하세요.
>
> ReachWave는 **저비용 모델 하나**로 5톤을 다 만듭니다. 가격이 저렴해 강의 실습 부담이 거의 없죠. 나중에 본인이 운영할 때 더 좋은 모델로 바꾸고 싶으면 `client.py`의 `MODEL` 상수 **한 줄만** 수정하면 됩니다. "내가 만드는 서비스의 LLM"과 "나를 도와주는 코딩 에이전트(Claude·Codex)"는 다른 축이라는 걸 다시 떠올리세요. (자세한 건 [[6-5_서비스LLM_vs_코딩에이전트모델]].)

**(실습)** 리뷰 체크:

```
/tf-review TASK-005
```

- [ ] 5톤 프롬프트가 각 톤의 특징을 명확히 구분하는가?
- [ ] `asyncio.gather`로 **정말 병렬** 호출되는가? (시리얼이면 30초)
- [ ] JSON 파싱 실패 시 retry 또는 graceful 처리?
- [ ] `lead.company_analysis`가 null일 때 폴백?

피드백이 필요하면 그 자리에서 반려:

```
R
> "deal-focused" 톤이 너무 공격적이야. 한국 B2B 톤에 맞게
  "조심스러운 가치 제안"으로. 그리고 JSON 파싱 실패 시 1회 재시도 추가.
```

### 5. 메일 큐(Codex) + 토스 결제(Claude) (5분)

같은 시간, **backend-codex**는 발송 큐(패턴 명확, codex 우위)를 짓습니다.

```python
# backend/app/queues/mail_queue.py
mail_q = Queue("mail", connection=Redis.from_url(settings.REDIS_URL))

def enqueue_send(send_id: int, send_at: datetime):
    """같은 시점 동시 발송 방지 위해 ±15초 jitter."""
    jittered = send_at + timedelta(seconds=random.randint(-15, 15))
    mail_q.enqueue_at(jittered, "app.workers.send_mail", send_id)
```

**backend-claude**는 토스페이먼츠 결제(견고함 핵심)를 짓습니다. 한국 시장 필수, 강의는 **테스트키**로만.

```python
# backend/app/routers/billing.py (발췌)
@router.post("/webhook/toss")
async def toss_webhook(req: Request, body: dict = Body(...)):
    """토스 webhook idempotent 처리. 동일 paymentKey 두 번 와도 한 번만."""
    payment_key = body["paymentKey"]
    if await webhook_already_processed(payment_key):
        return {"ok": True, "idempotent": True}
    if body["eventType"] == "PAYMENT_COMPLETED":
        await mark_subscription_renewed(body)
    elif body["eventType"] == "PAYMENT_FAILED":
        await start_grace_period(body, days=3)   # 월말 카드 갱신 흔함
    await record_webhook(payment_key)
    return {"ok": True}
```

**리뷰 체크(꼭 보세요):**

- [ ] webhook **idempotent** (같은 paymentKey 두 번 와도 안전)
- [ ] grace period 3일 적용
- [ ] 빌링키는 저장하되 **카드 정보 자체는 저장 X** (PCI 회피)
- [ ] 테스트키/운영키 환경 변수 분리

> **[설명보드: 5-3 백엔드 병렬 분담]** — Excalidraw (후속 제작)
> 📊 보드 파일: [assets/5-3_백엔드_병렬분담.excalidraw](assets/5-3_백엔드_병렬분담.excalidraw) — Excalidraw 에디터/excalidraw.com 에서 열기
>
> - 왼쪽 레인 🟣 Claude: OAuth·LLM 분석·5톤 생성·결제(견고함이 필요한 핵심 로직).
> - 오른쪽 레인 Codex: DB·CSV·큐·webhook 수신·Docker(패턴화된 보일러플레이트).
> - 가운데: REVIEW 게이트 → "6 tasks unblocked" → frontend-codex "WAKE UP" 화살표.
> - 캡션: "같은 백엔드도 강점 따라 두 모델로. 사람은 리뷰만."
> - 모델 칩: Claude Code · Codex. ※ Gemini 표기 금지.

---

## 정리 (1분)

1. **이종 분담** — 백엔드 12개가 backend-claude(7, 핵심 로직) + backend-codex(6, 보일러플레이트)로 자동 분할.
2. **병렬 실행** — 의존성이 풀리면 한 라운드에 여러 태스크가 동시 진행.
3. **연쇄 활성화** — OAuth REVIEW 통과 → frontend-codex 자동 wake up → Sprint 2 발진.
4. **서비스 LLM 5톤 병렬** — `asyncio.gather`로 저비용 모델 5호출 ≈ 8초, `MODEL` 한 줄로 교체 가능.
5. **결제 견고함** — webhook idempotent + grace 3일 + PCI 회피.

다음 섹션은 Sprint 2 — frontend-codex가 6개 UI를 일관된 UX로 묶어내고, PM 피드백 루프로 품질을 끌어올린 뒤 **통합**까지 갑니다.

---

다음: [[5-4_Sprint2_프론트_병렬통합]]
