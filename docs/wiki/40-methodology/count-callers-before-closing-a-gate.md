---
title: 게이트를 닫기 전에 호출자를 전수로 세고, 복구 경로를 찾는다
tags: [domain/methodology, topic/teams, topic/verification, verdict/adopt, method/source-link]
status: verified
date: 2026-09-04
links: [[do-not-silently-drop-missing-join-targets]], [[empty-query-first]], [[counting-unit-first]], [[same-assumption-repeats-across-layers]]
---

# 게이트를 닫기 전에 호출자를 전수로 세고, 복구 경로를 찾는다

> **한 줄 판정**: ★채택 — 권한 게이트를 닫기 전에 그 필드를 쓰는 호출자를 **전수로 센다**. F2 에서 census 가 찾은 호출자는 **4개**였고, 그중 **1개는 감사 보고서에 없었으며**, 그 1개는 막으면 **복구 수단 자체가 사라지는** 경로였다. 감사가 세는 것과 census 가 세는 것은 다른 집합이다. ★**2026-09-05 2건째로 방향이 하나 늘었다** — 게이트가 allowlist(default-deny)면 **새 writer 를 들일 때도** 센다. 안 세면 그 쓰기는 조용히 거부되고, fail-open 이 그 거부를 삼켜 가드가 한 번도 안 걸린다.

## 무엇을 물었나

`firestore.rules` 의 클라이언트 write allowlist 에서 필드를 하나 빼려 한다. 감사 보고서가 "이 필드를 빼고 콜러블로 옮겨라"라고 조치까지 적어 줬다. 그대로 빼면 되는가.

## 무엇을 했나

빼기 전에 그 필드를 쓰는 **클라이언트 호출자를 전수로 셌다**. grep 축을 먼저 적고(`arrayUnion|arrayRemove`, `<필드>:`, 그 필드를 실을 수 있는 범용 updater 호출), 앱·웹·메인프로세스 세 트리에 모두 걸었다. 그다음 호출자마다 세 번째 질문을 던졌다 — **"이 경로를 막으면, 막힌 상태에서 빠져나올 다른 길이 있는가."**

## 결과 (수치)

| # | 호출자 | 성격 | 대체 경로 | 판정 |
| --- | --- | --- | --- | --- |
| C1 | `createProject` (`members:[본인]`) | 문서 생성 | 해당 없음(`allow create` 는 별도 게이트) | 무관 |
| C2 | 초대 수락 self-join | 자기 uid 만 추가 | 이미 전용 분기 존재 | 유지 |
| C3 | **오너 자가치유** (owner 인데 `members` 에 없는 레거시 문서 복구) | 자기 uid 만 추가 | **없다** | ★전용 분기 신설 |
| C4 | 관리 화면의 멤버 제거 | 남의 uid 조작 | 콜러블 | 이관 |

재현 단위는 **게이트 1개**(= allowlist 필드 1개). 표본은 F2 **1건**(닫는 방향)에 2026-09-05 텔레그램 건 **1건**(여는 방향)을 더해 **2건**이고, census 대상 트리는 3개(`v3/src` · `v3/electron` · `marblo-web`)다.

**감사 보고서가 놓친 것은 C3 하나다.** 감사는 "누가 이 권한을 남용할 수 있나"를 셌고, census 는 "누가 이 권한에 의존하나"를 센다. 두 집합은 겹치지만 같지 않다.

C3 를 콜러블로 보내지 않은 이유가 이 노트의 핵심이다. 오너가 `members` 에서 빠진 문서는 **읽기 게이트상 오너 본인이 못 여는 문서**다. 그 상태를 고치는 유일한 경로를 닫으면, 닫힌 뒤에는 아무도 못 고친다 — 콜러블로 옮겨도 마찬가지가 아니라, 옮기는 편이 더 낫지도 않다(로그인마다 도는 자가치유에 네트워크 왕복이 붙는다). 대신 **자기 uid 만** 넣는 단일 전이로 좁혀 rules 에 남겼다. 오너는 좌석 계산에서 항상 1석으로 세므로 이 전이는 좌석 총량을 바꾸지 않는다.

