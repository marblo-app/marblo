/**
 * 벤더 키를 **평문으로 꺼내지 않고** 벤치 자식 프로세스에 넘기는 런처.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────
 * env-swap 벤더 키(UPSTAGE_API_KEY …)는 `~/.marblo/vendor-secrets.enc.json` 에
 * Electron `safeStorage`(macOS Keychain)로만 암호화돼 있다. 벤치 러너
 * (`run.ts`)는 순수 node 라 그 저장소를 **열 수 없다** — `vendor-secrets.ts` 의
 * 지연 require 가 electron 을 못 얻어 "저장소 사용 불가" 로 떨어진다.
 *
 * 그래서 이 파일만 Electron 런타임으로 뜬다. 하는 일은 셋뿐이다:
 *   1. app.whenReady() 뒤에 safeStorage 로 키를 복호화한다.
 *   2. 자식(벤치 러너)을 스폰하면서 **그 키를 env 로만** 넘긴다.
 *   3. 자식 종료코드를 그대로 물려주고 죽는다.
 *
 * ── 보안 규율 ────────────────────────────────────────────────────────────
 * ★평문은 **어디에도 찍지 않는다**. stdout/stderr/로그/argv 어느 쪽으로도 나가지
 * 않고, 오직 자식 프로세스의 env 로만 건너간다. 이 파일이 출력하는 것은 "그 키가
 * 있었는가"(불리언)와 자식 argv 뿐이다. argv 에 키를 실으면 `ps` 로 새므로
 * **절대 argv 로 넘기지 않는다.**
 *
 * ── 사용법 ───────────────────────────────────────────────────────────────
 *   npx electron dist-electron/scripts/bench/secret-launcher.js \
 *     --secret=UPSTAGE_API_KEY -- \
 *     node dist-electron/scripts/bench/run.js --harness=codex --model=solar-pro4 …
 */
import { spawn } from "child_process";
import { app } from "electron";
import { getVendorSecret } from "../../vendor-secrets";

interface LauncherArgs {
  secretKeys: string[];
  command: string;
  args: string[];
}

function parseArgs(argv: string[]): LauncherArgs {
  const secretKeys: string[] = [];
  let i = 0;
  for (; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "--") {
      i += 1;
      break;
    }
    if (a.startsWith("--secret=")) {
      secretKeys.push(a.slice("--secret=".length));
      continue;
    }
    throw new Error(`secret-launcher: 알 수 없는 인자 ${a}`);
  }
  const rest = argv.slice(i);
  if (rest.length === 0) {
    throw new Error(
      "secret-launcher: `--` 뒤에 실행할 명령이 없다. " +
        "예) --secret=UPSTAGE_API_KEY -- node dist-electron/scripts/bench/run.js …",
    );
  }
  return { secretKeys, command: rest[0]!, args: rest.slice(1) };
}

/**
 * ★앱 이름을 제품과 **똑같이** 맞춘다.
 *
 * macOS 의 safeStorage 는 키체인 서비스 이름을 `<app.name> Safe Storage` 로
 * 만든다. `electron <script.js>` 로 뜨면 app.name 이 기본값("Electron")이라
 * **다른 키체인 항목**을 열게 되고, 복호화가 조용히 실패한다(실측: "복호화
 * 실패(무시): UPSTAGE_API_KEY"). 제품이 쓰는 이름은 package.json 의 `name`
 * 이므로 그 값을 그대로 박는다.
 */
const APP_NAME = "marblo-v3";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  app.setName(process.env.MARBLO_SAFE_STORAGE_APP_NAME || APP_NAME);
  await app.whenReady();
  // 창을 띄우지 않는 헤드리스 런처다. 독 아이콘도 남기지 않는다.
  app.dock?.hide();

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of parsed.secretKeys) {
    const value = getVendorSecret(key);
    // ★불리언만 찍는다. 값은 로그에 절대 남기지 않는다.
    console.log(`[secret-launcher] ${key}: ${value ? "resolved" : "MISSING"}`);
    if (!value) {
      console.error(
        `[secret-launcher] ${key} 를 safeStorage 에서 못 읽었다. ` +
          "설정 > 벤더 키에 저장돼 있는지, 이 머신의 키체인 항목인지 확인할 것.",
      );
      app.exit(2);
      return;
    }
    env[key] = value;
  }

  console.log(
    `[secret-launcher] spawn: ${parsed.command} ${parsed.args.join(" ")}`,
  );
  const child = spawn(parsed.command, parsed.args, {
    env,
    stdio: "inherit",
  });
  child.on("error", (err) => {
    console.error(`[secret-launcher] spawn 실패: ${err.message}`);
    app.exit(1);
  });
  child.on("exit", (code, signal) => {
    console.log(`[secret-launcher] child exit code=${code} signal=${signal}`);
    app.exit(code ?? 1);
  });
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err);
  app.exit(1);
});
