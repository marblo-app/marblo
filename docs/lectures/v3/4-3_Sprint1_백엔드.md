---
tags: [강의, v3, 모듈4]
type: lecture
aliases: [Sprint 1 백엔드]
---

# Sprint 1 — 백엔드 라이브 빌딩

> 모듈 4 · 섹션 4-3 · 약 50분
> 관련: [[4-2_태스크생성_에이전트스폰]] | [[4-4_Sprint2_프론트엔드]]

---

## 도입 (5분)

이제 본격적인 라이브 빌딩입니다. 22 태스크 중 백엔드 12개를 두 이종 에이전트가 분담해서 처리합니다.

화면: 칸반 보드 — 의존성 풀린 3개 카드가 IN_PROGRESS

이번 Sprint의 12개 백엔드 태스크:

```
[backend-codex 담당 — 8개] (gpt 모델)
  TASK-001 Postgres + Alembic
  TASK-003 CSV 임포트
  TASK-006 SendGrid + 큐 + 스케줄러
  TASK-008 SendGrid Webhook
  TASK-012 사용량 한도 미들웨어
  TASK-019 Docker Compose
  TASK-020 E2E 통합 테스트
  TASK-021 API 유닛 테스트

[backend-claude 담당 — 4개] (claude 모델)
  TASK-002 Email + Google OAuth
  TASK-004 회사·직책 LLM 분석
  TASK-005 5톤 메일 병렬 생성
  TASK-007 A/B 실험 분할 로직
  TASK-010 토스페이먼츠 결제 위젯
  TASK-011 토스 webhook + 정기결제
```

**왜 같은 백엔드 역할인데 모델이 다른가**: dispatch-scoring이 태스크 태그를 보고 `simple-fix`·`test`·`github`·`boilerplate`엔 GPT(저렴+빠름), `architecture`·`multi-file`·`coding`·`design`엔 Claude(설계 강점). 결제 webhook 처리(011) 같이 견고함 필요한 건 Claude, CRUD/Redis 큐(006/008) 같이 패턴화된 건 Codex.

수강자가 직접 손으로 모델 지정할 필요 없이 마블로가 자동으로 골고루 보냅니다.

---

## 본문

### TASK-001 + TASK-019 동시 시작 — backend-codex 병렬 (8분)

화면: 터미널 패널 — backend-codex 탭, 두 태스크 동시 로그

backend-codex는 의존성 없는 두 태스크를 병렬로 잡습니다:

```
[backend-codex] claimed TASK-001 (Postgres + Alembic)
[backend-codex] claimed TASK-019 (Docker Compose) — parallel
```

화면: 파일 트리에 `backend/` 디렉토리 + `docker-compose.yml` 생성

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
    volumes:
      - pgdata:/var/lib/postgresql/data
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

**TASK-001 Postgres 스키마** (병렬 진행 중):

```python
# backend/app/models.py (발췌)
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, index=True)
    provider = Column(String)  # "email" | "google"
    plan = Column(String, default="free")  # free | pro | team
    monthly_send_count = Column(Integer, default=0)
    plan_renews_at = Column(DateTime)

    leads = relationship("Lead", back_populates="owner", lazy="selectin")
    sends = relationship("MailSend", back_populates="owner", lazy="selectin")

class Lead(Base):
    __tablename__ = "leads"
    id = Column(Integer, primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id"))
    email = Column(String, index=True)
    first_name = Column(String)
    company = Column(String)
    job_title = Column(String)
    company_analysis = Column(JSON)  # LLM 분석 결과 캐시

class MailTemplate(Base):
    __tablename__ = "mail_templates"
    id = Column(Integer, primary_key=True)
    lead_id = Column(Integer, ForeignKey("leads.id"))
    tone = Column(String)  # cold|warm|deal|followup|reminder
    subject = Column(String)
    body = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

class MailSend(Base):
    __tablename__ = "mail_sends"
    id = Column(Integer, primary_key=True)
    template_id = Column(Integer, ForeignKey("mail_templates.id"))
    owner_id = Column(Integer, ForeignKey("users.id"))
    scheduled_at = Column(DateTime, index=True)
    sent_at = Column(DateTime, nullable=True)
    opened_at = Column(DateTime, nullable=True)
    clicked_at = Column(DateTime, nullable=True)
    replied_at = Column(DateTime, nullable=True)
    ab_variant = Column(String, nullable=True)  # "A" | "B" | null

class Subscription(Base):
    __tablename__ = "subscriptions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    toss_billing_key = Column(String)
    status = Column(String)  # active|paused|cancelled|grace
    next_billing_at = Column(DateTime)
```

