# 사람 축 구현 — 만들되 켜지 않는다 (2026-08-21)

티켓 `cZWmTzoOXpHCg9HAUwqw`. 설계 정본은 `person-axis-user-key-design-2026-08-21.md`
(PR #1081)이고 **이 문서는 그 설계를 다시 쓰지 않는다.** 여기 적는 것은 세 가지뿐이다:
무엇을 코드로 만들었나 / 무엇을 켜지 않았나 / 켜려면 무엇을 해야 하나.

---

## 0. 한 줄

**표도 뷰도 적재 경로도 다 만들었고, `PERSON_AXIS_EFFECTIVE_FROM` 이 unset 이라
사람 축은 0행 + 사유를 돌려준다.** 처리방침 문안이 확정되면 env 한 줄로 열린다.

> ★**2026-08-21 갱신(티켓 `vilkbSrnzbAv4ezbZMRT`).** 처리방침 개정이 머지됐고
> 발효일도 정해졌다 — `PERSON_AXIS_EFFECTIVE_FROM=2026-04-01`(사장님 결정,
> **과거 포함**. 설계 §5.4-a). 즉 아래 §10 "켜는 순서" 의 **1·2 는 끝났다.**
> ★그래도 사람 축 뷰는 아직 행을 돌려주지 않는다. 게이트가 열리는 것과 데이터가
> 흐르는 것은 다른 일이고, **3~6(표·뷰 DDL 실행, 링크 MERGE 배선)이 남아 있다** —
> `personAxis.ts` 는 지금도 `index.ts` 어디에서도 import 되지 않는다(순수 로직 +
> 축 순수성 가드만 쓰인다). 게이트가 열린 뒤의 0행은 **여기가 원인**이지 게이트
> 문제가 아니다. 3~6 은 별도 티켓이다.
>
> ★**2026-08-21 재갱신(티켓 `euSq4AwHJrxSagMCjXeM`).** 위 문단은 이제 **낡았다** —
> 3~6 을 했다. 표·뷰가 프로덕션 BQ 에 실재하고 `personAxis.ts` 는 `index.ts` 가
> import 한다(`logTelemetryBatch` 의 링크 MERGE + `getAdminPersonAxisCoverage`).
> **남은 것은 배포 하나다**: `PERSON_AXIS_EFFECTIVE_FROM` 을 배포 머신에 넣고
> 함수를 배포해야 적재가 열린다. 절차는 `person-axis-activation-2026-08-21.md` §6.
> ★그리고 링크는 **forward-only** 라 배포 직후에도 사람 축은 거의 비어 있다 —
> 그게 정상이다(활성화 문서 §1).

---

## 1. ★게이트 — 왜 unset 이 안전한 기본값인가 (★값이 정해진 뒤의 의미는 §0 참조)

`v3/functions/src/personAxis.ts` 의 `PERSON_AXIS_EFFECTIVE_FROM_ENV`.
**기본값을 코드에 두지 않았다.** 이유는 상수 바로 위 주석에 길게 적어 뒀고, 요지는
이렇다 — 이 값은 "언제부터의 이벤트를 사람에게 귀속해도 되는가" 의 상한이고, 그 답을
정하는 것은 엔지니어링이 아니라 **고지**다.

unset 일 때 가능한 동작 셋 중 하나를 골라야 했다.

| 동작                   | 판정       | 이유                                                                               |
| ---------------------- | ---------- | ---------------------------------------------------------------------------------- |
| 예외를 던진다          | 기각       | 어드민 응답 전체가 죽는다. "사람 축이 아직 없다" 는 정상 상태지 장애가 아니다      |
| 조용히 전체를 보여준다 | ★절대 금지 | 상한 없는 소급이 된다. 고지 개정 **전** 구간까지 귀속된다                          |
| **0행 + 사유**         | ★채택      | 화면은 "미발효" 를 말하고 나머지 축은 평소대로 돈다. 문안 작업과 병렬로 갈 수 있다 |

게이트는 **조회만이 아니라 적재도** 막는다(`planUserInstallLink`). 닫힌 채로 링크가
쌓이면 나중에 여는 순간 개정 전에 만들어진 링크가 소급에 참여하기 때문이다.
`scripts/check-deploy-env.mjs` 의 `REQUIRED_KEYS` 에 **일부러 올리지 않았다** —
올리면 배포가 막히고, 막힌 배포를 뚫으려고 아무 날짜나 채우게 된다.

> ★**정정(2026-08-21, #1089).** 이 문단도 낡았다 — `PERSON_AXIS_EFFECTIVE_FROM` 은
> 그 뒤 `REQUIRED_KEYS` 로 **올라갔다.** 전제가 바뀌었기 때문이다: 값이 정해지기
> 전에는 unset 이 "아직 안 정했다" 였지만, 값이 정해진 뒤의 unset 은 **설정 누락**
> 이고 누락되면 사람 축 화면이 조용히 0행으로 남는다. 사유는 그 파일 상단 주석에
> 있다.

## 2. ★소급은 저장이 아니라 조회

이벤트 행에 `user_key` 컬럼을 **만들지 않았다.** 링크표 하나(`analytics_user_install`)와
뷰 두 벌(`v_person_since_link` 기본 / `v_person_all_time` 캠페인 귀속 전용)이 전부다.

이 성질을 테스트로 확인한다(`personAxis.test.ts` §2):

- `★★링크표를 지우면 소급이 그 자리에서 취소된다` — 같은 이벤트 입력에 링크만 비우면
  귀속이 0행이 되고, 익명 행은 "붙일 링크 없음" 으로 **세어질 뿐 사라지지 않는다.**
- `★한 사람만 지워도 그 사람의 과거 귀속만 풀린다` — PIPA 제36조 삭제요청이
  `DELETE ... WHERE user_key = ?` 한 줄로 끝난다는 실물.
- `★이벤트 행은 통과해도 변하지 않는다` — 입력 배열 불변. 저장 소급이 아니라는 뜻.

## 3. ★공용 기기 — 값을 만들지 않고 센다

한 `install_key` 에 `user_key` 가 둘 이상이면 그 설치는 **두 뷰 모두에서 제외**하고
제외 수를 `PersonAxisCoverage.excludedSharedInstalls` 로 화면에 올린다. 마지막
사람에게 몰아주면 그 사람의 리텐션이 남의 활동으로 부풀고, 그 왜곡은 숫자만 봐서는
안 보인다. **현재 실측 0건이다 — 값이 없을 때 규칙을 박아야 나중에 규칙 없이 값이
생기지 않는다.**

## 4. ★#1079 가드는 그대로다

`FORBIDDEN_ON_ANONYMOUS_AXIS` 에서 한 항목도 빼지 않았다. 축을 셋으로 늘렸을 뿐이다
(익명축 / 계정축 / **링크축**). 링크축은 `analytics_user_install` **한 표**이고, 두 키를
한 행에 담는 것이 허용된 유일한 자리다 — 잇는 자리가 하나뿐인 것이 "링크표를 지우면
사람 축이 통째로 사라진다" 의 근거다.

`analyticsProfiles.test.ts` 에 `★★익명축 금지 목록은 사람 축이 생겨도 한 항목도 줄지 않는다` 를 추가했다. 사람 축을 열려고 그 목록에서 `user_key` 를 빼는 것이 가장
쉬운 우회로이고, 그래서 거기가 제일 먼저 빨개져야 한다.

## 5. 권한 분리는 데이터셋이 아니라 IAM

`assertLinkDatasetIsolation()` + `npm run check:person-axis-isolation`.
데이터셋을 나누는 것 자체는 분리가 아니다 — 두 데이터셋의 principal 집합이 같으면
**이름표만 다른 같은 방**이다. 스크립트는 읽기 전용이고(데이터는 한 행도 안 읽고
메타데이터 `access[]` 만), 이메일은 마스킹해서 찍고, 분리가 확인되면 0 아니면 1 로
끝난다. `marblo_identity` 가 아직 없으면 **실패가 아니라 skip** 이다 — 게이트가 닫혀
있는 동안에는 그게 정상이다.

---

## 6. 변경 목록

| 파일                                     | 변경                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/personAxis.ts`                      | ★신규. 게이트·링크표 스키마/DDL·뷰 두 벌·공용기기·커버리지·IAM 검사·삭제 SQL                     |
| `src/personAxis.test.ts`                 | ★신규. 38 테스트                                                                                 |
| `src/analyticsPseudonym.ts`              | kind `user` + prefix `us_` 두 줄. **축 경계 주석 개정**(코드만 고치면 다음 사람이 주석을 믿는다) |
| `src/analyticsPseudonym.test.ts`         | "user kind 는 없다" 테스트를 **더 센 것으로 교체** (§7 참조)                                     |
| `src/analyticsProfiles.ts`               | `assertAxisPurity` 에 링크축 분기 추가. 기존 두 금지 목록 **무변경**                             |
| `src/analyticsProfiles.test.ts`          | 링크축 5 테스트 + 익명축 목록 회귀 방지                                                          |
| `scripts/check-person-axis-isolation.ts` | ★신규. 읽기 전용 IAM 점검                                                                        |
| `scripts/check-deploy-env.mjs`           | 주석만 — 이 env 를 REQUIRED 로 올리지 말라는 이유                                                |

**BQ 원본 수정·삭제 0건. 테이블 생성 0건. `ALTER` 0건.** DDL 은 전부 **문자열을 만드는
함수**이고 아무것도 실행하지 않는다.

## 7. ★교체한 테스트 하나 — 숨기지 않고 적는다

`analyticsPseudonym.test.ts` 에 `★계정축 kind('user')는 이 모듈에 존재하지 않는다`
가 있었다(#1075). 설계 §3.3·§7 이 kind 하나를 추가하기로 확정했으므로 그 테스트는 더
이상 참이 아니다. **지우지 않고 더 센 것으로 바꿨다** — 원래 테스트가 지키던 것은
"kind 가 없다" 가 아니라 "익명 테이블이 계정으로 되짚히지 않는다" 였고, 그 불변식은
아래 넷이 계속 지킨다.

1. `★user kind 는 자동 치환 목록에 오르지 않는다` — 설계 §3.4 의 지뢰(익명 세계
   `userId` 는 계정 uid 가 아니라 익명 설치 UUID다. `user` kind 로 가명화하면 익명축
   조인이 통째로 끊긴다).
2. `★user kind 와 install kind 는 같은 원시값에서도 다른 가명`.
3. `★person kind 를 만들지 않았다 — 키는 user_key 하나` (설계 §3.1).
4. `FORBIDDEN_ON_ANONYMOUS_AXIS` 회귀 방지(§4).

## 8. 검증

```
npm run test:person-axis          38 pass / 0 fail
npm run test:analytics-profiles   48 pass / 0 fail   (43 → 48)
npm run test:analytics-pseudonym  19 pass / 0 fail
npm run test:analytics-id-scheme  14 pass / 0 fail
npm run test:admin-analytics      97 pass / 0 fail   (무회귀)
npm run build                     OK (index.ts 포함 전체)
```

★**뮤테이션으로 가드를 검증했다** — 테스트가 못 잡는 가드는 가드가 아니다.

| 뮤테이션                                                | 결과          |
| ------------------------------------------------------- | ------------- |
| unset 이면 기본값으로 연다                              | 6 fail (잡음) |
| 게이트가 닫혀도 전체를 보여준다                         | 1 fail (잡음) |
| 공용기기를 제외하지 않고 몰아준다                       | 1 fail (잡음) |
| MERGE 가 `first_linked_at` 을 덮는다                    | 1 fail (잡음) |
| `FORBIDDEN_ON_ANONYMOUS_AXIS` 에서 `user_key` 제거      | 3 fail (잡음) |
| `FORBIDDEN_ON_LINK_AXIS` 에서 uid/email/person_key 제거 | 1 fail (잡음) |

## 9. 이 티켓에서 하지 않은 것

| 미완                                              | 이유                                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 설계 §9-2 `analyticsUserKey.ts` 배선              | ★그 파일이 이 브랜치에 **없다.** 커밋 `92da0c6d`(analytics_purchase)가 미머지 브랜치 `marblo/backend-claude-qm8n-6EnTiEzL` 에 있다. 여기서 같은 이름을 새로 만들면 머지 시 두 벌이 된다 |
| 설계 §9-5a `analytics_purchase` 백필              | 같은 이유                                                                                                                                                                               |
| 설계 §9-4 인증 텔레메트리 콜러블 MERGE 배선       | 게이트가 닫혀 있어 `planUserInstallLink` 가 항상 `written:false` 다. 배선은 게이트 개방 티켓에서 — 순서상 표 생성(3단계) 뒤다                                                           |
| 어드민 화면 `IngestionProgress` / `disabled` 상태 | 프론트 범위(`v3/src/components/` 수정 금지). ★`PersonAxisCoverage.state` 에 네 번째 값 `disabled` 가 생겼으니 프론트 티켓이 필요하다                                                    |
| 처리방침 문구                                     | 별도 티켓 `CjNfGmXvynZ5bk5vLuCZ`. 건드리지 않았다                                                                                                                                       |
| 실제 테이블·뷰 생성                               | 게이트가 닫혀 있는 동안에는 만들지 않는다(설계 §9 3단계)                                                                                                                                |

## 10. 켜는 순서 (다음 사람에게)

1. ~~처리방침 개정 승인·배포 → 발효일 확정.~~ **[x] 완료 2026-08-21** — PR #1080
   (사장님 승인 ③안) + 1회성 고지 배너(`PRIVACY_CLARIFICATION_VERSION` 상승).
   `CURRENT_POLICY_VERSION` 은 **올리지 않았다**(재동의 없음).
2. `functions/.env.<project>` 에 **`PERSON_AXIS_EFFECTIVE_FROM=2026-04-01`**.
   ★이 한 줄이 소급을 여는 스위치다. 값·근거는 `personAxis.ts` 상수 주석과
   설계 §5.4-a 에 있다. ★이 파일은 gitignore 대상이라 **커밋으로 배포되지 않는다** —
   배포 머신(메인 체크아웃)에서 직접 넣어야 한다. 넣었는지는
   `npm run check:deploy-env` 가 본다(2026-08-21 부터 필수 키).
3. ~~`buildUserInstallTableDdl()` 로 빈 표 생성 → `npm run check:person-axis-isolation`
   이 초록인지 확인.~~ **[x] 완료 2026-08-21** — 티켓 `euSq4AwHJrxSagMCjXeM`.
   `npm run provision:person-axis -- --apply`. 격리 점검 **[ok]**.
4. ~~`buildPersonAxisViewDdl()` 두 벌 실행.~~ **[x] 완료 2026-08-21** —
   ★**열린 형태**(상한 2026-04-01)로 만들었다. 이유는 활성화 문서 §2.1.
5. ~~인증 텔레메트리 콜러블에 링크 MERGE 배선(forward-only).~~
   **[x] 완료 2026-08-21** — `logTelemetryBatch` → `recordPersonAxisLink`.
6. ~~커버리지 노출.~~ **[x] 완료 2026-08-21** — `getAdminPersonAxisCoverage` +
   어드민 리텐션 탭의 `PersonAxisCoverageCard`. `state === "complete"` 일 때만
   퍼센트 헤드라인.

> ★**남은 것은 배포 하나다.** `PERSON_AXIS_EFFECTIVE_FROM=2026-04-01` 은
> `.env.<project>`(gitignore)라 **배포 머신에 직접 넣어야** 적재가 열리고,
> `scheduledBuildAnalyticsProfiles` 가 아직 배포돼 있지 않아 뷰의 원천
> (`analytics_user_daily`)이 비어 있다. 절차·확인·되돌리기는
> **`person-axis-activation-2026-08-21.md` §6** 에 있다.

> ★**그리고 링크는 forward-only 다.** 배선 뒤에도 각 설치는 **다음에 인증할
> 때부터** 붙으므로 배포 직후 사람 축은 거의 비어 있다 — 그게 정상이다. 이
> 문장은 코드(`PERSON_AXIS_FORWARD_ONLY_NOTE`)·응답(`forwardOnlyNote`)·화면
> (`PersonAxisCoverageCard`) 세 군데에 박혀 있다.

★1·2·3·4 는 **화면을 바꾸지 않는다.** 값이 흐르기 시작하는 것은 5부터다.
