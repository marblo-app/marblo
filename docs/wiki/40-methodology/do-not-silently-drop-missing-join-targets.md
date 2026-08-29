---
title: 존재 확인에 실패한 대상을 목록에서 조용히 빼지 마라
tags: [domain/methodology, topic/verification, topic/identity, verdict/adopt, method/source-link]
status: verified
date: 2026-08-29
links: [[verify-result-row]], [[decision-sentence-first]], [[counting-unit-first]]
---

# 존재 확인에 실패한 대상을 목록에서 조용히 빼지 마라

> **한 줄 판정**: ★채택 — 존재 확인에 실패한 조인 대상은 목록에서 빼지 말고 판별 가능한 fallback 행으로 드러낸다. 이건 새 규칙이 아니라 `resolveTaskLabel` 이 이미 지키던 규칙을 `getProjectMembers` 한 곳이 어긴 것이다.

## 무엇을 물었나

권한·소유권·감사처럼 "목록에 보이는 것"이 곧 운영 행동의 대상이 되는 화면에서, 조인 대상 문서를 못 읽거나 찾지 못하면 그 행을 숨겨도 되는가.

## 무엇을 했나

이번 멤버 목록 회귀와 기존 감사 화면 선례를 대조했다. 둘 다 원본 id 는 남아 있고 표시용 문서를 조인해 라벨을 만드는 구조다. 차이는 실패 처리다.

## 규칙

| 경우 | 실패 처리 | 결과 |
| --- | --- | --- |
| 틀린 쪽: `getProjectMembers` | `project.members` 의 uid 는 있었지만 `users/{uid}` 를 못 읽으면 멤버 행을 드롭했다 | 코드를 밀 수 있는 사람이 멤버 목록에 없어 오너가 권한을 거둘 수 없었다. 실제로 그 계정이 PR #1284 를 올렸는데 목록엔 없었다 |
| 옳은 쪽: `resolveTaskLabel` | 제목을 못 찾으면 `#taskId` 로 떨어뜨린다 | 제목이 없어도 감사 행이 사라지지 않고, 어떤 티켓인지 판별 가능한 형태로 남는다 |

따라서 목록의 원본 멤버십·참조 id 가 권한이나 감사의 근거라면, 표시용 조인 실패는 "행 삭제"가 아니라 "불완전한 행 표시"로 처리한다. 이메일·이름을 못 찾으면 uid, 제목을 못 찾으면 `#id` 처럼 최소 식별자를 보여준다.

## 왜

존재 확인 실패는 대상 부재의 증거가 아니다. 이번 건처럼 `project.members` 는 접근 권한의 정본이고 `users/{uid}` 는 표시용 프로필일 수 있다. 표시용 문서가 없다는 이유로 정본 행을 지우면 UI가 권한 현실보다 좁아지고, 오너가 철회해야 할 권한을 볼 수 없게 된다.

## 한계 / 정직성

- 이 노트는 원본 id 자체가 없을 때 임의 행을 만들라는 뜻이 아니다. 정본 목록이나 감사 행에 id 가 이미 있을 때만 fallback 표시를 만든다.
- fallback 행은 정상 프로필처럼 꾸미지 않는다. 표시 이름은 uid 또는 해시처럼 판별 가능한 값으로 두고, 세부 정보가 비어 있음을 숨기지 않는다.
- PR 번호와 경로가 갈리면 GitHub PR 본문과 현재 코드가 옳다. 이 노트는 반복 규칙과 핵심 대조만 남긴다.

## 실제 영향

권한·멤버·감사·결제처럼 행 누락이 운영 행동을 막는 목록에서는 조인 실패를 필터 조건으로 쓰지 않는다. `getProjectMembers` 는 누락 `users/{uid}` 에 대해 uid-visible 행을 유지하고, AuthProvider 세션 복원은 다음 로그인에서 프로필 문서가 없을 때 복구한다.

## Evidence

- [v3/src/services/teamService.ts](../../../v3/src/services/teamService.ts) — `users/{uid}` 읽기 실패·누락 시 uid-visible 멤버 행을 유지하는 현재 구현
- [v3/src/lib/projectAuditView.ts](../../../v3/src/lib/projectAuditView.ts) — `resolveTaskLabel` 이 제목 누락을 `#taskId` fallback 으로 드러내는 기존 선례
- PR #1287 본문 — `getProjectMembers` 드롭 증상과 persisted-session 프로필 누락 root cause trace

## Backlinks

- [[verify-result-row]] · [[decision-sentence-first]] · [[counting-unit-first]]
