---
tags: [강의, v3, 모듈4]
type: lecture
aliases: [Sprint 1 백엔드]
---

# Sprint 1 — 백엔드 기초

> 모듈 4 · 섹션 4-3 · 약 50분
> 관련: [[4-2_태스크생성_에이전트스폰]] | [[4-4_Sprint2_프론트엔드]]

---

## 도입 (5분)

에이전트가 스폰됐고, Backend Agent가 바로 작업을 시작했습니다. 이 섹션에서는 **백엔드 태스크들이 처리되는 과정**을 자세히 관찰하고, PM으로서 리뷰합니다.

화면: 칸반 보드 — TASK-001, 002, 003이 IN_PROGRESS

Sprint 1에서 다루는 백엔드 태스크는 총 7개입니다:

```
TASK-001: DB 스키마 설계 + 마이그레이션
TASK-002: 사용자 인증 API
TASK-003: YouTube 메타데이터 수집 API
TASK-004: YouTube 자막 추출 API (depends: 003)
TASK-005: Claude API 분석 엔드포인트 (depends: 004)
TASK-006: 분석 결과 저장/조회 API (depends: 001, 005)
TASK-007: 사용량 제한 미들웨어 (depends: 002)
```

TASK-001, 002, 003은 의존성이 없으므로 **동시에 진행**됩니다. 이 3개가 끝나야 나머지가 시작돼요.

---

## 본문

### TASK-001: DB 스키마 설계 관찰 (8분)

화면: Backend Agent 터미널 탭 — TASK-001 작업 로그

Backend Agent가 첫 번째로 DB 스키마를 설계합니다:

```
[Backend Agent] TASK-001: DB 스키마 설계 + 마이그레이션
[Backend Agent] Creating backend/app/models/user.py
[Backend Agent] Creating backend/app/models/analysis.py
[Backend Agent] Creating backend/app/models/video.py
[Backend Agent] Setting up Alembic migrations...
```

에이전트가 생성하는 코드를 살펴봅시다:

```python
# backend/app/models/user.py
from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.orm import relationship
from app.database import Base
from datetime import datetime

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    analyses = relationship("Analysis", back_populates="user",
                           lazy="selectin")  # selectinload 패턴!
```

여기서 주목! `lazy="selectin"`을 사용했죠? SQLAlchemy에서 관계 조회 시 `selectinload`를 써야 N+1 문제를 방지합니다. 마블로의 에이전트는 이런 best practice를 알고 있어요.

```python
# backend/app/models/analysis.py
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.database import Base
from datetime import datetime

class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)
    summary = Column(Text)
    key_points = Column(JSON)      # 핵심 포인트 5개
    keywords = Column(JSON)        # 관련 키워드
    action_items = Column(JSON)    # 추천 행동
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="analyses", lazy="selectin")
    video = relationship("Video", back_populates="analyses", lazy="selectin")
```

```python
# backend/app/models/video.py
class Video(Base):
    __tablename__ = "videos"

    id = Column(Integer, primary_key=True, index=True)
    youtube_url = Column(String, unique=True, index=True)
    youtube_id = Column(String, unique=True, index=True)
    title = Column(String)
    channel_name = Column(String)
    duration = Column(Integer)      # 초 단위
    thumbnail_url = Column(String)
    transcript = Column(Text)       # 자막 전체 텍스트
    created_at = Column(DateTime, default=datetime.utcnow)

    analyses = relationship("Analysis", back_populates="video",
                           lazy="selectin")
```

화면: 파일 트리에 models/ 폴더가 생성되는 모습

DB 모델이 3개 생성되었습니다: User, Analysis, Video. 관계도 올바르게 설정되어 있고, Alembic 마이그레이션도 자동 생성돼요.

### TASK-002: 사용자 인증 API 관찰 (7분)

동시에 TASK-002도 진행 중입니다:

화면: Backend Agent 로그 — TASK-002

```
[Backend Agent] TASK-002: 사용자 인증 API
[Backend Agent] Creating backend/app/routers/auth.py
[Backend Agent] Creating backend/app/schemas/auth.py
[Backend Agent] Adding JWT token management...
```

```python
# backend/app/routers/auth.py
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/api/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

@router.post("/register")
async def register(user_data: UserCreate, db: AsyncSession = Depends(get_db)):
    """새 사용자를 등록합니다."""
    existing = await db.execute(
        select(User).where(User.email == user_data.email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="이미 존재하는 이메일입니다")

    hashed = pwd_context.hash(user_data.password)
    user = User(email=user_data.email, hashed_password=hashed)
    db.add(user)
    await db.commit()
    return {"message": "회원가입 완료", "user_id": user.id}

@router.post("/login")
async def login(form: OAuth2PasswordRequestForm = Depends(),
                db: AsyncSession = Depends(get_db)):
    """로그인 후 JWT 토큰을 반환합니다."""
    user = await authenticate_user(db, form.username, form.password)
    if not user:
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 틀립니다")
    token = create_access_token(data={"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer"}
```