## 2건째 (2026-09-05) — 여는 방향에서 같은 census 가 구멍을 찾았다

티켓 `t5X4CUwr4LqbEZNRpeEZ` 이 `projects/{id}` 에 `telegramChannelBinding`(텔레그램 채널의 기기 귀속)을 새로 쓰려 했다. 같은 문서, 같은 allowlist 사다리다. 넣기 전에 census 를 돌렸고 **두 가지**가 나왔다.

**(가) 새 필드를 어느 티어에 넣는가.** 그냥 `projectMemberWritableFields()` 에 추가하는 것이 최단 경로였다. 그러면 아무 멤버나 남의 uid 로 서명한 귀속을 심을 수 있다 — 인수 기록이 위조 가능해져 이 기능의 목적("누가 가져갔는지 남긴다")이 그 자리에서 무너진다. 대신 **내용 검증이 붙은 별도 티어**(`projectBindingWritableFields()` + `telegramBindingWriteValid()`)로 좁혔다: `boundByUid == request.auth.uid` 서명 강제, `tokenHash` 32자 상한(토큰 원문이 실릴 수 없는 크기), 귀속 단독 삭제 금지(채널 삭제와 동반될 때만).

**(나) ★census 가 덤으로 찾은 것 — 이미 들어와 있던 writer 하나가 게이트를 통과하지 못하고 있었다.** 필드명을 allowlist 함수들에 전수로 걸다가, 직전 티켓(`hAzP05kOTxggd8LhZGwT`, 폴러 리스)이 넣은 `telegramPollerLease` 가 **어느 목록에도 없다**는 것이 나왔다.

| 확인 축 | 결과 |
| --- | --- |
| `projectMemberWritableFields()` | 없음 (folderPath · folderPaths · legacyFolderPath · folderPathResolution · gitRemoteUrl · telegramChannel · enabledModels · updatedAt) |
| `projectAdminWritableFields()` | 없음 (위 + name · kind · assistantTriggers) |
| create 키 | 없음 |
| 쓰기 주체 | client SDK `setDoc(doc(db,"projects",id), {telegramPollerLease: …}, {merge:true})` — 룰을 탄다 |
| 에뮬레이터 프로브 | 그 쓰기가 거부됨을 실측 (확인 후 제거) |

allowlist 는 default-deny 라 **모든 리스 쓰기가 permission-denied** 였다. 그리고 리스는 (옳게) fail-open 이라 그 거부를 삼킨다 — 그래서 **리스 가드가 한 번도 걸리지 않은 채로, 아무 오류도 없이, 초록으로 배포돼 있었다.** 두 맥이 한 봇을 두고 싸우는 것을 막으라고 넣은 층이 정확히 그 상황에서 안 켜진다.

**이 2건째가 1건째에 더하는 것:** 게이트 census 는 닫을 때만 하는 것이 아니다. allowlist 는 **양방향 게이트**이고, 새 writer 를 들이는 쪽이 오히려 더 조용하게 실패한다 — 닫는 쪽 실수는 사용자가 "안 된다"고 신고하지만, 여는 쪽 실수는 fail-open 과 만나면 **아무도 신고하지 않는다.**

★그 자리에서 고치지 않은 이유도 census 의 결론이다. `telegramPollerLease` 를 멤버 allowlist 에 그냥 추가하면 새 DoS 가 열린다 — 아무 멤버나 남의 machineId 로 유효한 리스를 심어 팀원의 폴러를 영구히 `held-by-other` 로 묶을 수 있다(리스는 폴링을 실제로 차단하는 유일한 판정이다). (가) 처럼 `holderId` 서명 강제가 같이 가야 하고, 그것은 그 티켓의 설계 결정이라 별건으로 올렸다. **census 는 구멍을 여는 권한까지 주지는 않는다** — 찾은 것을 정확히 보고하는 데서 멈춘다.

## 체크리스트

게이트를 좁히는 모든 변경에 세 질문을 순서대로 던진다.

