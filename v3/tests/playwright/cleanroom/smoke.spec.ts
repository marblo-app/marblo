import { test, expect } from "@playwright/test";
import { launchCleanRoom, passFirstRunModals } from "./helpers/cleanroom";

/**
 * 클린룸 하네스 자체의 자가검증 — 격리(userData/HOME/PATH)와 IPC 스텁이
 * 실제로 먹히는지. 이게 깨지면 아래 시나리오 결과는 전부 무의미하다.
 */
test("@cleanroom 하네스 자가검증: 격리 + 스텁이 동작한다", async () => {
  const cr = await launchCleanRoom({ codex: "ready" });
  try {
    const passed = await passFirstRunModals(cr.page);
    console.log("[cleanroom] first-run modals:", passed);

    // userData 가 임시 경로인가 (실제 사용자 프로필 미오염).
    const paths = await cr.app.evaluate(({ app }) => ({
      userData: app.getPath("userData"),
      home: app.getPath("home"),
      envHome: process.env.HOME,
      envPath: process.env.PATH,
    }));
    console.log("[cleanroom] paths:", paths);
    expect(paths.userData).toContain("marblo-cleanroom-");
    expect(paths.envHome).toContain("marblo-cleanroom-");

    // 스텁된 probe 가 시나리오대로 답하는가.
    const probe = await cr.page.evaluate(() =>
      window.electronAPI.harness.cliAuthCheck("codex"),
    );
    expect(probe).toMatchObject({ installed: true, authenticated: true });

    // ★ 관측(F1): 스텁을 우회한 진짜 probe 는 클린룸을 지키는가?
    const real = {
      claude: await cr.realProbe("claude"),
      codex: await cr.realProbe("codex"),
    };
    console.log("[cleanroom] REAL probe (isolation leak check):", real);

    await cr.shot("smoke-boot");
  } finally {
    await cr.close();
  }
});