JWT 인증까지 구현했네요. 이런 보일러플레이트 코드를 에이전트가 알아서 만들어주니 시간이 엄청 절약됩니다.

### TASK-003: YouTube 메타데이터 API 관찰 (5분)

세 번째 병렬 태스크도 진행 중입니다:

```python
# backend/app/routers/youtube.py
from fastapi import APIRouter, HTTPException
from googleapiclient.discovery import build

router = APIRouter(prefix="/api/youtube", tags=["youtube"])

@router.post("/metadata")
async def get_video_metadata(request: VideoURLRequest):
    """YouTube URL에서 영상 메타데이터를 가져옵니다."""
    video_id = extract_video_id(request.url)
    if not video_id:
        raise HTTPException(status_code=400, detail="유효하지 않은 YouTube URL입니다")

    youtube = build("youtube", "v3", developerKey=settings.YOUTUBE_API_KEY)
    response = youtube.videos().list(
        part="snippet,contentDetails,statistics",
        id=video_id
    ).execute()

    if not response["items"]:
        raise HTTPException(status_code=404, detail="영상을 찾을 수 없습니다")

    item = response["items"][0]
    return VideoMetadata(
        youtube_id=video_id,
        title=item["snippet"]["title"],
        channel_name=item["snippet"]["channelTitle"],
        duration=parse_duration(item["contentDetails"]["duration"]),
        thumbnail_url=item["snippet"]["thumbnails"]["high"]["url"],
    )
```

YouTube Data API v3를 사용해서 영상의 제목, 채널명, 길이, 썸네일 등을 가져오는 엔드포인트입니다.

### 첫 번째 리뷰 사이클 (10분)

시간이 좀 지나면, 3개 태스크가 REVIEW 상태로 올라옵니다.

화면: 칸반 보드 — TASK-001, 002, 003이 REVIEW 열에

```bash
/tf-status
```

```
📊 Progress: ███░░░░░░░░░░░░░░ 3/18 (17%)

Tasks in REVIEW:
  ✅ TASK-001  DB 스키마 설계               REVIEW    @Backend-Agent
  ✅ TASK-002  사용자 인증 API              REVIEW    @Backend-Agent
  ✅ TASK-003  YouTube 메타데이터 API        REVIEW    @Backend-Agent
```

**(실습)** 하나씩 리뷰해봅시다:

```bash
/tf-review TASK-001
```

**TASK-001 리뷰 체크리스트:**
- [ ] User, Analysis, Video 모델이 올바르게 정의되었는가?
- [ ] 관계(relationship)에 `selectinload` 패턴이 적용되었는가?
- [ ] Alembic 마이그레이션 파일이 생성되었는가?
- [ ] 인덱스가 적절히 설정되었는가? (email, youtube_id 등)

문제없으면 Approve! 연쇄적으로 TASK-006이 unblock됩니다.

```bash
/tf-review TASK-002
```

**TASK-002 리뷰 체크리스트:**
- [ ] 회원가입 API — 이메일 중복 체크가 있는가?
- [ ] 로그인 API — JWT 토큰 생성이 올바른가?
- [ ] 비밀번호 해싱이 적용되었는가? (bcrypt)
- [ ] 에러 응답이 적절한가?

Approve하면 TASK-007(사용량 제한)과 TASK-008(로그인 UI)이 unblock됩니다.

```bash
/tf-review TASK-003
```

**TASK-003 리뷰 체크리스트:**
- [ ] YouTube URL 파싱이 정확한가? (다양한 URL 형태 지원)
- [ ] YouTube Data API 연동이 올바른가?
- [ ] 에러 핸들링 — 잘못된 URL, 삭제된 영상 등

Approve하면 TASK-004(자막 추출), TASK-009(URL 입력 폼)가 unblock됩니다.

### 2차 태스크 작업 관찰 (10분)

3개 태스크를 Approve하면 연쇄적으로 다음 태스크들이 시작됩니다:

화면: 칸반 보드 — 카드 이동 애니메이션

```
✅ TASK-001 Approved → TASK-006 unblocked (partially, still needs 005)
✅ TASK-002 Approved → TASK-007 unblocked, TASK-008 unblocked
✅ TASK-003 Approved → TASK-004 unblocked, TASK-009 unblocked

[Backend Agent] Claiming TASK-004: YouTube 자막 추출 API
[Frontend Agent] 🎉 Dependencies resolved! Starting work.
[Frontend Agent] Claiming TASK-008: 로그인/회원가입 UI
[Frontend Agent] Claiming TASK-009: URL 입력 폼 컴포넌트
```

