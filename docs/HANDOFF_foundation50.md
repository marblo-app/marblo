# Marblo Foundation 50 — 핸드오프 가이드

**작성일**: 2026-05-19
**대상 에이전트**: 다음 sprint를 이어받아 진행할 모든 AI/사람 협업자
**선행 컨텍스트**: 이 파일 하나 + 아래 두 TaskForce 티켓만 보면 충분합니다.

---

## 0. TL;DR — 30초 컨텍스트

CEO 검토 세션(D28~D37, 2026-05-19 진행)에서 다음 5가지가 결정됐어요:

1. **인프런 → marblo-web 직판 전환** (수수료 30% 회피)
2. **closed beta 단계 폐기** (1인 founder 운영 비용 회피, Foundation 50이 implicit beta cohort 역할)
3. **Foundation 50 재설계**: 강의 50% 할인 + Pro 6개월 무료 (평생 50% 할인 SKU 폐기). 한국 locale 표시명은 "베타 얼리버드 50".
4. **강의 호스팅 = 자체 (Cloudflare Stream + VideoPlayer.tsx wire)** — 별도 sprint
5. **Foundation 50 멤버 의무 = 사용기 1편 + 인터뷰 1회 + BYOK 면책 동의** (Google Form 동의 = 계약 형식)

이 결정 사슬에서 **2개 sprint는 이미 완료**:

- TaskForce `38fa5a75-2245-4d3a-a238-58107cda27db` (REVIEW) — Foundation 50 waitlist 페이지 + 3 locale i18n + Header 메뉴
- TaskForce `35879709-240b-423b-9b7d-fbd7dd27366a` (IN_PROGRESS, 곧 REVIEW) — Promo bar + KO 네이밍 + 이 핸드오프 가이드

**남은 후속 sprint = 5개** (아래 §4 참조).

---

## 1. CEO 결정 사슬 (D28~D37 요약)

| ID   | 결정                                                                                             | 영향                                    |
| ---- | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| D28  | 베타↔GA + 강의 일정 동기화는 마스터플랜에서 이미 답 (6/23 동시 출시). 진짜 결정은 reality check. | 토픽 reframe                            |
| D29  | 진짜 결정 = 타임라인 reality check + 베타/GA entry/exit 기준                                     | 후속 분석 방향                          |
| D30  | P0-7 (macOS 공증 + Windows EV cert) 유일 미완 P0. slip clause 트리거는 P0-7 도착 시점에 결박.    | 슬립 결정 보류                          |
| D31  | closed beta 폐기 (Foundation 50 메커니즘에 흡수)                                                 | 3주 운영 비용 회수                      |
| D32  | Foundation 50 = 강의 50% 할인 + Pro 6개월 무료 (평생 50% 폐기). cap soft.                        | SKU 단순화                              |
| D32a | 인프런 → marblo-web 직판                                                                         | 수수료 30% 회피 + 고객 데이터 직접 보유 |
| D33  | 강의 호스팅 = 자체 (Cloudflare Stream + VideoPlayer.tsx wire)                                    | 1-2주 별도 구현                         |
| D34  | 오늘 첫 sprint = Foundation 50 waitlist 페이지                                                   | 명단 수광 ASAP                          |
| D35  | 같은 세션에서 직접 구현                                                                          | ticket 38fa5a75 산출                    |
| D36  | KO만 "베타 얼리버드 50", EN/JA는 Foundation 50 유지                                              | 한국 친근화 + 글로벌 일관성             |
| D37  | Promo bar 이메일 → Google Form prefill URL 방식                                                  | 별도 storage 불필요                     |

세부 결정 근거 / 의사결정 trade-off는 git history(`git log --since=2026-05-19`)와 현재 conversation transcript 참조.

---

## 2. 이미 구현된 자산 (건드리지 말고 활용)

### 2.1 ticket 38fa5a75 산출물 (REVIEW)

```
marblo-web/src/app/[locale]/foundation50/page.tsx   (신규 라우트)
marblo-web/messages/{ko,en,ja}.json                 (foundation50 + nav.foundation50 키)
marblo-web/src/components/Header.tsx                (Foundation 50 메뉴 항목 추가)
```

