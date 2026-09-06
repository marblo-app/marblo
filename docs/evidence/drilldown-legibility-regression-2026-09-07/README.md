# 5단 드릴다운 실행 원장 축 — 흐린 11px 회귀 전/후

- 티켓: `IHa97vlHPdkFq3DUL9zf`
- 대상: `marblo-web/src/app/[locale]/org/OrgDrilldownView.tsx:525` · `:537`
- 측정: 1920×1080, gstack `/browse` 헤드리스, 실제 소스 컴포넌트(`ProjectDrilldownDetail`)를 임시 라우트에서 렌더
- 픽스처는 기존 `OrgDrilldownView.test.tsx` 의 `detailWithLedger` 와 같은 봉투다 — 가짜 데이터 아니고 `disabled` / `empty` 상태다

| 파일                           | 상태                      | 문제의 줄 색 (브라우저 실측)             |
| ------------------------------ | ------------------------- | ---------------------------------------- |
| `before-ledger-restricted.png` | 원장 게이트 닫힘 (`:525`) | `oklch(0.552 …)` = **zinc-500 · 4.12:1** |
| `after-ledger-restricted.png`  | 같음                      | `oklch(0.705 …)` = **zinc-400 · 7.76:1** |
| `before-ledger-empty.png`      | 원장 비어 있음 (`:537`)   | `oklch(0.552 …)` = **zinc-500 · 4.12:1** |
| `after-ledger-empty.png`       | 같음                      | `oklch(0.705 …)` = **zinc-400 · 7.76:1** |

★색은 눈으로 판정하지 않았다. 페이지 안에서 `text-zinc-400` · `text-zinc-500` 기준 요소를
따로 만들어 `getComputedStyle` 값을 비교했다 — 실측값이 zinc-400 기준과 **정확히 일치**하고
zinc-500 기준과 다르다.

## 크기(11px)는 왜 그대로인가

`consoleLegibility.test.ts` 의 기준은 **"하한은 11px"** 이다(`text-[9px]` · `text-[10px]` 만 금지).
#1502 는 9px 5곳 · 10px 37곳을 11px 로 올렸고 기존 11px 은 건드리지 않았다.
현재 `/org`+`/admin` 19파일 실측: `text-[9px]` **0** · `text-[10px]` **0** · `text-[11px]` **224**.

→ 이 두 줄은 **하한 미만이 아니라 하한에 있다.** 여기만 12px 로 올리면 같은 표면의 나머지
224곳과 어긋나므로, 색만 고치는 것이 #1502 기준의 **온전한 적용**이지 반쪽이 아니다.
같은 파일의 형제 8줄(`:76 :247 :251 :270 :581 :592 :676 :681`)이 이미
`text-[11px] leading-relaxed text-zinc-400` 이다 — 회귀한 두 줄만 예외였다.