1. **이 필드·경로를 쓰는 호출자가 전부 몇 개인가.** grep 축을 먼저 적고 결과를 목록으로 남긴다. 감사·설계 문서의 목록을 그대로 믿지 않는다.
2. **각각을 대체 경로로 옮길 수 있는가.** 옮기면 판정(플랜·좌석·역할)이 서버로 가는가.
3. **★옮길 수 없는 것이 있는가.** 특히 자가치유·복구·재시도 경로 — "그 권한이 없으면 그 고장 상태에서 빠져나올 수 없는" 경로다. 있으면 그것만 **최소 형태로** 남기고, 남긴 이유와 그것이 왜 안전한지를 규칙 옆에 적는다.

3번에서 남긴 예외는 반드시 **반대방향 테스트**를 함께 붙인다. 거부 테스트만 있으면 다음 사람이 "이 분기 없어도 테스트 초록인데?" 하며 지운다.

### ★거울 — 게이트 뒤에 새 writer 를 들일 때 (2026-09-05 추가)

allowlist 는 default-deny 다. 목록에 없는 필드는 **거부가 기본값**이라, 새 필드를 쓰는 코드를 넣으면서 allowlist 를 같이 안 고치면 그 쓰기는 100% 실패한다. 위 세 질문을 뒤집어 던진다.

1. **이 쓰기를 받아줄 게이트가 실제로 있는가.** 필드명을 allowlist 함수 **전부**에 걸어 목록으로 남긴다. writer 쪽 코드 리뷰로는 안 잡힌다 — writer 만 보면 완벽해 보이기 때문이다.
2. **거부되면 무엇이 되는가.** fail-closed 면 시끄럽게 죽어서 발견된다. **fail-open 이면 기능이 조용히 없는 것이 된다** — 위 (나) 가 정확히 이 경우다. fail-open 은 옳은 설계지만, 그 대가로 게이트 확인을 사람이 대신 해야 한다.
3. **★그 게이트를 여는 것이 새 공격면을 여는가.** 필드를 allowlist 에 넣는 것은 "아무 멤버나 임의의 값을 쓸 수 있다"와 같은 말이다. 서명 강제·크기 상한·전이 제약 같은 내용 검증이 같이 가야 하는지 본다. 필요하면 티어를 새로 판다.

새 writer 에는 **룰을 통과한다는 것 자체의 테스트**를 에뮬레이터로 붙인다. writer 의 단위 테스트는 룰을 타지 않으므로 전부 초록이어도 이 축에 대해서는 아무것도 증명하지 않는다.

## 왜

게이트를 닫는 판단은 위협 모델에서 나온다. 위협 모델은 **공격자**를 열거하고, 정상 운영에 그 권한이 왜 필요했는지는 열거하지 않는다. 그래서 "막아도 되는 것"과 "막으면 안 되는 것"을 같은 목록에서 찾을 수 없다. census 는 후자를 만드는 유일한 방법이고, 그중에서도 복구 경로는 **막힌 뒤에 발견되면 이미 늦다** — 고장 상태를 고칠 권한이 그 고장 때문에 필요한, 자기참조 구조이기 때문이다.

## 한계 / 정직성

- 표본 2건이다(F2 = 닫는 방향, 텔레그램 = 여는 방향). "감사·설계 목록이 항상 불완전하다"가 아니라 "그 목록을 완전하다고 가정하면 안 된다"가 이 노트의 주장이다. 2건 다 census 가 **그 목록에 없던 것**을 하나씩 찾았지만, 2건으로 빈도를 주장하지는 않는다.
- 여는 방향의 2건째는 후속에서 고쳤다. `telegramPollerLease`는 일반 멤버 allowlist가 아니라 UID·서버시각·만료 인수 검증이 붙은 별도 티어로 들어갔다. 이 노트의 census 결론은 [[firestore-lease-actor-and-server-time]]가 현재 정본으로 이어받는다.
- census 는 grep 기반이라 **필드명을 문자열로 조립하는 동적 경로는 못 잡는다**. 그런 경로가 의심되면 grep 축에 조립 조각을 넣거나 타입 수준에서 좁힌다.
- 남긴 예외는 공격면이다. C3 는 "자기 uid 만"으로 좁혀서 남긴 것이지, "오너니까 믿는다"로 남긴 것이 아니다. 좁히지 못하는 예외라면 남기는 대신 복구 수단을 따로 만든다(운영 콜러블 등).
- **갈리면 코드와 rules 원문이 옳다.** 이 노트는 절차만 남긴다.

