# `team/` 컴포넌트 가독성 — 조직 화면이 실제로 그리는 칸

- 티켓: `IHa97vlHPdkFq3DUL9zf` (후속 PR)
- 측정: 1920×1080, gstack `/browse` 헤드리스, 실제 `UsageCellView` 를 임시 라우트에서 렌더

## 왜 `team/` 인가 — 디렉터리 경계 ≠ 렌더 경계

가드 범위를 `/org`·`/admin` 으로 그은 것이 감사 #1495 때의 내 판단이었는데, **조직 화면은 `team/` 컴포넌트를 실제로 그린다.** import 를 따라가 잰 결과:

```
org/OrgUsageView.tsx   → team/TeamUsageView (UsageCellView — restricted·unwired·notCollected 칸)
org/OrgViews.tsx       → team/TeamUsageView
org/OrgHomeClient.tsx  → team/TeamOverviewClient      ← /org/me (개인 조직), :554
                          └→ team/TeamUsageView
                          └→ team/TeamAuditView
```

★`/org/me` 하나만 열어도 `team/` 의 위반 파일 셋이 **전부** 화면에 온다.
`/org/me` 는 감사 #1495 가 처음부터 대상으로 지목한 화면이다.

## 전/후 (색은 눈이 아니라 `getComputedStyle` 로 판정)

페이지 안에 `text-zinc-400`·`text-zinc-500`·`text-zinc-600` 기준 요소를 만들어 실측값과 대조했다.

| 파일                         | 칸                           | 문제의 줄                                           |
| ---------------------------- | ---------------------------- | --------------------------------------------------- |
| `before-cell-restricted.png` | 권한 없음 (`org_admin` 필요) | "조직 관리자에게 요청하면…" = **zinc-500 · 4.12:1** |
| `after-cell-restricted.png`  | 같음                         | **zinc-400 · 7.76:1**                               |
| `before-cell-unwired.png`    | 값 미전달                    | 본문 전체 = **zinc-500 · 4.12:1**                   |
| `after-cell-unwired.png`     | 같음                         | **zinc-400 · 7.76:1**                               |

★이 칸들은 꾸며낸 상태가 아니다. `OrgUsageView.tsx` 가 `data.kind === "restricted"` ·
`meta === null`(unwired) 일 때 그대로 위임하는 경로다 — 사장님이 org_member 계정이나
권한 제한 상황을 시연하시면 나오는 화면이다.

## 기준은 #1502 그대로

새 규칙을 만들지 않았다. `text-zinc-500`/`600`/`700` → `text-zinc-400`, `text-[10px]` → `text-[11px]`.
zinc-950 바탕에서 zinc-400 이 7.76:1 로 AA 를 넘는 가장 어두운 단계이고, 400 과 500 사이 단계가
Tailwind 램프에 없다.