`lazy="selectin"`은 N+1 방지 패턴 (마블로 CLAUDE.md 규칙). 에이전트가 자동으로 적용.

Alembic 마이그레이션도 자동 생성:

```bash
alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```

### TASK-002 OAuth — backend-claude 병행 (6분)

같은 시점에 backend-claude는 OAuth (설계 비중 큼) 작업:

화면: 터미널 패널 — backend-claude 탭

```
[backend-claude] claimed TASK-002 (Email + Google OAuth)
[backend-claude] designing NextAuth-compatible session flow
[backend-claude] creating backend/app/routers/auth.py
```

```python
# backend/app/routers/auth.py (발췌)
from fastapi import APIRouter, Depends, HTTPException
from app.security import create_access_token, verify_google_token

router = APIRouter(prefix="/api/auth", tags=["auth"])

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

Claude가 잡은 부분: **세션 만료·갱신·Google id_token 검증·plan claim을 토큰에 임베드** 같은 설계 결정. Codex가 잡았다면 검증 누락 가능성 — 그래서 자동 추천이 Claude로 갔습니다.

### 첫 REVIEW 사이클 (10분)

화면: 칸반 보드 — TASK-001/019/002가 REVIEW로 이동

```bash
/tf-status
```

```
📊 ReachWave Sprint 1 진행

⚡ IN_PROGRESS: 0  (다 끝남, 리뷰 대기)
🔵 REVIEW: 3 (TASK-001, 019, 002)
⏸  TODO: 19 (대부분 unblock 가능)

ETA: 리뷰 끝나면 6개 신규 태스크가 한 번에 unblock
```

**(실습)** 일괄 리뷰:

```bash
/tf-review
```

3개를 차례로 보여줍니다. 체크 포인트:

| 태스크            | PM 확인 사항                                                        |
| ----------------- | ------------------------------------------------------------------- |
| TASK-001 (DB)     | selectinload 적용 / 인덱스 (`email`, `scheduled_at`) / Alembic 정상 |
| TASK-019 (Docker) | env 분리 / volumes 영속 / depends_on 순서                           |
| TASK-002 (OAuth)  | Google id_token 서명 검증 / JWT plan claim / 비밀번호 bcrypt        |

문제 없으면 Approve. 의존성 한 번에 해소:

```
✓ TASK-001 ✓ → unblocks: 004, 006, 010, 022
✓ TASK-002 ✓ → unblocks: 012, 013
✓ TASK-019 ✓ → (no children)

🎉 6 tasks newly unblocked
```

`/tf-status` 다시 확인하면 backend-codex와 backend-claude가 자동으로 다음 라운드 잡습니다:

```
backend-codex   claims TASK-003 (CSV 임포트)
backend-codex   claims TASK-006 (SendGrid 큐)
backend-claude  claims TASK-004 (회사 LLM 분석)
backend-claude  claims TASK-010 (토스 결제 위젯)
frontend-claude WAKES UP! claims TASK-013 (로그인 UI) — Sprint 2 발진!
```

여기서 **frontend-claude가 깨어납니다**. OAuth가 끝났으니 로그인 UI 시작 가능. **이제 백엔드와 프론트엔드가 동시에 흐릅니다** — 진정한 병렬 라이브 빌딩.

### TASK-005 — Sprint 1의 하이라이트: 5톤 병렬 생성 (10분)

backend-claude가 TASK-004(회사 분석) 끝나고 바로 잡는 TASK-005는 이 강의의 **하이라이트** 중 하나. Gemini 3.1 Flash Lite **단일 모델**로 5톤을 **병렬 호출**합니다.

화면: backend-claude 터미널 — TASK-005 작업 로그

```python
# backend/app/services/mail_generator.py (에이전트 생성)
from app.llm.client import llm  # 추상화 단일 진입점
import asyncio

TONES = ["cold", "warm", "deal-focused", "follow-up", "reminder"]

