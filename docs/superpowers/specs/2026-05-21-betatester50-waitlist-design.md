# 초기 베타테스터 50인 모집 — 홈 히어로 직하단 인라인 신청 섹션

**Status:** Approved (brainstorming 합의 완료 2026-05-21)
**Owner:** john.kim@hypemarc.com
**Scope:** `marblo-web/` 마케팅 사이트
**Out-of-scope:** 자동 안내 메일 발송, Vercel/Firebase 인프라 변경

## 1. 목표

홈(`/[locale]`) 히어로 배너 **직하단**에 크고 시각적으로 무게감 있는 섹션을 추가하여, 초기 베타테스터 50인을 모집하는 인라인 이메일 신청 폼을 노출한다. 기존 `/foundation50` 랜딩 페이지와 사이트 최상단 `PromoBar` 의 역할은 변경하지 않는다.

## 2. 비목표 (이번 스코프 외)

- 신청 직후 **자동 안내 메일 발송** — 다음 PR
- 결제 연동 — 출시 직전 별도 PR
- 어드민 대시보드 — 현재는 Firebase 콘솔에서 직접 확인
- 50인 도달 후 클로즈드 베타 운영 로직

## 3. 사용자 시나리오

1. 방문자가 `/ko` (또는 `/en`, `/ja`) 에 접속
2. 히어로 직하단에 "초기 베타테스터 50인 모집" 섹션이 큼직하게 보임
3. 잔여 자리 카운터, 혜택, 의무 조건 칩을 본 후 이메일을 인라인 입력
4. "신청하기" 클릭 → Firestore `betatester50_waitlist` 컬렉션에 doc 생성
5. 인라인 success 메시지 표시 (자동 발송 메일 안내 카피 포함)
6. 50명 도달 시 인풋 비활성화 + `closed` 카피 노출

## 4. 디자인 합의 결과

| 항목                   | 결정                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| 위치                   | `[locale]/page.tsx` 의 Hero 섹션 바로 다음 (Value Proposition Stats 위)     |
| 입력 형태              | 이메일 단일 필드 인라인 폼                                                  |
| 저장소                 | Firestore `betatester50_waitlist` 컬렉션 (Firebase 프로젝트 `marblo-2253d`) |
| 카운터                 | Firestore `getCountFromServer` 라이브 조회, 글로벌 누적 50명                |
| 가격 노출              | "강의 + 6개월 패키지 50% 할인" 만 (정가/할인가 숫자 노출 X)                 |
| 의무 구조              | **OR 구조**: (사용기 1편 OR 30분 인터뷰 택1) + BYOK 동의                    |
| 다국어                 | KO/EN/JA 모두 자연스러운 번역                                               |
| API route              | **없음**. 클라이언트 SDK 직접 write + Firestore 보안 규칙으로 보호          |
| `/foundation50` 페이지 | 동일한 OR 구조로 카피 일치화 (obligations 섹션 3개→2개 카테고리)            |

## 5. 구현 아키텍처

### 5.1 파일 변경

| 파일                                                | 역할                                                         |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `marblo-web/src/components/BetaTester50Section.tsx` | **신규** 클라이언트 컴포넌트, 폼 + 카운터 + 상태 머신        |
| `marblo-web/src/app/[locale]/page.tsx`              | Hero 섹션 다음에 `<BetaTester50Section />` 삽입              |
| `marblo-web/messages/{ko,en,ja}.json`               | `betatester50.*` 키 추가 + `foundation50.ob*` OR 구조로 갱신 |
| `marblo-web/src/app/[locale]/foundation50/page.tsx` | obligations 3개→2개 카테고리                                 |
| `v3/firestore.rules`                                | `betatester50_waitlist` 컬렉션 규칙 추가                     |

### 5.2 컴포넌트 상태 머신

```
idle ──submit──▶ submitting ──ok──▶ success
                          ├──closed──▶ closed
                          └──err──▶ error ──retry──▶ submitting

(mount) ──fetch count──▶ counter loaded  (fallback to "한정 50명")
```

### 5.3 Firestore 스키마

컬렉션: `betatester50_waitlist/{autoId}`

