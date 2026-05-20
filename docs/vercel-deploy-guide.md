# Marblo 웹사이트 Vercel 배포 가이드

## 아키텍처 개요

```
[Vercel]                    [Firebase]
marblo-web (Next.js 16)     Auth + Firestore + Cloud Functions
├── 홈페이지                  ├── 사용자 인증 (Google/GitHub)
├── 강의 목록/상세             ├── 강의 구매 데이터
├── 가격 (구독 토글)           ├── 구독 상태 관리
├── 다운로드                   ├── TossPayments 결제 처리
├── 결제 (TossPayments)       └── 쿠폰 검증
└── 3개국어 (ko/en/ja)
```

## 사전 준비

- [x] GitHub 리포지토리: `melocream/marblo` (이미 푸시됨)
- [ ] Vercel 계정 (https://vercel.com — GitHub 로그인)
- [ ] **Cloudflare** 계정 + 결제 카드 (도메인 등록 + DNS 관리)
- [ ] Firebase 프로젝트 키 확인 (`marblo-web/.env.local`)
- [ ] TossPayments 프로덕션 키 (발급 후 — 심사 5–7일)

> 📌 **현 상태 (2026-05-20)**: v3 데스크탑 빌드 산출물(.dmg/.exe/.AppImage)이 아직 없어
> `/download` 페이지는 **Coming Soon** UI로 차단 (`88d90cf` 커밋). Hero/CTA Final 라벨도
> "곧 출시 (Coming Soon)" / "Coming Soon" / "近日公開" 로 3 locale 모두 교체됨.

## Step 0: Cloudflare 도메인 구매 (~5분)

1. https://dash.cloudflare.com → **Domain Registration** → **Register Domains**
2. 도메인 검색 (권장 후보):
   - **marblo.app** (~$12/yr, Google 운영, HTTPS 강제) ← 추천
   - marblo.io (~$35/yr)
   - marblo.ai (~$80/yr)
3. 카드 등록 → 결제 → 5분 내 zone 자동 생성
4. **자동으로 Cloudflare 네임서버에 호스팅** — 별도 NS 변경 불필요

## Step 1: Vercel 프로젝트 생성

1. https://vercel.com → **Add New** → **Project**
2. **Import Git Repository** → `melocream/marblo`
3. 설정:
   - **Project Name**: `marblo-web`
   - **Framework Preset**: Next.js (자동 감지)
   - **Root Directory**: `marblo-web` ← ⚠️ 모노레포라 반드시 변경
   - **Build Command**: 기본값 (`next build`)
   - **Output Directory**: 기본값 (`.next`)
   - **Node.js Version**: 22.x

## Step 2: 환경 변수 설정

Vercel Dashboard → Settings → Environment Variables에 추가:

| 변수명                                     | 값                             | 비고                           |
| ------------------------------------------ | ------------------------------ | ------------------------------ |
| `NEXT_PUBLIC_TOSS_CLIENT_KEY`              | `test_ck_...`                  | 테스트 → 프로덕션 전환 시 교체 |
| `NEXT_PUBLIC_FIREBASE_API_KEY`             | Firebase 콘솔에서 확인         |                                |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`         | `marblo-2253d.firebaseapp.com` |                                |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`          | `marblo-2253d`                 |                                |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`      | `marblo-2253d.appspot.com`     |                                |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase 콘솔에서 확인         |                                |
| `NEXT_PUBLIC_FIREBASE_APP_ID`              | Firebase 콘솔에서 확인         |                                |

> **중요**: 모든 변수에 Production, Preview, Development 환경 체크

### 환경 변수 확인 방법

```bash
# 로컬 .env.local 파일에서 확인
cat marblo-web/.env.local
```

## Step 3: 첫 배포

환경 변수 설정 후 **Deploy** 클릭. 약 1~2분 소요.

배포 완료 후 `marblo-web-xxxxx.vercel.app` 주소로 접속하여 확인:

- [ ] `/` 홈페이지 렌더링 (Hero CTA "Coming Soon" 표시)
- [ ] 3개 언어 전환 (`/ko`, `/en`, `/ja`)
- [ ] `/ko/lectures/marblo-v3-masterclass` 모듈 2 → 7개 sections
- [ ] `/ko/pricing` 5 카드 (Free/Pro/Team/Team Plus/Enterprise) + 월간/연간 토글
- [ ] `/ko/download` Coming Soon UI 표시 (실제 다운로드 카드 비활성)
- [ ] Firebase Auth Google/GitHub 로그인 popup
- [ ] TossPayments 테스트 결제 (test_ck\_ 키 사용)

## Step 4: 커스텀 도메인 연결 (Cloudflare)

### 4-1. Vercel 측 — 도메인 등록

1. Vercel Dashboard → **Settings** → **Domains**
2. `marblo.app` 입력 → **Add**
3. Vercel이 2가지 DNS 안내 (그대로 메모):
   - `marblo.app` → A `76.76.21.21`
   - `www.marblo.app` → CNAME `cname.vercel-dns.com`
4. `www` → apex (또는 그 반대) 자동 리다이렉트 설정

### 4-2. Cloudflare DNS 설정 — ⚠️ Proxy OFF 필수

Cloudflare 대시보드 → `marblo.app` zone → **DNS → Records** → **Add record**:

| 타입  | 이름 | 값                     | Proxy status           |
| ----- | ---- | ---------------------- | ---------------------- |
| A     | @    | `76.76.21.21`          | 🔘 **DNS only (회색)** |
| CNAME | www  | `cname.vercel-dns.com` | 🔘 **DNS only (회색)** |

> ⚠️ **오렌지 구름 (프록시 ON) 절대 금지** — Vercel이 자체 Let's Encrypt SSL을 발급하므로
> Cloudflare 프록시를 켜면 SSL 체인 꼬임 + 무한 리다이렉트 발생.
>
> 기존 `@` A/AAAA/CNAME 레코드가 있으면 삭제하고 위 두 줄만 남기세요.

### 4-3. SSL 검증

- 5–10분 대기 → Vercel Domain 탭에서 ✅ Valid Configuration
- 확인: `dig marblo.app +short` → `76.76.21.21` 응답
- HTTPS 자동: `curl -I https://marblo.app` → `HTTP/2 200` + `strict-transport-security`

### 4-4. Firebase Auth 도메인 추가 (필수)

Firebase Console → Authentication → Settings → **Authorized domains**:

- `marblo.app` 추가
- `www.marblo.app` 추가

> 빠뜨리면 Google/GitHub 로그인 popup이 `auth/unauthorized-domain` 으로 실패.

### 4-5. TossPayments 도메인 등록

https://app.tosspayments.com → 가맹점 콘솔 → 개발 → URL 정보:

- 결제 성공 URL: `https://marblo.app/ko/checkout/success`
- 결제 실패 URL: `https://marblo.app/ko/checkout/fail`
- 허용 도메인: `https://marblo.app`

## Step 5: 프로덕션 전환 체크리스트

### 결제 키 교체

```
# Vercel 환경변수에서 교체
NEXT_PUBLIC_TOSS_CLIENT_KEY: test_ck_... → live_ck_...

# Firebase Functions .env에서도 교체
TOSS_SECRET_KEY: test_sk_... → live_sk_...
```

### SEO 확인

- [ ] https://marblo.app/sitemap.xml 접속 확인
- [ ] https://marblo.app/robots.txt 접속 확인
- [ ] Google Search Console에 `marblo.app` 도메인 추가 (DNS TXT 인증 → Cloudflare에 추가)
- [ ] sitemap.xml 제출

### Coming Soon → 정식 다운로드 전환 (v3 빌드 완료 시)

- [ ] Electron `.dmg` (mac) / `.exe` (win) / `.AppImage` (linux) 빌드
- [ ] GitHub Releases 또는 R2/S3 업로드, CDN URL 확보
- [ ] `marblo-web/src/app/[locale]/download/page.tsx` 의 platforms 배열을 실 URL로 교체 (Coming Soon UI 제거)
- [ ] `messages/{ko,en,ja}.json`
  - `hero.cta_download` → "무료 다운로드" / "Free Download" / "無料ダウンロード" 복원
  - `cta_final.download` → 동일하게 복원

### 성능 확인

- [ ] Lighthouse 점수 확인 (목표: 90+)
- [ ] Core Web Vitals 확인
- [ ] 모바일 반응형 테스트

### 보안 확인

- [ ] HTTPS 자동 적용 확인 (Vercel 기본)
- [ ] 환경 변수에 시크릿 키가 `NEXT_PUBLIC_` 없이 설정되었는지 확인
- [ ] Firebase Security Rules 프로덕션 설정

## 자동 배포

GitHub `main` 브랜치에 push하면 Vercel이 자동으로 빌드 + 배포합니다.

```bash
git add .
git commit -m "Update website"
git push origin main
# → Vercel 자동 배포 (약 1분)
```

PR 생성 시 Preview 배포가 자동 생성되어 미리 확인 가능.

## 트러블슈팅

### 빌드 실패

```bash
# 로컬에서 먼저 빌드 테스트
cd marblo-web && npx next build
```

### 환경 변수 누락

- Vercel 로그에서 `Firebase` 또는 `Toss` 관련 에러 → 환경 변수 확인
- `NEXT_PUBLIC_` 접두사 빠뜨림 → 클라이언트에서 undefined

### 도메인 SSL 에러

- DNS 반영 대기 (보통 5–10분, 최대 24시간)
- Vercel Dashboard에서 SSL 인증서 상태 확인
- **Cloudflare 프록시 ON 상태 점검** — 오렌지 구름 → 회색 구름으로 전환
- `curl -v https://marblo.app` 에서 `subject: CN=marblo.app` (Let's Encrypt) 확인,
  Cloudflare cert가 보이면 프록시가 켜진 상태

### Firebase Auth 리다이렉트 에러

- Firebase Console → Authorized domains에 `marblo.app` 추가 필요

---

## 런칭 로드맵 (4주)

### Week 1: 인프라 세팅

| 순서 | 할 일                                     | 소요              |
| ---- | ----------------------------------------- | ----------------- |
| 1    | marblo.app 도메인 구매 (Cloudflare)       | 10분              |
| 2    | Vercel 배포 + 도메인 연결 (DNS only ⚠️)   | 30분              |
| 3    | TossPayments 프로덕션 키 신청             | 10분 (심사 5-7일) |
| 4    | Firebase Auth에 도메인 추가               | 5분               |
| 5    | Google Search Console 등록 + sitemap 제출 | 15분              |
| 6    | GA4 설치 (트래킹)                         | 20분              |

### Week 1-2: 강의 촬영 (병행)

| 순서 | 할 일                                | 비고           |
| ---- | ------------------------------------ | -------------- |
| 1    | 모듈 1-2 촬영 (소개 + 시스템 구조)   | 핵심 먼저      |
| 2    | 모듈 3 (날씨 대시보드 워밍업)        | 화면 녹화 위주 |
| 3    | 모듈 4-5 (메인 프로젝트 + 멀티모델)  | 가장 긴 파트   |
| 4    | 모듈 6-8 (배포 + 런칭 + 운영)        |                |
| 5    | YouTube 업로드 + Firestore에 ID 연결 |                |

### Week 2-3: 결제 오픈 (TossPayments 키 도착 후)

| 순서 | 할 일                                  |
| ---- | -------------------------------------- |
| 1    | 프로덕션 키 Vercel 환경변수에 교체     |
| 2    | 테스트 결제 1회 (실결제 → 즉시 환불)   |
| 3    | 강의 구매 + 구독 결제 플로우 최종 확인 |

### Week 3-4: 마케팅 + 런칭

#### 사전 마케팅 (강의 촬영 중에 시작)

| 채널          | 액션                                                         | 비용 |
| ------------- | ------------------------------------------------------------ | ---- |
| YouTube       | 마블로 데모 영상 1-2개 (3-5분) — 에이전트 3개 동시 작업 시연 | 무료 |
| X (트위터)    | 개발 과정 공유, "빌딩 인 퍼블릭" 스레드                      | 무료 |
| 디스코드      | 마블로 커뮤니티 서버 개설, 얼리버드 대기 명단                | 무료 |
| 개발 커뮤니티 | 긱뉴스, 디스콰이엇, Reddit r/programming                     | 무료 |
| 블로그        | "AI 에이전트 군단 오케스트레이션" 기술 포스트 2-3편          | 무료 |

#### 런칭 당일

| 순서 | 액션                                |
| ---- | ----------------------------------- |
| 1    | 얼리버드 가격 오픈 공지 (모든 채널) |
| 2    | Product Hunt 런칭                   |
| 3    | 긱뉴스 / 디스콰이엇 포스팅          |
| 4    | YouTube 강의 소개 영상 공개         |
| 5    | X 스레드: "왜 마블로를 만들었나"    |

#### 런칭 후 1주

| 액션                      | 목적            |
| ------------------------- | --------------- |
| 수강생 피드백 수집        | 강의 개선       |
| 디스코드 Q&A              | 커뮨니티 활성화 |
| 후기 캡처 → 웹사이트 반영 | 소셜 프루프     |
| 앰배서더 인증서 발급 시작 | 충성도          |

### 마케팅 핵심 메시지

> **"Cursor는 에이전트 1명. 마블로는 군단."**

- **차별점**: 멀티 에이전트 동시 운용 (경쟁사 없음)
- **타겟**: Claude Code 사용자, AI 코딩 도구 사용자
- **훅**: "혼자서 팀 전체의 성과를 만드세요"

### 수익 예상 (보수적)

| 항목                | 계산             | 금액         |
| ------------------- | ---------------- | ------------ |
| 강의 얼리버드 300명 | 300 × ₩149,000   | **₩44.7M**   |
| Pro 월간 구독 100명 | 100 × ₩19,000/월 | **₩1.9M/월** |
| Pro 연간 구독 50명  | 50 × ₩182,400    | **₩9.1M**    |