- Hero / Benefits 3카드 / Obligations 3카드 / 큰 CTA / Schedule / Footer 5 섹션
- 모든 텍스트는 i18n 키로 추출됨 — 3 locale 동기

### 2.2 ticket 35879709 산출물 (IN_PROGRESS → REVIEW)

```
marblo-web/src/lib/foundation50.ts                  (공유 config + Google Form URL/entry ID + isPromoBarOpen)
marblo-web/src/components/PromoBar.tsx              (sticky 띠 + 인라인 이메일 + 디미스 + 환경변수 토글)
marblo-web/src/app/[locale]/layout.tsx              (PromoBar 통합 — Header 위)
marblo-web/messages/{ko,en,ja}.json                 (promoBar 키 추가 + KO foundation50 텍스트 → "베타 얼리버드 50")
```

- PromoBar는 `useSyncExternalStore`로 SSR/hydration 안전
- localStorage `foundation50-promo-dismissed` 키로 사용자 디미스 기억
- 환경변수 `NEXT_PUBLIC_FOUNDATION50_OPEN`로 모집 완료 시 끄기
- 이메일 입력 → Google Form prefill URL로 새 탭 redirect

### 2.3 모집 가능 상태로 만들기 위해 사용자가 해야 하는 일

**1줄 코드 교체**가 필요한 곳은 `marblo-web/src/lib/foundation50.ts`의 2개 상수:

```typescript
export const GOOGLE_FORM_URL =
  "https://docs.google.com/forms/d/e/REPLACE_ME/viewform"; // ← Google Form 만든 후 share URL

export const EMAIL_ENTRY_ID = "entry.REPLACE_ME"; // ← 이메일 필드의 entry ID
```

(Google Form 만드는 방법은 §3 참조.)

---

## 3. Google Form 필드 설계 — 사용자 핸들링

### 3.1 만드는 방법

1. https://forms.google.com 접속 → 새 양식
2. 아래 §3.2 질문 모두 추가
3. 우측 상단 "Send" → "Link" 탭 → "Copy" → `GOOGLE_FORM_URL`에 붙여넣기
4. EMAIL_ENTRY_ID 찾기:
   - 양식 편집 화면에서 우측 상단 ⋮ → "Get pre-filled link"
   - 이메일 필드에 아무 값(예: `test@x.com`) 입력 → "Get link" → "Copy link"
   - 복사된 URL에서 `entry.NNNNNNNN=test%40x.com` 부분을 찾아서 `entry.NNNNNNNN`만 추출
   - `EMAIL_ENTRY_ID`에 붙여넣기

### 3.2 양식 질문 (필수 항목)

| #   | 질문 (한국어)                         | 형식                 | 옵션                                                                        |
| --- | ------------------------------------- | -------------------- | --------------------------------------------------------------------------- |
| 1   | 이름                                  | 단답형               | 필수                                                                        |
| 2   | 이메일                                | 단답형 (이메일 검증) | 필수                                                                        |
| 3   | 회사/소속 (없으면 "개인")             | 단답형               | 필수                                                                        |
| 4   | 직책/역할                             | 단답형               | 선택                                                                        |
| 5   | 마블로를 어떻게 사용할 계획인가요?    | 장문형               | 필수 (최소 30자)                                                            |
| 6   | 사용기 게재 채널 (출시 후 30일 내)    | 객관식               | 블로그 / SNS (Twitter/X·LinkedIn·Threads) / YouTube / 기타 (단답)           |
| 7   | 인터뷰 1회(30분) 응함                 | 단일 체크박스        | "동의합니다" 필수 체크                                                      |
| 8   | BYOK 면책 동의                        | 단일 체크박스        | "API 키 본인 운영 + AI 모델 비용 본인 부담을 이해하고 동의합니다" 필수 체크 |
| 9   | 회사명·이름 마블로 랜딩/B2B deck 노출 | 단일 체크박스        | "동의합니다" 필수 체크 (별도 익명 처리 요청은 비고란)                       |
| 10  | 추가 요청 사항 (선택)                 | 장문형               | 선택                                                                        |

### 3.3 동의문 사본 (양식 상단 설명에 붙여넣기)