## 실제 영향

코드가 바뀌었다. `firestore.rules` 는 `members` 를 관리자 write allowlist 에서 빼면서 오너 자가치유 분기를 함께 넣었고, 그 분기의 **반대방향 테스트**(빠진 오너가 자기 uid 를 되넣을 수 있다)가 회귀 가드로 붙었다. 뮤테이션으로 확인했다 — 그 분기만 지우면 그 테스트 1건이 뒤집힌다. 다음 rules·권한 축소 작업은 위 3단 체크리스트를 먼저 돌린다.

★2026-09-05 에 코드가 한 번 더 바뀌었다. `telegramChannelBinding` 은 멤버 allowlist 에 그냥 얹히는 대신 내용 검증이 붙은 **별도 티어**로 들어갔고(서명 강제·크기 상한·단독 삭제 금지), 그 강제마다 에뮬레이터 거부 테스트가 붙었다 — 뮤테이션으로 확인했다(서명 강제를 지우면 해당 테스트 1건이 뒤집힌다). 같은 census 가 `telegramPollerLease` 의 allowlist 누락을 찾아 별건으로 올렸다. **rules 를 건드리는 모든 티켓은 이제 두 방향을 다 돌린다** — 빼는 필드의 호출자를 세고, 넣는 필드의 게이트를 센다.

## Evidence

- [v3/firestore.rules](../../../v3/firestore.rules) — `addsOnlySelfToMembers()` 공통 모양 + `isInvitedSelfJoin` · `isOwnerSelfJoin` 두 자격 분기, `projectAdminWritableFields()` 에서 빠진 `members`
- [v3/src/services/agentAuthService.ts](../../../v3/src/services/agentAuthService.ts) — `ensureOwnedProjectMembership` (C3, census 로만 드러난 호출자)
- [v3/src/services/projectService.ts](../../../v3/src/services/projectService.ts) — 멤버십 쓰기 초크포인트 계약과 `removeMember` 가 여기 없는 이유
- [v3/firestore.rules.test.ts](../../../v3/firestore.rules.test.ts) — F2 describe 의 거부 테스트와 ★반대방향 테스트(초대 수락 self-join · 오너 자가치유)
- ★2건째(여는 방향): [v3/firestore.rules](../../../v3/firestore.rules) — `projectBindingWritableFields()` 별도 티어와 `telegramBindingWriteValid()` 내용 검증, 그리고 `projectMemberWritableFields()` 에 **없는** `telegramPollerLease`
- ★2건째의 writer 쪽(게이트를 통과하지 못하던 `setDoc`): [v3/electron/telegram-channel-sync.ts](../../../v3/electron/telegram-channel-sync.ts) — `TELEGRAM_LEASE_FIELD` · `TELEGRAM_BINDING_FIELD` 쓰기 경로

## Backlinks

- [[do-not-silently-drop-missing-join-targets]] · [[empty-query-first]] · [[counting-unit-first]]
- [[marblo-bot-messaging]] — 2건째가 나온 자리(텔레그램 채널이 프로젝트 문서에 싣는 세 필드)의 제품 쪽 서술
- [[name-the-actor-not-just-the-resource]] — 게이트를 여는 쪽에서 "누가 쓰는가"를 서명으로 강제한 이유
- [[firestore-lease-actor-and-server-time]] — 발견된 lease writer를 안전하게 들인 현재 검증 모델
- [[same-assumption-repeats-across-layers]] — 같은 "전수로 세라" 계열의 다음 규칙. 이쪽은 **호출자**를, 저쪽은 **가정의 보유자**를 센다(주석과 분기 조건에 자연어로 숨는다)
