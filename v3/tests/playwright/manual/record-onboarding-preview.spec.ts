import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import {
  dismissBeginnerTour,
  launchCleanRoom,
  passFirstRunModals,
  waitForAppShell,
  type CleanRoom,
} from "../cleanroom/helpers/cleanroom";

/**
 * ★온보딩 프리뷰 **녹화 하네스** — 티켓 l14I6AhpUBzyD8zqYoW1.
 *
 * 무엇을 찍나: `lib/onboardingPreview` 의 시연 모드(설치 → 구독 선택 → 로그인
 * 대본 → 샘플 폴더 → 오케 대화창 → 첫 요청). 실제 로그인 흐름이 **아니다** —
 * 프리뷰는 실 프로브·설치 IPC·PTY 스폰·키체인·firestore 를 부르지 않으므로
 * 자격증명이 화면에 뜰 일이 없고, 재생이 결정적이라 다시 찍어도 같다.
 *
 * 어디서 찍나: 클린룸(`helpers/cleanroom`) — 이 실행 전용 `--user-data-dir` 와
 * `HOME` 을 임시 경로로 잡는다. 사장님 실제 상태(~/.claude.json, ~/.codex/auth.json,
 * ~/Library/Application Support/Marblo)에는 닿지 않는다(Me11Ze8kvI35LvONzU9F 의
 * 전면 리팩터를 기다리지 않고 이 실행만 격리).
 *
 * 왜 프리뷰를 localStorage 플래그로 켜고 부팅하지 않나: 프리뷰가 켜진 셸은
 * `CliSetupEngineHost` 를 아예 마운트하지 않는다(실 설치 금지 계약). 그 상태로
 * 부팅하면 `cliSetupStore.ready` 가 영영 false 라, 시뮬이 끝나는 `done`(패스스루)
 * 국면에서 화면이 실제 상태 = "미연결" 로 떨어져 연결 게이트가 다시 뜬다. 그래서
 * 사장님 기계에서 쓰는 순서 그대로 간다 — 먼저 평소대로 부팅해 엔진이 한 번
 * 돌고(클린룸 스텁: claude 준비됨), **설정 탭의 토글**로 프리뷰를 켠다.
 *
 * 실행:
 *   RECORD_ONBOARDING=1 npx playwright test tests/playwright/manual/record-onboarding-preview.spec.ts
 * 산출: test-results/onboarding-recording/raw.webm + marks.json (+ 체크포인트 png)
 * 인코딩(GIF/mp4 두 길이)은 tests/playwright/manual/record-onboarding-encode.py.
 *
 * ★재생 속도(대본 타이밍)는 건드리지 않는다. 영상용 배속이 필요하면 인코딩
 * 단계에서만 준다(encode 스크립트의 encode_speed).
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const OUT_DIR =
  process.env.RECORD_OUT_DIR ??
  path.join(REPO_ROOT, "test-results", "onboarding-recording");
const SIZE = { width: 1280, height: 800 };
/** 오케 대화창에 치는 첫 요청 — 사용자 입력 그 자체라 대본이 아니다. */
const FIRST_REQUEST =
  process.env.RECORD_FIRST_REQUEST ??
  "README 읽고 샘플 프로젝트를 둘러본 뒤, 테스트가 없는 함수에 테스트를 붙여줘";
/** 에코 한 글자 간격(ms) — 사람이 치는 속도 근사. 대본 타이밍과 무관. */
const TYPE_MS = 55;

interface Mark {
  name: string;
  at: number;
}

test.skip(
  !process.env.RECORD_ONBOARDING,
  "RECORD_ONBOARDING=1 일 때만 도는 녹화 하네스(회귀 테스트가 아니다)",
);
test.setTimeout(10 * 60_000);

