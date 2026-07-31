# Marblo v3 Playwright + Electron 회귀 테스트

UI / PTY / 칸반 / 미션 / 오케스트레이터 등 데스크탑 앱 영역의 자동 회귀
테스트. xterm 스크롤·탭 전환·드래그앤드롭 같은 brittle 한 UX 가 PR 마다
깨지지 않도록 가드한다.

---

## 설치

처음 한 번만:

```bash
npm install                          # devDep 에 @playwright/test 포함됨
npx playwright install chromium      # Electron 은 자체 Chromium 을 쓰지만 일부 헤드리스 의존성용
```

---

## 빠른 사용

```bash
# 빌드 (테스트가 dist-electron/ 을 띄움)
npm run build

# 실행
npm run test:e2e:pw                  # 헤드리스 (기본)
npm run test:e2e:pw:headed           # GUI 띄움
npm run test:e2e:pw:ui               # Playwright UI 런너
npm run test:e2e:pw:debug            # Inspector 열림 (PWDEBUG=1)
npm run test:e2e:pw:report           # 마지막 HTML 리포트 열기

# 특정 spec 만
npm run test:e2e:pw -- tests/playwright/unit/terminal-scroll.spec.ts

# 태그 필터
npm run test:e2e:pw -- --grep @unit
```

---

## Tier 구조

```
tests/playwright/
├── unit/        ← Tier 1: UI shape 회귀 (렌더·셀렉터·라우팅·스크롤)
│                  무비용. CI 매번. 95% 의 회귀 잡힘.
│
├── mocked/      ← Tier 2: PTY/Firestore/IPC mock 시나리오
│                  격리된 채로 에이전트 spawn / 카드 전이 등 검증.
│                  매번 실행 가능. (현재 미구현 — fixture stub 만 있음)
│
├── live/        ← Tier 3: 진짜 LLM + 진짜 Firestore
│                  RUN_LLM_E2E=1 게이트, 비용 발생. 야간 1회 등으로 한정.
│
├── cleanroom/   ← 최초실행(신규 유저) 퍼널. 격리된 userData/HOME/PATH 로
│                  "처음 켠 앱"을 재현 — 온보딩 팝업 재노출(#579), 첫 티켓
│                  라우팅(#580), 설치 실패 대안, BYOM 경로를 검증한다.
│                  실행/발견사항: ../../docs/QA-CLEANROOM-FIRST-RUN.md
│                  ※ 기존 사용자 프로필(~/Library/Application Support/Marblo,
│                    ~/.claude)은 절대 건드리지 않는다.
│
├── helpers/
│   ├── launch.ts      ← Electron _electron.launch wrapper
│   └── fixtures.ts    ← test.extend(marblo, ...) Playwright fixture
│
└── pages/
    └── TerminalPage.ts ← xterm.js PTY 터미널 POM
```

각 spec 은 `@unit`, `@mocked`, `@live` 태그를 첫 인자에 포함. CI 에서
`--grep @unit` 으로 Tier 1 만 빠르게 회전 가능.

---

## 새 테스트 추가하기

```ts
// tests/playwright/unit/my-feature.spec.ts
import { test, expect } from "../helpers/fixtures";

test("@unit 새 기능이 회귀 없이 동작한다", async ({ marblo }) => {
  await marblo.openTab("missions");
  await expect(marblo.page.locator("...")).toBeVisible();
});
```

같은 시나리오를 여러 set 으로 변주하려면 `test.describe` + `test.each`
패턴 활용. 셀렉터·동작이 반복되면 **POM 클래스로 추출** (`pages/MissionTab.ts`
처럼) — fixture 의 `marblo.missions` 같은 식으로 노출.

---

## CI 통합 (보류 상태)

`.github/workflows/playwright.yml` (생성 시) — 다음 트리거 후보:

- PR 마다 `@unit` 만 실행 (~2-3분)
- main merge 시 `@unit + @mocked` 실행
- 야간 cron 으로 `@live` 한 번

지금은 워크플로우 자동 활성 안 함 — 안정화 후 사용자가 enable.

### 프로젝트 협업 E2E

`cleanroom/team-collaboration.spec.ts`는 기존 cleanroom 하네스를 사용해
두 멤버가 포함된 프로젝트의 공유 보드 가시성과 `userData`/`HOME` 격리를
검증한다. 초대·수락·채팅 라운드트립·프레즌스 스트림은
`tests/integration/team-collaboration.test.ts`에서 두 개의 명시적인 사용자
신원과 live in-memory listener backend로 검증한다.

완전한 두 Electron 인증 프로필을 Firestore 에뮬레이터에 연결하는 경로는
현재 CI 자동화 범위가 아니다. 실제 Firebase 인증/보안 규칙까지 포함한 수동
검증은 두 별도 userData 프로필로 다음 순서로 수행한다: A가 TeamManagement에서
B의 이메일을 초대 → B가 InvitationBanner에서 수락 → A가 B를 Members에서
확인 → A가 팀 채팅을 보내고 B 창에서 수신 → B가 접속한 공유 보드에서
PresenceIndicator를 확인한다. 이 구간은 테스트에서 조용히 생략하지 않고
수동 검증으로 명시한다.

---

## 디버깅 팁

| 증상                      | 해결                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Electron launch 안 됨     | `npm run build` 다시. `dist-electron/main.js` 가 있어야 함.                                                |
| 테스트가 "터미널 못 찾음" | TabBar.tsx 의 라벨 / OrchestratorTerminal data-testid 변경됐는지 확인 → fixtures.ts, TerminalPage.ts 갱신. |
| Firebase 에러로 부팅 실패 | `MARBLO_TEST_MODE=mock` 로 띄움. Tier 2 fixture 가 stub.                                                   |
| 시각 회귀 잡고 싶음       | `expect(page).toHaveScreenshot()` 사용. 첫 실행이 baseline 생성.                                           |
| 실패 trace 보기           | `npm run test:e2e:pw:report` 또는 `test-results/.../trace.zip` 을 https://trace.playwright.dev 에 드롭     |

---

## 알려진 제약

1. **macOS Electron Apple Silicon**: `electron-rebuild` 로 node-pty 가 ABI
   맞게 빌드되어 있어야 함. `npm run postinstall` 자동 실행됨.
2. **PTY 콘텐츠 부족 시 skip**: 일부 회귀 테스트는 실제 PTY 출력이 없으면
   조용히 skip. Tier 2 mock fixture 가 완성되면 deterministic 으로 강제.
3. **dev mode 자동 launch 미지원**: 첫 버전은 production build 만. dev
   mode 는 vite ready race condition 처리 후 추가 예정.