```
[베타 얼리버드 50 사전 모집 안내]

이 양식은 마블로 v3.1 출시 전 첫 50인 케이스 스터디 파트너 모집입니다.

▸ 혜택
  - AI 에이전트 군단 마스터클래스 50% 할인 (₩199,000 → ₩99,500)
  - Pro 플랜 6개월 무료 (₩114,000 가치)
  - 분기 로드맵 미팅 + 신규 기능 얼리 액세스 + B2B PoC 케이스 스터디 우선권

▸ 의무 (위 혜택 수령 조건)
  1. 출시 후 30일 내 사용기 1편 게재 (블로그·SNS·YouTube 중 한 곳)
  2. 30분 인터뷰 1회 (케이스 스터디 콘텐츠용)
  3. API 키 본인 운영 동의 (Claude/GPT/Gemini 등 AI 모델 비용은 마블로가 부담하지 않습니다)

▸ 일정
  - 출시: 2026-06-23 (한국 GA)
  - 출시 직전 결제 링크 + Pro 6개월 쿠폰을 이메일로 발송합니다.

▸ 50인 soft cap
  - 50명 초과 신청자에게도 동일 혜택을 보장합니다.

▸ 개인정보
  - 본 양식의 응답은 베타 얼리버드 50 멤버십 운영에만 사용됩니다.
  - 정식 약관(변호사 검토 완료본)은 결제 링크와 함께 출시 전 이메일로 송부합니다.
```

EN/JA 버전은 messages/{en,ja}.json의 foundation50 섹션을 그대로 번역하면 됩니다. 또는 별도 양식 3개 생성 후 locale별로 redirect URL을 분기할 수 있습니다 (현재는 단일 양식 가정).

---

## 4. 후속 sprint 5개

### Sprint A — 마스터플랜·PRICING-SPEC·p0_status 문서 동기화 (P0)

**왜**: 결정 사슬이 marblo-web만 반영되고 docs는 5/6 작성본 그대로. 다른 사람·미래의 나·법률 자문이 충돌 정보 봄.

**입력값**:

- `docs/v3.1_런칭_마스터플랜.md` §1.5 (강의 가격), §2.4 (Foundation 50), §11 (마케팅 funnel — 인프런 → 자체 직판)
- `v3/docs/PRICING-AND-COST-SAFETY-SPEC.md` A2 (마케팅 메시지 재포지셔닝 scope 확장: 평생 50% 폐기 → 강의 50% + Pro 6개월)
- `docs/p0_status.md` — P0-18 (강의 호스팅 셋업), P0-19 (Foundation 50 waitlist 폼) 신규 추가, P0-8 (closed beta) 폐기 마킹

**산출물**: 위 3개 문서 commit 1건. inconsistency `grep -n "Foundation 50\|평생 50%\|클로즈드 베타\|인프런"` 검증.

**예상**: 1-2h

### Sprint B — Foundation 50 SKU + 결제 funnel wire

**왜**: waitlist 명단을 결제까지 가져가려면 lectures.ts에 4번째 패키지 + checkout flow + 쿠폰 발급 메커니즘 필요.

**입력값**:

- `marblo-web/src/data/lectures.ts` LECTURE_PACKAGES에 `betaEarlybird50` 추가: 가격 ₩99,500 (강의 50% 할인) + bonus "Pro 6개월 무료 쿠폰"
- `marblo-web/src/components/CouponInput.tsx`에 `BETA50` 쿠폰 코드 wire (50% off)
- `marblo-web/src/app/[locale]/checkout/page.tsx` 흐름에서 쿠폰 검증 → 50% 적용 + Pro 6개월 쿠폰 발급 메일 (백엔드 webhook)
- 백엔드 (`v3/functions/`) — 쿠폰 발급 endpoint + 사용 1회 제한
- 변호사 검토 완료 약관 (Sprint D 의존)

**제약**: Toss/Paddle 결제 wire는 이미 done. 쿠폰 발급은 백엔드 함수가 결제 성공 webhook에서 동작.

**예상**: 2-3일

### Sprint C — Cloudflare Stream + VideoPlayer + 진도 추적

**왜**: 강의 자체 호스팅. marblo-web에 VideoPlayer.tsx는 이미 있고, Cloudflare Stream API 연결 + Firestore lectures_progress 컬렉션이 신규.

**입력값**:

- Cloudflare Stream 계정 + API 토큰 (사용자 핸들링)
- 강의 영상 15.5h 업로드 (사용자 — 강의 제작/촬영 진행 중)
- `marblo-web/src/components/VideoPlayer.tsx` 확장: Cloudflare Stream HLS URL + 진도 추적 (`onTimeUpdate`)
- Firestore `lectures_progress` 컬렉션: `{userId, lectureId, sectionId, lastPositionSec, completedAt}` schema
- 다운로드 제한: Cloudflare Stream "signed URLs" 사용 (사용자별 만료 토큰)

**제약**: P0-7 (코드 서명) 작업과 시간 충돌 가능. 사용자 부담 큰 sprint.

**예상**: 1-2주 (콘텐츠 업로드 시간 별도)

### Sprint D — 변호사 검토 의뢰 (P0-14 + P0-15 + 베타 얼리버드 의무 조항 묶음)

**왜**: 마스터플랜 P0-14 (Foundation 50 약관) + P0-15 (BYOK 면책)이 5/30 마감. 베타 얼리버드 50 의무 조항(사용기·인터뷰·노출 동의)도 같은 변호사 의뢰 묶음에 합치는 게 효율적.

**입력값**:

- 사용기·인터뷰·노출 동의 + BYOK 면책 + 양도/회수/회사변경 약관 1식
- 한국 SaaS 약관 익숙한 변호사 (사용자 네트워크 활용)
- 자문비 예산 (마스터플랜 P0-14·P0-15 합산 예산 항목 참조)

**제약**: 변호사 회신 사이클 1-2주. 5/30 마감 맞추려면 이번 주 내 의뢰 발송 필수.

**예상**: 사용자 핸들링 + 변호사 회신 대기 (실제 코드 작업 0h)

### Sprint E — marblo-v3 P0-7 cert 진행 체크 (slip clause 트리거)

**왜**: D30에서 확인된 유일 미완 P0. 5/22까지 P0-7 안 끝나면 자동 6/30 slip. cert 주문 상태(Apple Developer 가입 + EV cert 발송) 사용자만 알 수 있음.

**입력값**:

- Apple Developer Program 가입 상태 ($99/년)
- Windows EV cert 발급 상태 ($300-600, FedEx 토큰 발송 lead time)
- v3 electron-builder 설정에 cert path 등록

**제약**: 외부 의존 (cert 공급업체 처리 시간). 5/22까지 안 도착하면 slip clause 자동 발동.

**예상**: 사용자 핸들링 + 1-2일 (cert 도착 후 셋업)

---

## 5. 환경변수 + 모집 종료 절차

### 5.1 모집 진행 중 (기본)

```bash
# .env.local 또는 production env
# (NEXT_PUBLIC_FOUNDATION50_OPEN을 설정하지 않거나 "true"로 설정)
NEXT_PUBLIC_FOUNDATION50_OPEN=true
```

Promo bar가 모든 페이지 최상단에 표시됩니다.

### 5.2 모집 종료 시

```bash
NEXT_PUBLIC_FOUNDATION50_OPEN=false
```

Promo bar 자동 비활성화. `/foundation50` 페이지 자체는 여전히 살아 있어서 이미 신청한 사람들이 진행 상황 확인 가능. 페이지 자체도 비활성화하려면 `src/app/[locale]/foundation50/page.tsx` 상단에서 `redirect('/pricing')` 추가.

### 5.3 Header 메뉴 항목 끄기 (옵션)

모집 완전 종료 후 Header에서 "Foundation 50" / "베타 얼리버드" 메뉴 항목도 끄려면:

```typescript
// src/components/Header.tsx
// import { isPromoBarOpen } from "@/lib/foundation50";  // 사용
// 그리고 {isPromoBarOpen() && <Link ...>{t('foundation50')}</Link>} 조건부 렌더
```

또는 단순히 `<Link href=foundation50>` 줄 삭제.

---

## 6. 변경 안 된 영역 (다음 에이전트 작업 후보)

이번 세션에서 명시적으로 손대지 않았어요:

- `docs/v3.1_런칭_마스터플랜.md` — 5/6 작성본 그대로. Sprint A에서 sync
- `v3/docs/PRICING-AND-COST-SAFETY-SPEC.md` — A2 ticket scope 변경 필요. Sprint A
- `docs/p0_status.md` — P0-18/P0-19 신규 추가, P0-8 closed beta 폐기 마킹. Sprint A
- `marblo-web/src/data/lectures.ts` — LECTURE_PACKAGES에 `betaEarlybird50` 패키지 추가. Sprint B
- `marblo-web/src/app/[locale]/page.tsx` (랜딩 메인 hero) — Foundation 50 강조 섹션 추가는 의도적으로 안 함 (promo bar로 충분 판단). 필요 시 별도 sprint.
- `v3/skills/orchestrator_agent.md` — A7 (Orchestrator skill 룰 추가) 그대로. PRICING-SPEC 별도 ticket
- 인프런 측 — 인프런 강의 publish 취소·중단 (사용자 핸들링, 외부 시스템)

---

## 7. 주의사항 / 미해결

### 7.1 Google Form 미완

- `GOOGLE_FORM_URL`과 `EMAIL_ENTRY_ID` placeholder인 상태로 배포되면 promo bar CTA 클릭 시 깨진 URL로 이동. **반드시 사용자가 폼 만들고 2개 상수 교체한 후 배포**.
- 임시 대안: `GOOGLE_FORM_URL`을 일단 `/${locale}/foundation50`으로 두면 폼 만들기 전까지 페이지로만 유도 가능.

### 7.2 마스터플랜과의 일시적 정보 충돌

- 마스터플랜 §2.4는 평생 50% 할인. marblo-web은 강의 50% + Pro 6개월. **사용자에게 보이는 건 marblo-web만**이라 외부 노출 충돌은 없지만, B2B 영업 deck·미디어 인터뷰가 마스터플랜 기반이면 새 메시지로 갱신 필요. Sprint A 처리 시급.

### 7.3 closed beta 폐기의 P0-12 영향

- 마스터플랜 P0-12 (electron-updater 핫픽스 검증 — "베타 50인 → 핫픽스 1회 강제 배포 테스트")가 closed beta cohort 가정. closed beta가 없어졌으므로 P0-12 검증 시나리오를 "Foundation 50 첫 결제자 50인 → 출시 1주차 마이크로 핫픽스 1회"로 수정 필요. Sprint A 또는 별도 미니 ticket.

### 7.4 i18n 라우팅

- URL 경로는 `/foundation50` 영문 그대로. 한국어 사용자가 `/ko/foundation50`을 보면 KO 라벨 "베타 얼리버드 50"이 표시됨. URL과 라벨 불일치는 OK (Linear/Notion도 동일 패턴).
- 만약 한글 URL `/ko/베타얼리버드50` 같은 분기를 원하면 next-intl `pathnames` config에 추가 필요. 추천하지 않음 (SEO/공유 URL 복잡도).

### 7.5 promo bar UX

- 모바일에서 한 줄에 메시지 + 이메일 + CTA + 디미스 다 들어가지 못해 줄 바꿈. flex-col on small viewports. 디자인 검토 시 `/plan-design-review` 또는 `/design-review` 사용.
- promo bar 디미스는 localStorage 기반. 다른 브라우저·시크릿 모드에서는 재노출. 의도된 동작.

---

## 8. 다음 에이전트 시작 명령 (복붙용)

이 가이드 받은 에이전트가 가장 빨리 시작하는 방법:

```
docs/HANDOFF_foundation50.md 읽고, §4 Sprint A부터 진행해.
TaskForce MCP로 ticket 생성 후 작업, 완료 시 REVIEW 제출.
의문 있는 결정은 §1 CEO 결정 사슬과 §7 주의사항 참조.
```

Sprint 우선순위 (시급도 기준):

1. **Sprint A** (문서 sync) — 1-2h, 즉시
2. **Sprint D** (변호사 의뢰) — 사용자 핸들링, 5/30 마감
3. **Sprint E** (P0-7 cert 진행 체크) — 사용자 핸들링, 5/22 마감
4. **Sprint B** (SKU + 결제) — Sprint D 의존 (약관 검토 완료 후 출시 직전 wire)
5. **Sprint C** (Cloudflare Stream) — 콘텐츠 제작 진행에 따라 6/16까지

---

**작성자**: Claude (이 세션). 의문이 있으면 git log 또는 ticket 38fa5a75 / 35879709의 activity history 참조.