```ts
{
  email: string;        // lowercased, trimmed
  locale: 'ko' | 'en' | 'ja';
  source: 'home' | 'foundation50_page';
  createdAt: Timestamp; // serverTimestamp()
  // 운영자가 콘솔에서 직접 채울 필드
  status?: 'pending' | 'contacted' | 'paid' | 'cancelled';
  note?: string;
}
```

### 5.4 보안 규칙 (Firestore)

```
match /betatester50_waitlist/{doc} {
  allow create: if request.resource.data.keys().hasOnly(['email','locale','source','createdAt'])
                && request.resource.data.email is string
                && request.resource.data.email.size() <= 254
                && request.resource.data.email.matches('^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$')
                && request.resource.data.locale in ['ko','en','ja']
                && request.resource.data.source in ['home','foundation50_page'];

  allow list: if true;        // 카운터 표시용 (집계 쿼리만)
  allow get: if false;        // 개별 이메일 조회 차단
  allow update, delete: if false;
}
```

> **Note:** 규칙 변경은 `firebase deploy --only firestore:rules` 로 별도 배포. 이번 PR 에 코드는 포함되지만 적용은 사용자 배포 트리거.

### 5.5 i18n 키 (KO 기준)

```jsonc
"betatester50": {
  "badge": "🌟 초기 베타테스터 모집 중",
  "title": "초기 베타테스터 50인 모집",
  "subtitle": "강의 + 6개월 패키지를 50% 할인가에 제공합니다",
  "seats_left": "남은 자리 {n}명",
  "seats_loading": "남은 자리 확인 중…",
  "email_placeholder": "you@company.com",
  "cta_apply": "신청하기",
  "cta_submitting": "신청 중…",
  "success_title": "신청이 접수되었습니다",
  "success_body": "결제 안내와 자세한 약관을 곧 이메일로 보내드립니다.",
  "closed": "50인 모집이 마감되었습니다",
  "error_invalid_email": "올바른 이메일 주소를 입력해 주세요",
  "error_network": "잠시 후 다시 시도해 주세요",
  "obligations_heading": "참여 조건",
  "ob_review_or_interview": "📝 상세 사용기 1편  또는  🎤 30분 인터뷰 (택1)",
  "ob_byok": "🔑 BYOK 동의 (Claude/GPT/Gemini API 키 본인 운영)",
  "details_link": "자세히 보기 →"
}
```

`foundation50.ob*` 갱신: ob1=사용기(옵션 1), ob2=30분 인터뷰(옵션 2), ob3=BYOK. `obligations_intro` 를 OR 구조로 재서술.

### 5.6 UX 디테일

- 모바일: 인풋/버튼 세로 스택, 칩 가로 wrap
- 데스크탑: 인풋 + 버튼 가로 배치, 카운터는 우상단 뱃지
- 카운터 조회 실패 시 "한정 50명" 정적 fallback
- success 상태: 폼 자리에 ✅ 메시지로 교체
- closed 상태: 인풋 disabled, 버튼 "마감" 라벨 + grayscale

## 6. 테스트 전략

이번 PR 은 unit/integration 테스트 생략. 사용자 수동 검증:

1. 이메일 입력 → 신청 → Firebase 콘솔에서 doc 1건 확인
2. 카운터가 0/50 으로 시작하는지 확인
3. KO/EN/JA 카피 누락 없음 확인
4. `/foundation50` obligations 가 OR 구조로 갱신 확인

## 7. 위험 요소

| 위험                     | 완화책                                                         |
| ------------------------ | -------------------------------------------------------------- |
| 스팸 봇 자동 신청        | Firestore rules email regex + size 제한. 추후 App Check        |
| 중복 신청                | 미해결 (이번 PR). 운영자가 콘솔에서 수동 정리                  |
| 50명 도달 직전 동시 신청 | 트랜잭션 없음, 51~52 doc 까지 들어올 수 있음. 운영자 수동 처리 |
| 카운터 조회 비용         | 페이지 로드당 1회 — 무시할 수준                                |
| 보안 규칙 미배포         | 사용자가 `firebase deploy --only firestore:rules` 실행 필요    |

## 8. 롤아웃

1. 이 spec 커밋
2. 코드 구현 단일 커밋으로 main 푸시 → Vercel 자동 배포
3. 사용자가 Firebase CLI 로 firestore:rules 배포
4. 사용자가 라이브 `/` 접속해서 양식 동작 확인 + 콘솔에서 doc 생성 검증