TONE_PROMPTS = {
    "cold": "Write a formal cold outreach email. No fluff, value-first opening.",
    "warm": "Write a friendly, conversational email. Reference a shared context if any.",
    "deal-focused": "Write a benefit-led email. Lead with a specific offer or ROI.",
    "follow-up": "Write a polite follow-up assuming no prior reply.",
    "reminder": "Write a soft reminder one week after a follow-up.",
}

async def generate_one_tone(lead: Lead, tone: str) -> MailTemplate:
    """한 톤 생성. asyncio.gather로 5톤 동시 호출용."""
    prompt = f"""
You are an expert B2B sales copywriter.

Lead: {lead.first_name} ({lead.job_title} at {lead.company})
Company brief: {lead.company_analysis.get('summary', 'N/A')}
Pain points: {lead.company_analysis.get('pain_points', [])}

Instruction: {TONE_PROMPTS[tone]}
Length: 90-130 words.
Output JSON: {{"subject": "...", "body": "..."}}
"""
    raw = await llm.complete(prompt, response_format="json")
    parsed = json.loads(raw)
    return MailTemplate(lead_id=lead.id, tone=tone,
                        subject=parsed["subject"], body=parsed["body"])

async def generate_all_tones(lead: Lead) -> list[MailTemplate]:
    """5톤을 병렬로 생성. 약 6-8초."""
    return await asyncio.gather(*[generate_one_tone(lead, t) for t in TONES])
```

`app/llm/client.py`도 함께:

```python
# backend/app/llm/client.py — 모델 추상화 (1줄로 교체 가능)
import google.generativeai as genai

MODEL = "gemini-3.1-flash-lite"  # ← 여기 1줄만 바꾸면 모델 교체

class LLMClient:
    def __init__(self):
        genai.configure(api_key=settings.GEMINI_API_KEY)
        self.model = genai.GenerativeModel(MODEL)

    async def complete(self, prompt: str, response_format: str = "text") -> str:
        resp = await self.model.generate_content_async(prompt)
        return resp.text

llm = LLMClient()
```

**(강의 포인트)** 강조:

> 강의에서는 **Gemini 3.1 Flash Lite** 하나로 5톤을 다 만듭니다. 비용이 가장 저렴해서 강의 실습 부담이 거의 없죠. 나중에 본인 운영 시 GPT-4.1이나 Claude로 바꾸고 싶으면 `client.py`의 `MODEL` 상수 한 줄만 수정하면 됩니다.

리뷰 체크:

```bash
/tf-review TASK-005
```

- [ ] 5톤 프롬프트가 각 톤의 특징을 명확히 구분하는가?
- [ ] `asyncio.gather`로 정말 병렬 호출되는가? (시리얼이면 30초)
- [ ] JSON 응답 파싱 실패 시 retry 또는 graceful 처리?
- [ ] `lead.company_analysis`가 null일 때 폴백?

피드백이 필요하면:

```bash
R
> "deal-focused" 톤이 너무 공격적이야. 한국 B2B 톤에 맞게 "조심스러운 가치 제안"으로 수정.
> 그리고 retry 로직 추가 — JSON 파싱 실패 시 1회 재시도.
```

### TASK-006 SendGrid + Redis 큐 — codex가 잡음 (5분)

backend-codex는 발송 큐 (boilerplate + 패턴 명확, gpt 우위):

```python
# backend/app/queues/mail_queue.py
from rq import Queue
from redis import Redis

redis_conn = Redis.from_url(settings.REDIS_URL)
mail_q = Queue("mail", connection=redis_conn)

def enqueue_send(send_id: int, send_at: datetime):
    """발송을 스케줄. 같은 시점 동시 발송 방지 위해 ±15초 jitter."""
    jittered = send_at + timedelta(seconds=random.randint(-15, 15))
    mail_q.enqueue_at(jittered, "app.workers.send_mail", send_id)

# backend/app/workers/send_mail.py
import sendgrid
from sendgrid.helpers.mail import Mail

def send_mail(send_id: int):
    send = get_send(send_id)
    sg = sendgrid.SendGridAPIClient(api_key=settings.SENDGRID_API_KEY)
    msg = Mail(
        from_email=settings.SENDER_EMAIL,
        to_emails=send.lead.email,
        subject=send.template.subject,
        plain_text_content=send.template.body,
    )
    resp = sg.send(msg)
    update_send(send_id, sent_at=datetime.utcnow(), sendgrid_message_id=resp.headers["X-Message-Id"])