여기서 주목할 점! **Frontend Agent가 드디어 일을 시작**합니다! 지금까지 의존성 때문에 기다리고 있었는데, 백엔드 API가 준비되니까 자동으로 활성화되었어요.

그리고 **Backend Agent와 Frontend Agent가 동시에 일하고 있습니다**:
- Backend Agent: TASK-004 (자막 추출)
- Frontend Agent: TASK-008 (로그인 UI), TASK-009 (URL 입력 폼)

```
[Backend Agent] TASK-004: YouTube 자막 추출 API
  Creating backend/app/services/transcript.py
  Using youtube-transcript-api library...
```

```python
# backend/app/services/transcript.py
from youtube_transcript_api import YouTubeTranscriptApi

async def get_transcript(video_id: str) -> str:
    """YouTube 영상의 자막을 추출합니다."""
    try:
        transcript_list = YouTubeTranscriptApi.get_transcript(
            video_id,
            languages=['ko', 'en']  # 한국어 우선, 없으면 영어
        )
        full_text = " ".join([t["text"] for t in transcript_list])
        return full_text
    except Exception as e:
        raise TranscriptNotFoundError(f"자막을 찾을 수 없습니다: {str(e)}")
```

TASK-004가 끝나면 TASK-005(Claude API 분석)가 시작됩니다. 이 파이프라인 구조가 보이시죠?

```
003 (메타데이터) → 004 (자막) → 005 (Claude 분석) → 006 (저장/조회)
```

이게 백엔드의 핵심 파이프라인입니다. 순서대로 진행돼야 하죠.

### TASK-005: Claude API 분석 — 핵심 태스크 (5분)

TASK-004가 Approve되면 가장 중요한 태스크가 시작됩니다:

화면: Backend Agent 터미널 — TASK-005

```python
# backend/app/services/ai_analyzer.py
import anthropic

client = anthropic.Anthropic(api_key=settings.CLAUDE_API_KEY)

async def analyze_video(transcript: str, video_title: str) -> AnalysisResult:
    """Claude API로 영상 자막을 분석합니다."""
    prompt = f"""다음은 YouTube 영상 "{video_title}"의 자막입니다.

이 영상을 분석하여 다음 형식으로 응답해주세요:

1. **요약** (3-5문장)
2. **핵심 포인트** (최대 5개, 각 1-2문장)
3. **관련 키워드** (최대 10개)
4. **추천 행동** (시청자가 할 수 있는 행동 3개)

자막:
{transcript[:10000]}  # 토큰 제한 고려
"""

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}]
    )

    return parse_analysis_response(message.content[0].text)
```

이 부분이 서비스의 **핵심 가치**입니다. Claude API가 자막을 분석해서 구조화된 인사이트를 추출하는 거예요.

이 태스크는 특히 주의 깊게 리뷰해야 합니다:

**(실습)** TASK-005 리뷰:

```bash
/tf-review TASK-005
```

**체크리스트:**
- [ ] 프롬프트가 명확하고 구체적인가?
- [ ] 응답 파싱 로직이 안정적인가?
- [ ] 토큰 제한 처리가 되어 있는가?
- [ ] 에러 핸들링 — API 실패, 타임아웃 등
- [ ] 비용 최적화 — 적절한 모델 선택, max_tokens 설정

프롬프트가 마음에 안 들면 수정을 요청하세요:

```bash
R
> 프롬프트에 "한국어로 응답해주세요"를 추가하고,
> 응답 형식을 JSON으로 강제해주세요. 파싱이 더 안정적일 겁니다.
```

---

## 정리

Sprint 1에서 진행된 내용:

1. **병렬 시작**: TASK-001, 002, 003이 동시에 진행 (의존성 없음)
2. **연쇄 활성화**: Approve → 의존성 해소 → 다음 태스크 자동 시작
3. **Front-Back 연동**: 백엔드 API 완료 → 프론트엔드 에이전트 활성화
4. **핵심 파이프라인**: 메타데이터 → 자막 → Claude 분석 → 저장
5. **PM 리뷰**: 각 태스크의 코드 품질, 에러 핸들링, best practice 확인

다음 Sprint에서는 프론트엔드 UI가 본격적으로 만들어지고, 백엔드와 프론트엔드가 **동시에 병렬 진행**되는 모습을 볼 겁니다.

---
다음: [[4-4_Sprint2_프론트엔드]]
