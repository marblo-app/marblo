---
title: 20 제약
tags: [domain/constraints, meta/index]
status: active
date: 2026-09-05
links: [[no-live-gui-verify]], [[do-not-retry]], [[verify-without-gui]], [[in-app-link-routing]], [[notification-needs-a-recipient]]
---

# 20-constraints

주력을 제한하는 규칙.

| 노트 | 한 줄 |
| --- | --- |
| [[no-live-gui-verify]] | 사장님이 쓰는 동안 Electron/브라우저 창을 띄워 검증하지 않는다 |
| [[verify-without-gui]] | 운영 검증 명령. functions 는 node:test, `[locale]` 경로를 tsx 에 직접 넘기지 않는다 |
| [[in-app-link-routing]] | 주소창에 쳐서 열리는 것은 클릭해서도 열린다. 밖으로 내보내는 예외는 임베디드에서 실제로 깨지는 것뿐 |
| [[notification-needs-a-recipient]] | 알림 라우팅은 대상 풀까지만 답한다. 풀이 비면 폐기가 아니라 폴백이고, 그래도 없으면 사람에게 올린다 |
| [[browser-session-approval-boundary]] | 로그인 세션에 자동 행동을 붙이려면 브라우저보다 승인 계층이 먼저다 |