```

**Codex가 잡은 패턴**: jitter, RQ enqueue_at, SendGrid 표준 호출. 보일러플레이트 = 빠르고 정확.

### TASK-010, 011 토스페이먼츠 결제 — backend-claude (6분)

화면: backend-claude 터미널 — 토스 위젯 + webhook

토스페이먼츠는 한국 시장 필수. 강의는 **테스트키**로만 진행.

```python
# backend/app/routers/billing.py (발췌)
@router.post("/checkout")
async def create_checkout(data: CheckoutRequest, user: User = Depends(get_current_user)):
    """토스 결제 위젯용 주문 생성. 빌링키 발급 모드."""
    order = await create_order(user_id=user.id, plan=data.plan)
    return {
        "client_key": settings.TOSS_CLIENT_KEY,  # 테스트키
        "order_id": order.id,
        "order_name": f"ReachWave {data.plan.upper()} 월간 구독",
        "amount": PLAN_PRICES[data.plan],
        "customer_email": user.email,
        "success_url": f"{settings.FRONTEND_URL}/billing/success",
        "fail_url": f"{settings.FRONTEND_URL}/billing/fail",
    }

@router.post("/billing-key/issue")
async def issue_billing_key(data: BillingKeyIssue, user: User = Depends(get_current_user)):
    """위젯에서 받은 authKey를 토스 API에 보내 영구 빌링키로 교환."""
    async with httpx.AsyncClient() as cl:
        resp = await cl.post(
            "https://api.tosspayments.com/v1/billing/authorizations/issue",
            auth=(settings.TOSS_SECRET_KEY, ""),
            json={"authKey": data.auth_key, "customerKey": str(user.id)},
        )
        billing_data = resp.json()
    await save_billing_key(user.id, billing_data["billingKey"])
    await schedule_first_charge(user.id, plan=data.plan)
    return {"ok": True}
```

TASK-011 webhook (정기결제 + 실패 grace):

```python
@router.post("/webhook/toss")
async def toss_webhook(req: Request, body: dict = Body(...)):
    """토스 webhook idempotent 처리. 동일 paymentKey 두 번 와도 한 번만."""
    payment_key = body["paymentKey"]
    if await webhook_already_processed(payment_key):
        return {"ok": True, "idempotent": True}

    event_type = body["eventType"]
    if event_type == "PAYMENT_COMPLETED":
        await mark_subscription_renewed(body)
    elif event_type == "PAYMENT_FAILED":
        await start_grace_period(body, days=3)
    elif event_type == "PAYMENT_CANCELED":
        await cancel_subscription(body)

    await record_webhook(payment_key)
    return {"ok": True}
```

**리뷰 체크 (꼭 보세요)**:

- [ ] webhook idempotent 처리 (같은 paymentKey 두 번 와도 안전)
- [ ] grace period 3일 적용 (월말 카드 갱신 흔함)
- [ ] 빌링키는 DB에 저장하되 카드 정보 자체는 저장 X (PCI)
- [ ] 테스트키와 운영키 분리 (환경 변수 ENV별)

---

## 정리

이번 Sprint에서 본 것:

1. **이종 분담** — 백엔드 12 태스크가 backend-codex(8개, simple-fix) + backend-claude(4개, architecture)로 자동 분할
2. **병렬 실행** — 의존성 풀리면 의존하는 태스크들이 한 라운드에 8-12개 동시 진행
3. **연쇄 활성화** — backend OAuth 끝 → frontend-claude 자동 wake up → Sprint 2 시작
4. **단일 LLM 5톤 병렬** — `asyncio.gather`로 Gemini Flash Lite 5호출 ≈ 8초
5. **토스페이먼츠 통합** — 빌링키 + webhook idempotent + grace 3일

핵심 학습:

> **모델 분담을 PRD에서 잡아두면 라이브 빌딩이 매끄럽다.**
> 똑같은 backend 역할도 태스크 성격에 따라 자동으로 다른 모델로 분기되어 시간·비용 둘 다 이득. 수강자가 모델을 한 번도 손으로 지정하지 않았다는 점을 강조.

다음 섹션은 Sprint 2 프론트엔드. frontend-claude가 13~18번 6태스크를 어떻게 일관된 UX로 묶어내는지, 그리고 `/design-shotgun`·`/design-review`로 디자인 톤을 어떻게 잡는지 봅니다.

---

다음: [[4-4_Sprint2_프론트엔드]]
