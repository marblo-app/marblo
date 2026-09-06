---
title: 존재 확인에 실패한 대상을 목록에서 조용히 빼지 마라
tags: [domain/methodology, topic/verification, topic/identity, verdict/adopt, method/source-link]
status: verified
date: 2026-08-29
links: [[verify-result-row]], [[decision-sentence-first]], [[counting-unit-first]]
---

# 존재 확인에 실패한 대상을 목록에서 조용히 빼지 마라

> **한 줄 판정**: ★채택 — 존재 확인에 실패한 조인 대상은 목록에서 빼지 말고 판별 가능한 fallback 행으로 드러낸다. 이건 새 규칙이 아니라 `resolveTaskLabel` 이 이미 지키던 규칙을 `getProjectMembers` 한 곳이 어긴 것이다. ★**2026-09-06 2건째로 축이 하나 늘었다** — 대상을 빼는 이유가 "못 찾았다"가 아니라 **"정책상 못 싣는다"** 일 때도 같은 규칙이 걸린다. 이때는 fallback 행조차 못 만드는데(값 자체를 화면에 내보내면 안 되므로), 그래도 **비운 자리에 비웠다는 사실을 적는다.** "값이 없었다"와 "못 싣는다"는 조사 시 취할 조치가 다른 **두 개의 사실**이고, 조용히 비우면 그 둘이 뭉개진다.

## 무엇을 물었나

권한·소유권·감사처럼 "목록에 보이는 것"이 곧 운영 행동의 대상이 되는 화면에서, 조인 대상 문서를 못 읽거나 찾지 못하면 그 행을 숨겨도 되는가.

## 무엇을 했나

이번 멤버 목록 회귀와 기존 감사 화면 선례를 대조했다. 둘 다 원본 id 는 남아 있고 표시용 문서를 조인해 라벨을 만드는 구조다. 차이는 실패 처리다.

## 규칙

| 경우                         | 실패 처리                                                                          | 결과                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 틀린 쪽: `getProjectMembers` | `project.members` 의 uid 는 있었지만 `users/{uid}` 를 못 읽으면 멤버 행을 드롭했다 | 코드를 밀 수 있는 사람이 멤버 목록에 없어 오너가 권한을 거둘 수 없었다. 실제로 그 계정이 PR #1284 를 올렸는데 목록엔 없었다 |
| 옳은 쪽: `resolveTaskLabel`  | 제목을 못 찾으면 `#taskId` 로 떨어뜨린다                                           | 제목이 없어도 감사 행이 사라지지 않고, 어떤 티켓인지 판별 가능한 형태로 남는다                                              |

따라서 목록의 원본 멤버십·참조 id 가 권한이나 감사의 근거라면, 표시용 조인 실패는 "행 삭제"가 아니라 "불완전한 행 표시"로 처리한다. 이메일·이름을 못 찾으면 uid, 제목을 못 찾으면 `#id` 처럼 최소 식별자를 보여준다.

## 2건째 (2026-09-06) — 정책상 못 싣는 값도 "못 싣는다"고 말한다

티켓 `yJLfoRpqvCcvarIXcT23`(감사 원장 `params` 원문 노출 수리)이 이 노트의 반대편처럼 보이는 일을 했다. **화면에서 값을 뺐다.** 겉보기엔 이 노트를 어긴 것이다.

어기지 않았다. 이 노트가 금지하는 것은 **빼는 것**이 아니라 **조용히 빼는 것**이다.

**왜 fallback 행조차 못 만드는가.** 1건째는 `users/{uid}` 를 못 읽어도 uid 라는 최소 식별자가 손에 있었다. 이번은 다르다 — 원장의 `params` 원문에는 지시문·경로·티켓 본문이 그대로 들어 있고 거기 자격증명이 섞일 수 있다. **그 값의 어떤 축약형도 화면에 내보낼 수 없다.** 반쯤 가린 원문이 가장 나쁘다. 그러면 남는 선택은 "조용히 비우기" 하나뿐인 것처럼 보인다.

★아니다. **비운 자리에 비웠다는 사실을 적는 것**이 남는다. 세 층에서 그렇게 했다.

| 층   | 무엇을 남겼나                                                       | 이 사실이 답하는 질문                                               |
| ---- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 화면 | `paramsWithheld` → "정책 이전 기록이라 인자 원문은 표시하지 않는다" | "이 행에 원래 인자가 없었나, 아니면 있는데 안 보여주나"             |
| 문서 | `paramsOmitted` — 떨어진 **키 이름**만(값 없음)                     | "무엇이 빠졌나" — 키 이름은 툴 스키마에서 오므로 그 자체는 안전하다 |
| 문서 | `paramsHash` — 원본 전체의 해시                                     | "원문을 다른 데서 구하면 이게 그것인지 대조할 수 있나"              |

**그리고 통째로 비우지도 않았다.** 정책 이전 문서에서도 1등급 식별자(`task_id`·`role`·`status` 등)는 남긴다 — 1건째의 "최소 식별자 fallback" 과 정확히 같은 판단이다. 목표가 감추는 것이 아니라 **무엇이 안전하게 보여도 되는지 선을 긋는 것**이기 때문이다.

**이 2건째가 1건째에 더하는 것:** 1건째의 규칙은 "조인 실패를 필터 조건으로 쓰지 마라"였다 — 실패가 **우연**인 경우다. 이번은 실패가 아니라 **의도**다(정책이 막는다). 의도적으로 빼는 쪽은 "이건 우리가 일부러 뺀 거니까 설명이 필요 없다"고 넘어가기 쉽다. 그런데 화면을 보는 사람은 그 의도를 모른다 — 빈 칸은 우연히 빈 것과 똑같이 생겼다. ★**의도적 누락일수록 표시가 더 필요하다.**

