# 팀 사용량 게이트 — 처리방침 개정 문안 초안 + 인앱 배너 (Phase 0 §1)

티켓 `1LHLNnNZwpZGBVlGYZ5p`(#1333 로드맵 Phase 0) · 작성 2026-08-31 · **★문안 초안 — 배포 안 함, 사장님 승인 대기**

> 이 문서는 코드가 아니다. 승인 전까지 `privacyContent.tsx`·`legal.ts`·`privacyClarification.ts` 를
> 건드리지 않았다 — 문안이 여기(`docs/`)에만 있으면, 이 브랜치가 실수로 머지돼도 사용자에게
> 아무것도 노출되지 않는다. 승인 후 적용할 정확한 diff 는 §4 에 있다.

---

## 1. 범위 판단 — 왜 이 문구인가

선행 정본: `docs/org-analytics-b2b-design-2026-08-31.md` §6.2 (`#1333`), `docs/team-analytics-liveness-audit-2026-08-30.md` §3 (`#1331`).

- **한 항목에 한 번**: `#1333` §6.2 결정대로 L0(조직 관리자)·L1(프로젝트 관리자) 열람자를 **같은 문단에 동시에** 적는다. 조직 화면은 아직 안 지었지만(Phase 1~), 나중에 지을 때 방침을 또 개정하면 발효일이 둘로 갈리고 화면이 사유 두 개를 그려야 한다 — 그걸 피하려고 지금 범위를 넓게 잡는다.
- **무엇을 담는가** (완료 기준 그대로): 누가(프로젝트/조직 관리자) · 무엇을(멤버별 토큰 수·사용량 환산 비용(추정)·완료/실패 작업 수) · 무엇은 아닌지(코드·프롬프트·응답 원문 제외) · 언제부터(발효일, §3).
- **어투**: `privacyContent.tsx` 헤더 주석(`#1317`)이 명시한 대로 일상어를 쓰고 기술 용어(가명화, 익명 축, uid 등)를 넣지 않는다. 기존 :162/:167 항목의 "가명 구분값"·"통계 분석에만 쓰인다" 같은 표현 패턴을 그대로 따른다.
- **동의가 아니라 고지인 이유** (`#1317` 이 세운 선례를 그대로 적용): 팀 요금제에 속한다는 것 자체가 이 열람을 전제하는 기능이라, "동의 안 하면 이 기능만 뺀다"를 제시할 수 없다 — `PrivacyClarificationNotice.tsx` 의 2·3차 고지와 같은 구조다. 그래서 `CURRENT_POLICY_VERSION`(PIPA 동의 모달 재프롬프트 축)은 올리지 않고, `PRIVACY_CLARIFICATION_VERSION`(고지 전용 축)만 올린다.
  - ⚠️ **다만 이번 것은 앞선 2·3차와 성격이 조금 다르다는 점을 사장님·법무가 알고 결정해야 한다**: 2·3차는 "이미 비식별로 도는 값끼리 연결"이거나 "약속 철회"였지, *이름 있는 한 사람의 사용량을 다른 특정 개인(관리자)에게 보여주는 것*은 아니었다. 이번 건은 그 성격이라 더 신중한 값(법무 검토, 또는 `CURRENT_POLICY_VERSION` 상승)을 원하시면 §5 결정 1을 뒤집을 수 있다. 이 문서는 기본값으로 `#1317`·`#1333` 이 이미 정한 "고지로 충분하다"를 따랐다.

---

## 2. 방침 본문에 추가할 문단 (ko/en)

**적용 위치**: `v3/src/components/legal/privacyContent.tsx` — `label: "사용량·비용 기록 (계정 연결)"` 행(ko :167, en 상응 블록)의 `value` 문자열 **끝에 이어 붙인다**. 새 행을 만들지 않는다 — 이미 "계정에 연결되는 사용량·비용 기록" 이라는 같은 항목의 연장이기 때문이다.

### ko (추가 문장)

> 팀 요금제를 쓰신다면, 회원님이 속한 프로젝트의 관리자와 그 프로젝트가 결합된 조직의 관리자가 회원님의 사용량(모델별 토큰 수·사용량 환산 비용(추정)·완료·실패한 작업 수)을 가명 표시명으로 열람할 수 있습니다. 이때도 코드·프롬프트·응답 원문은 포함되지 않습니다.

### en (추가 문장)

> If you're on a team plan, the administrator of the project you belong to — and the administrator of the organization that project is linked to — can view your usage (tokens per model, estimated usage-based cost, and the number of completed/failed tasks) under a pseudonymous display name. This, too, never includes code, prompts, or raw responses.

---

## 3. 인앱 배너 — 기존 것 재사용 (신규 컴포넌트 안 만듦)

**판단**: 새 배너를 만들지 않는다. `PrivacyClarificationNotice.tsx` (2차 `vilkbSrnzbAv4ezbZMRT`, 3차 `O9iJMtgGy5glQ2oESvRN`)가 정확히 이 모양의 "1회 노출, 끄면 다시 안 뜸, 아무것도 write 안 함" 배너이고, `BeginnerShell`·`GlobalOverlays` 양쪽에 이미 마운트돼 있다. `PRIVACY_CLARIFICATION_VERSION` 을 올리고 `legal.clarification.body` 문구만 교체하면 4차 고지가 된다 — 새 컴포넌트·새 마운트 지점이 필요 없다.

### 배너 문구 (`legal.clarification.body`) — ko

> 팀 요금제에서는 회원님이 속한 프로젝트의 관리자와, 그 프로젝트가 결합된 조직의 관리자가 회원님의 사용량(모델별 토큰 수·사용량 환산 비용(추정)·완료·실패 작업 수)을 가명 표시명으로 열람할 수 있도록 처리방침을 개정했습니다. 코드·프롬프트·응답 원문은 포함되지 않고, 새로 받는 동의도 없습니다 — 이 안내는 한 번만 보여드리고 다시 뜨지 않습니다.

### 배너 문구 — en

> We've updated the privacy policy: on team plans, the administrator of your project — and the administrator of the organization it's linked to — can now view your usage (tokens per model, estimated usage-based cost, and completed/failed task counts) under a pseudonymous display name. This doesn't include code, prompts, or raw responses, and we're not asking for new consent. This notice shows once and won't appear again.

`legal.clarification.label`("처리방침이 바뀌었습니다"/"Your privacy policy has changed")은 재사용, 변경 없음.

---

## 4. 승인 후 적용할 정확한 diff (지금은 적용 안 함)

1. **`v3/src/services/privacyClarification.ts`**
   - `PRIVACY_CLARIFICATION_VERSION` 을 `"2026-08-29"` → 승인·배포일(예: `"2026-09-XX"`)로 올린다.
   - 헤더 주석에 "4차 고지" 문단 추가(2·3차와 같은 형식): 무엇이 바뀌었는지, 왜 `CURRENT_POLICY_VERSION`을 안 올리는지, 이 문서 §1 의 근거를 요약.
2. **`v3/src/locales/ko/legal.ts` / `en/legal.ts`**
   - `legal.clarification.body` 값을 §3 의 ko/en 문구로 교체.
3. **`v3/src/components/legal/privacyContent.tsx`**
   - ko `rows` 배열의 `"사용량·비용 기록 (계정 연결)"` 항목 `value` 끝에 §2 ko 문장 추가.
   - `EN.rows` 의 `"Usage & cost records (account-linked)"` 항목 `value` 끝에 §2 en 문장 추가.
   - `CURRENT_POLICY_VERSION` 은 건드리지 않는다(§1 참고).
4. 위 세 파일 변경 후 **`v3/tests/unit/privacyClarification.test.ts`** 류의 버전·문구 스냅샷 테스트가 있으면 같이 갱신.
5. 그다음에만 `TEAM_USAGE_EFFECTIVE_FROM` 을 배포 env 에 설정한다(§5, 별도 승인 확인 후).

---

## 5. 발효일(`TEAM_USAGE_EFFECTIVE_FROM`) 판단

### 게이트가 실제로 하는 일 (실측, `teamUsage.ts:573,667-686`)

`TEAM_USAGE_EFFECTIVE_FROM` 은 "기능을 켜는 스위치 날짜"가 아니라 **BQ 조회 창의 하한**이다 — 조회 창이 `day >= @fromDay` 로 잘린다. 즉 이 값보다 **이전 날짜의 사용량은 게이트를 나중에 열어도 영원히 관리자에게 보이지 않는다.** 목적외 이용을 막는 장치가 이미 코드에 있다 — 소급 노출이 원천적으로 불가능하다.

### 권고: `고지가 실제로 배포된 날 + 14일`

| 근거                                                                                                                                                                               | 방향                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 실사용 외부 팀 0 (`#1331` §6, `#1333` §7) — 지금 이 값을 무엇으로 두든 실제로 새로 노출되는 타인은 없다                                                                            | 짧게(7일 쪽)로 당겨도 안전          |
| 그래도 이번 항목은 "약속을 거두는" 이전 2·3차와 달리 **실명 없는 개인의 사용량을 특정 관리자에게 새로 보여주는** 최초 사례(§1 경고) — 관행상 이런 변경은 7~30일 사전 통지가 일반적 | 신중하게(30일 쪽)로 늘리는 게 안전  |
| 배포 후 내부 도그푸딩(우리 자신)이 유일한 실사용 — 우리는 이미 서로의 사용량을 알고 있어 대기가 실질적 지연 비용을 만들지 않는다                                                   | 대기 기간을 길게 잡아도 손해가 없다 |
| Phase 3(사용자 드릴다운)·Phase 4a(성공률 각인)가 이 게이트 뒤에서 대기 중 — 너무 늦추면 후속 단계 착수가 밀린다                                                                    | 30일 초과는 피한다                  |

**결론: 14일**(7~30 범위의 중간, 실사용자 0이라는 사실과 "새로운 종류의 노출"이라는 사실을 서로 상쇄). 절대 날짜가 아니라 **공식**으로 둔다 — 배포일이 사장님 승인 시점에 좌우되므로, 값은 "배너·방침이 실제로 배포된 날짜 + 14"로 계산해 그날 확정한다. 오늘(2026-08-31) 기준으로 승인·배포가 즉시 이뤄진다고 가정하면 예시값은 `2026-09-14`이다.

★사장님이 ±기간을 바꾸고 싶으면 이 표의 첫 두 행 중 어느 쪽에 더 무게를 두는지만 알려주면 된다(짧게: 7일 / 길게: 30일).

---

## 6. 남은 일 (승인 후)

1. 사장님이 §2·§3 문구 + §5 발효일을 승인.
2. §4 diff 를 실제 코드에 적용, 테스트 갱신, PR.
3. 배포 후 배너가 실제로 뜨는지 확인(1회, 닫으면 재노출 안 됨 — 기존 `privacyClarification.test.ts` 커버리지로 검증).
4. 배포일 + 14일(또는 승인된 값)을 `TEAM_USAGE_EFFECTIVE_FROM` 에 넣어 배포.
5. `/team` 사용량 탭에서 멤버·프로젝트·모델·일별 실수치 확인(뷰는 이미 provision 완료 — 이 티켓의 §provision 참고).