async function hold(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

/**
 * 프리뷰가 끝난 뒤 착지할 "진짜" 프로젝트. 클린룸은 bypassAuth mock 유저라
 * Firestore createProject 가 거절되므로 스토어에 직접 넣는다(cleanroom.injectProject
 * 와 같은 모양, 이름만 샘플 폴더처럼). 경로는 클린룸 루트 안이다.
 */
async function injectSampleProject(page: Page, folder: string): Promise<void> {
  await page.waitForFunction(
    () =>
      !!(
        window as unknown as {
          __marbloTest?: { stores?: { project?: unknown } };
        }
      ).__marbloTest?.stores?.project,
    null,
    { timeout: 15_000 },
  );
  await page.evaluate((folderPath) => {
    const tw = (
      window as unknown as {
        __marbloTest: {
          stores: {
            project: {
              getState: () => { setCurrentProject: (p: unknown) => void };
            };
          };
        };
      }
    ).__marbloTest;
    tw.stores.project.getState().setCurrentProject({
      id: "onboarding-recording-project",
      name: "Marblo Sample",
      ownerId: "test-user-bypass",
      members: ["test-user-bypass"],
      folderPath,
      enabledModels: ["claude"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, folder);
}

/**
 * 하단 오케 xterm 을 실 CLI 없이 그린다(beginner-first-run G4 와 같은 해치).
 * 실 PTY 는 없다 — 세션 id 는 가짜이고 스폰은 일어나지 않는다.
 */
async function primeOrchestratorTerminal(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hatch = (
      window as unknown as {
        __marbloTest?: {
          stores: {
            orchestrator: {
              getState: () => {
                setSession: (
                  sessionId: string,
                  ptySessionId: string,
                  model?: "claude" | "codex",
                ) => void;
                setStatus: (status: "running") => void;
                setCollapsed: (collapsed: boolean) => void;
              };
            };
          };
        };
      }
    ).__marbloTest;
    if (!hatch) throw new Error("test hatch is unavailable");
    const orchestrator = hatch.stores.orchestrator.getState();
    orchestrator.setSession(
      "recording-orchestrator",
      "recording-pty",
      "claude",
    );
    orchestrator.setStatus("running");
    orchestrator.setCollapsed(false);
  });
  await page.locator(".xterm").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

/**
 * 가짜 PTY 의 "에코". 실 PTY 라면 타이핑한 글자를 터미널이 되돌려 그린다 —
 * 여기엔 PTY 가 없으므로 메인 프로세스가 같은 채널(`pty:data:<id>`)로 그
 * 에코만 보낸다. 오케의 **응답은 연출하지 않는다**(가짜 대화를 만들지 않는다).
 */
async function echoToTerminal(cr: CleanRoom, data: string): Promise<void> {
  await cr.app.evaluate(
    ({ BrowserWindow }, payload) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send(`pty:data:${payload.id}`, payload.data);
    },
    { id: "recording-pty", data },
  );
}

test("@manual 온보딩 프리뷰를 격리 클린룸에서 녹화한다", async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const marks: Mark[] = [];
  const mark = (name: string) => {
    marks.push({ name, at: Date.now() });
    console.log(`[record] ${name} @ ${new Date().toISOString()}`);
  };
  // 체크포인트마다 화면 캡처 + **화면 텍스트 덤프**. 텍스트는 프레임 육안 확인과
  // 별개로 기계 검사에 쓴다(치환 안 된 {placeholder}·이메일·토큰 모양).
  const textDumps: Record<string, string> = {};
  const shot = async (page: Page, name: string) => {
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
    textDumps[name] = await page
      .evaluate(() => document.body.innerText)
      .catch(() => "");
  };

  const launchedAt = Date.now();
  const cr = await launchCleanRoom({
    claude: "ready",
    codex: "missing",
    beginnerShell: true,
    orchestratorRunning: true,
    recordVideo: { dir: OUT_DIR, size: SIZE },
  });
  const { page } = cr;
  let videoPath: string | null = null;
  try {
    // 창 크기를 영상 규격에 맞춘다(recordVideo 는 이 크기로 스케일한다).
    await cr.app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.setContentSize(size.width, size.height);
      win?.center();
    }, SIZE);
    // 해치가 세울 가짜 오케 세션(recording-pty)에 대해 TerminalView 가 "세션
    // 만료" 를 찍지 않게 `pty:exists` 만 참으로 답한다(그 id 에 한해). 다른 id 는
    // 원본 핸들러 그대로다. 실 PTY 는 여전히 하나도 만들지 않는다.
    await cr.app.evaluate(({ ipcMain }) => {
      const handlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<string, (...a: unknown[]) => unknown>;
        }
      )._invokeHandlers;
      const origExists = handlers.get("pty:exists");
      ipcMain.removeHandler("pty:exists");
      ipcMain.handle("pty:exists", (e: unknown, arg: unknown) => {
        if ((arg as { id?: string })?.id === "recording-pty") return true;
        return origExists ? origExists(e, arg) : false;
      });
    });
    mark("launched");

    // ── 0. 평소 부팅: 최초실행 모달 → 셸 → 샘플 프로젝트 → 대화 국면 ─────
    await passFirstRunModals(page);
    await waitForAppShell(page);
    // 폴더 게이트가 선 뒤에 넣는다 — 부팅 중 projects 하이드레이션이 먼저 넣은
    // currentProject 를 도로 비운다(cleanroom.injectProject 주석, G3 와 같은 순서).
    await page
      .getByTestId("beginner-folder-gate")
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    // ★실재하는 폴더여야 한다 — 없는 경로를 물리면 파일트리·워처가 실패를 되풀이한다.
    // 첫 실행 샘플 시드(sample:ensure, 클린룸 안으로 돌려진 경로)가 만든 폴더를 쓰고,
    // 아직 없으면 최소 내용으로 만든다.
    fs.mkdirSync(cr.sampleDir, { recursive: true });
    if (!fs.existsSync(path.join(cr.sampleDir, "README.md"))) {
      fs.writeFileSync(
        path.join(cr.sampleDir, "README.md"),
        "# Marblo Sample\n\n온보딩 녹화용 샘플 폴더.\n",
      );
    }
    await injectSampleProject(page, cr.sampleDir);
    try {
      await page
        .locator('[data-coach="beginner-chat"]')
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });
    } catch (err) {
      await shot(page, "XX-boot-failed");
      const ids = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-testid]"))
          .map((el) => el.getAttribute("data-testid"))
          .slice(0, 80),
      );
      console.log("[record] boot failed; testids:", ids.join(","));
      throw err;
    }
    await dismissBeginnerTour(page);
    // 왼쪽 파일트리는 접는다 — 클린룸 임시 경로(/var/folders/…)가 그대로 찍히는데
    // 공개 영상에 의미가 없고, 대화·보드에 폭을 준다. 해치(스토어)로만 접는다.
    await page.evaluate(() => {
      (
        window as unknown as {
          __marbloTest: {
            stores: {
              splitWorkspace: {
                getState: () => { setFileTreeOpen: (open: boolean) => void };
              };
            };
          };
        }
      ).__marbloTest.stores.splitWorkspace.getState().setFileTreeOpen(false);
    });
    mark("booted_real");
    await shot(page, "00-real-chat");

    // ── 1. 설정 탭 토글로 프리뷰 ON → 대화 탭 → 연결 게이트(시뮬) ──────────
    await page.getByTestId("beginner-open-settings").click();
    const toggle = page.getByTestId("settings-onboarding-preview-toggle");
    await toggle.waitFor({ state: "visible", timeout: 15_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("beginner-tab-chat").click();
    // 개발용 띠(프리뷰 배지·국면·조작 버튼)는 제품 화면이 아니라 시연 조작부다 —
    // 공개 영상에서는 가린다. CSS 뿐이라 프리뷰의 경계(부수효과 0)는 그대로다.
    await page.addStyleTag({
      content:
        '[data-testid="onboarding-preview-banner"]{display:none !important}',
    });
    await page
      .getByTestId("beginner-connect")
      .waitFor({ state: "visible", timeout: 15_000 });
    // ★장면 시작 마크는 정지 화면(연결 게이트) **앞**에 찍는다 — 클립이 여기서
    // 시작해 게이트를 한 박자 보여준 뒤 클릭으로 넘어간다.
    await hold(page, 400);
    mark("scene_connect_gate");
    await hold(page, 1600);
    await shot(page, "01-connect-gate");

    // ── 2. 원클릭 → 구독 선택 → 설치 시뮬 → 로그인 대본 → 승인 → 완료 ─────
    await page.getByTestId("beginner-oneclick-cta").click();
    const modal = page.getByTestId("beginner-oneclick-modal");
    await modal.waitFor({ state: "visible", timeout: 10_000 });
    mark("modal_open");
    await shot(page, "02-modal-open");

    const pick = page.getByTestId("beginner-subscription-pick");
    await pick.waitFor({ state: "visible", timeout: 15_000 });
    mark("choose_subscription");
    await hold(page, 1200);
    await page
      .getByTestId("beginner-subscription-claude")
      .locator("input")
      .click();
    await hold(page, 700);
    await shot(page, "03-subscription-picked");
    await page.getByTestId("beginner-subscription-confirm").click();
    mark("subscription_confirmed");

    await expect(modal).toHaveAttribute("data-phase", "awaiting_auth", {
      timeout: 30_000,
    });
    mark("login_terminal");
    await shot(page, "04-login-terminal");
    // 승인(시뮬 3.2s) 이 성립하는 순간 로그인 큐가 비어 터미널 블록은 곧장
    // 내려가고 모달은 "연결됐어요"(done) 로 바뀐다 — 대본의 마지막 "✓ Signed in"
    // 줄은 이 모달에서는 보이지 않는다(제품 동작). done 을 직접 기다린다.
    await expect(modal).toHaveAttribute("data-phase", "done", {
      timeout: 30_000,
    });
    mark("modal_done");
    await shot(page, "06-modal-done");
    await modal.waitFor({ state: "hidden", timeout: 15_000 });
    mark("modal_closed");

    // ── 3. 샘플 폴더 준비 중 → done(패스스루) → 진짜 대화 화면 ─────────────
    const folderGate = page.getByTestId("beginner-folder-gate");
    if (await folderGate.isVisible().catch(() => false)) {
      mark("folder_preparing");
      await shot(page, "07-folder-preparing");
    }
    await page
      .locator('[data-coach="beginner-chat"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    mark("chat_ready");
    // 클린룸의 실 자동기동은 가짜 `claude` 바이너리를 만나 곧 죽는다("세션 만료"
    // 문구). 대화창이 선 즉시 해치로 빈 오케 터미널을 세워 그 자리를 대신한다.
    await primeOrchestratorTerminal(page);
    await hold(page, 1800);
    await shot(page, "08-chat-ready");

    // ── 4. 첫 요청 — 하단 오케 대화창에 타이핑(사용자 입력) ─────────────────
    await echoToTerminal(cr, "\x1b[38;5;111m❯\x1b[0m ");
    await page.locator(".xterm").first().click();
    for (const ch of FIRST_REQUEST) {
      await page.keyboard.type(ch);
      await echoToTerminal(cr, ch);
      await hold(page, TYPE_MS);
    }
    await hold(page, 500);
    await page.keyboard.press("Enter");
    await echoToTerminal(cr, "\r\n");
    mark("first_request_sent");
    await page
      .getByTestId("beginner-live-strip")
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {});
    await hold(page, 3000);
    await shot(page, "09-first-request");
    mark("end");

    videoPath = (await page.video()?.path()) ?? null;
  } finally {
    await cr.close();
  }
  const closedAt = Date.now();

  // 영상은 close 시점에 완결된다. 인코딩 스크립트가 ffprobe 길이로
  // videoStart = closedAt - duration 을 역산해 마크를 절대 오프셋으로 옮긴다.
  let finalVideo: string | null = null;
  if (videoPath && fs.existsSync(videoPath)) {
    finalVideo = path.join(OUT_DIR, "raw.webm");
    fs.copyFileSync(videoPath, finalVideo);
  }
  fs.writeFileSync(
    path.join(OUT_DIR, "marks.json"),
    JSON.stringify(
      {
        launchedAt,
        closedAt,
        size: SIZE,
        video: finalVideo,
        cleanroomRoot: cr.root,
        firstRequest: FIRST_REQUEST,
        marks,
      },
      null,
      2,
    ),
  );
  // ── 화면 텍스트 기계 검사(프레임 육안 확인의 보조) ───────────────────────
  const scan = {
    placeholder: /\{[a-zA-Z_][a-zA-Z0-9_]*\}/,
    email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    // 토큰·키 비슷한 긴 문자열(sk-… / 32자 이상의 base64·hex 덩어리)
    secretish: /\b(sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9+/_-]{40,})\b/,
    homePath: /\/Users\/[^/\s]+/,
  };
  const hits: Array<{ shot: string; rule: string; sample: string }> = [];
  for (const [name, text] of Object.entries(textDumps)) {
    for (const [rule, re] of Object.entries(scan)) {
      const m = text.match(re);
      if (m) hits.push({ shot: name, rule, sample: m[0].slice(0, 80) });
    }
  }
  fs.writeFileSync(
    path.join(OUT_DIR, "text-scan.json"),
    JSON.stringify({ shots: Object.keys(textDumps), hits }, null, 2),
  );
  for (const [name, text] of Object.entries(textDumps)) {
    fs.writeFileSync(path.join(OUT_DIR, `text-${name}.txt`), text);
  }
  console.log(`[record] video=${finalVideo} marks=${marks.length} textHits=${hits.length}`);
  expect(finalVideo, "녹화 파일이 생성되지 않았다").toBeTruthy();
  expect(hits, `화면 텍스트에 금지 패턴: ${JSON.stringify(hits)}`).toEqual([]);
});