## 왜

존재 확인 실패는 대상 부재의 증거가 아니다. 이번 건처럼 `project.members` 는 접근 권한의 정본이고 `users/{uid}` 는 표시용 프로필일 수 있다. 표시용 문서가 없다는 이유로 정본 행을 지우면 UI가 권한 현실보다 좁아지고, 오너가 철회해야 할 권한을 볼 수 없게 된다.

## 한계 / 정직성

- 이 노트는 원본 id 자체가 없을 때 임의 행을 만들라는 뜻이 아니다. 정본 목록이나 감사 행에 id 가 이미 있을 때만 fallback 표시를 만든다.
- fallback 행은 정상 프로필처럼 꾸미지 않는다. 표시 이름은 uid 또는 해시처럼 판별 가능한 값으로 두고, 세부 정보가 비어 있음을 숨기지 않는다.
- PR 번호와 경로가 갈리면 GitHub PR 본문과 현재 코드가 옳다. 이 노트는 반복 규칙과 핵심 대조만 남긴다.
- ★2건째의 표시는 **감사 뷰 두 곳에만** 붙였다(`AuditTimeline` · `ProjectAuditRow`). `ActivityStreamPanel` 은 정책 이전 문서가 대부분인 상시 스트림이라 같은 게이트를 걸면 패널이 통째로 죽는다 — 거기는 키 화이트리스트 읽기 + 표시 직전 스크럽으로 타협했고, **그 타협에는 보류 표시가 없다.** 숨기지 않고 적어 둔다: 그 패널에서는 옛 문서의 산문 자체가 여전히 보이고, 제거되는 것은 자격증명·PII·경로다.
- ★2건째는 **앞으로 쌓이는 문서**와 **이미 쌓인 문서**를 다르게 다룬다. 원장은 불변이라 기존 문서의 원문은 지울 수 없고, 화면 게이트는 화면만 막는다 — 직접 쿼리하는 프로젝트 멤버에게는 여전히 보인다.

## 실제 영향

권한·멤버·감사·결제처럼 행 누락이 운영 행동을 막는 목록에서는 조인 실패를 필터 조건으로 쓰지 않는다. `getProjectMembers` 는 누락 `users/{uid}` 에 대해 uid-visible 행을 유지하고, AuthProvider 세션 복원은 다음 로그인에서 프로필 문서가 없을 때 복구한다.

★2026-09-06 에 코드가 한 번 더 바뀌었다. 감사 원장 뷰가 정책 이전 문서의 `params` 를 걷어내면서 **걷어냈다는 사실을 같이 그린다**(`AuditRowEvidence.paramsWithheld` · `project.audit.detail.paramsWithheld`). 원장 문서 쪽에는 `paramsOmitted`(키 이름) · `paramsHash`(원본 대조용)를 남겼다. 회귀 가드는 뮤테이션으로 확인했다 — 화면 게이트를 끄면 8건이 뒤집힌다.

## Evidence

- [v3/src/services/teamService.ts](../../../v3/src/services/teamService.ts) — `users/{uid}` 읽기 실패·누락 시 uid-visible 멤버 행을 유지하는 현재 구현
- [v3/src/lib/projectAuditView.ts](../../../v3/src/lib/projectAuditView.ts) — `resolveTaskLabel` 이 제목 누락을 `#taskId` fallback 으로 드러내는 기존 선례
- PR #1287 본문 — `getProjectMembers` 드롭 증상과 persisted-session 프로필 누락 root cause trace
- ★2건째: [v3/src/lib/auditParamsPolicy.ts](../../../v3/src/lib/auditParamsPolicy.ts) — `displayableLedgerParams()` 가 걷어낸 것과 `withheld` 플래그를 같이 돌려주는 계약
- ★2건째: [v3/src/components/agents/AuditTimeline.tsx](../../../v3/src/components/agents/AuditTimeline.tsx) · [v3/src/components/project/ProjectAuditRow.tsx](../../../v3/src/components/project/ProjectAuditRow.tsx) — 보류 사실을 그리는 두 화면
- ★2건째: [v3/electron/mcp-server/ledger.ts](../../../v3/electron/mcp-server/ledger.ts) — `paramsOmitted`(키 이름만) · `paramsHash`(원본 대조용)
- ★2건째 테스트: [v3/tests/unit/audit-params-display-guard.test.ts](../../../v3/tests/unit/audit-params-display-guard.test.ts) · [v3/tests/unit/project-audit-row-params-withheld.test.ts](../../../v3/tests/unit/project-audit-row-params-withheld.test.ts) — "옛 문서라는 사실을 표시한다" 반대방향 테스트
- ★2건째 기준 문서: [v3/docs/audit-ledger-params-exposure-policy-2026-09-06.md](../../../v3/docs/audit-ledger-params-exposure-policy-2026-09-06.md)

## Backlinks

- [[verify-result-row]] · [[decision-sentence-first]] · [[counting-unit-first]] · [[sole-persistent-user-is-not-external]] · [[shared-project-retention-confounded-with-internality]]
- [[count-callers-before-closing-a-gate]] — 행을 남기는 것만으로는 부족하다. 그 행에 취할 운영 행동(철회·복구) 경로 자체를 게이트로 막지 않았는지 전수로 센다
