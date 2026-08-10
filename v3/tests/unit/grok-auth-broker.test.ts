import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as nodeOs from "node:os";
import * as path from "node:path";
import {
  GrokAuthBroker,
  grokCredentialExpiryMs,
  installGrokCredentialCopy,
  isUsableGrokCredential,
  parseGrokCredentials,
  shouldPublishGrokCredential,
  unlinkLegacyGrokAuthSymlinks,
  writeGrokCredentialFile,
} from "../../electron/grok-auth-broker";

/**
 * grok 인증 지속성 — "에이전트 하나의 refresh 실패가 머신 전체 로그인을 삭제"를 막는다.
 *
 * ★회귀 대상(2026-08-10 grok 로그 실측으로 확정):
 *   종전 배선은 격리 GROK_HOME 의 auth.json 을 사용자 ~/.grok/auth.json 로 심링크했다.
 *   grok 은 그 심링크를 realpath 로 풀어 사용자 실파일을 잠그고 쓰고, refresh 가
 *   영구실패하면 **그 실파일을 지운다**:
 *     auth: cleared credentials ... disk_mutation="file deleted (no scopes left)"
 *     auth disk state: entry lost :: Ok → FileMissing
 *   2주간 6회 발생했고, 그때마다 사람이 `grok login` 을 다시 해야 했다.
 *
 * 그래서 이 파일이 고정하는 불변식은 둘이다:
 *   (1) 격리홈의 auth.json 은 **절대 심링크가 아니다**(사설 사본).
 *   (2) 에이전트 사본이 지워져도 사용자 파일은 **절대 지워지지 않는다**.
 */

/** 실제 grok auth.json 모양(스키마 실측). 값은 전부 더미다. */
function credential(options: {
  expiresAt: string;
  token?: string;
  scope?: string;
}): string {
  const scope =
    options.scope ?? "https://auth.x.ai::00000000-0000-4000-8000-000000000000";
  return JSON.stringify({
    [scope]: {
      key: options.token ?? "dummy-access-token",
      auth_mode: "Oidc",
      create_time: "2026-08-01T00:00:00Z",
      refresh_token: "dummy-refresh-token",
      expires_at: options.expiresAt,
      oidc_issuer: "https://auth.x.ai",
      oidc_client_id: "00000000-0000-4000-8000-000000000000",
    },
  });
}

describe("grok 크레덴셜 파싱·신선도", () => {
  it("스코프가 하나도 없으면 크레덴셜로 보지 않는다", () => {
    // grok 이 "no scopes left" 로 남기는 빈 껍데기. 이걸 사용자 파일로 발행하면
    // 그게 곧 로그아웃이므로 파싱 단계에서 막아야 한다.
    expect(parseGrokCredentials("{}")).toBeNull();
    expect(parseGrokCredentials("")).toBeNull();
    expect(parseGrokCredentials("not json")).toBeNull();
    expect(parseGrokCredentials("[]")).toBeNull();
  });

  it("access token 이 빈 스코프뿐이면 쓸 수 없는 크레덴셜이다", () => {
    const cred = parseGrokCredentials(
      credential({ expiresAt: "2026-09-01T00:00:00Z", token: "" })
    );
    expect(cred).not.toBeNull();
    expect(isUsableGrokCredential(cred!)).toBe(false);
  });

  it("신선도는 스코프들 중 가장 나중인 expires_at 이다", () => {
    const raw = JSON.stringify({
      "https://auth.x.ai::a": { key: "t", expires_at: "2026-08-01T00:00:00Z" },
      "https://auth.x.ai::b": { key: "t", expires_at: "2026-09-01T00:00:00Z" },
    });
    const cred = parseGrokCredentials(raw)!;
    expect(grokCredentialExpiryMs(cred)).toBe(
      Date.parse("2026-09-01T00:00:00Z")
    );
  });
});

describe("shouldPublishGrokCredential — 되돌려 발행할지 판단", () => {
  const older = credential({ expiresAt: "2026-08-01T00:00:00Z" });
  const newer = credential({ expiresAt: "2026-09-01T00:00:00Z" });

  it("refresh 로 만료가 더 나중이 됐으면 발행한다", () => {
    expect(shouldPublishGrokCredential(newer, older)).toBe(true);
  });

  it("더 오래된 것은 발행하지 않는다 (되감기 금지)", () => {
    expect(shouldPublishGrokCredential(older, newer)).toBe(false);
  });

  it("내용이 같으면 발행하지 않는다", () => {
    expect(shouldPublishGrokCredential(newer, newer)).toBe(false);
  });

  it("★빈 껍데기/깨진 파일은 절대 발행하지 않는다 — 로그아웃 전파 금지", () => {
    expect(shouldPublishGrokCredential("{}", newer)).toBe(false);
    expect(shouldPublishGrokCredential("", newer)).toBe(false);
    expect(shouldPublishGrokCredential("{bad json", newer)).toBe(false);
    expect(
      shouldPublishGrokCredential(
        credential({ expiresAt: "2026-09-01T00:00:00Z", token: "" }),
        newer
      )
    ).toBe(false);
  });

  it("원본이 없으면 에이전트 사본이 유일한 생존 크레덴셜이므로 발행한다", () => {
    expect(shouldPublishGrokCredential(newer, null)).toBe(true);
  });

  it("원본이 깨졌으면 멀쩡한 후보로 덮는다", () => {
    expect(shouldPublishGrokCredential(newer, "{}")).toBe(true);
  });
});

describe("파일 배치", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(nodeOs.tmpdir(), "marblo-grok-auth-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("크레덴셜 파일은 0600 으로 쓰인다", () => {
    const target = path.join(dir, "auth.json");
    writeGrokCredentialFile(
      target,
      credential({ expiresAt: "2026-09-01T00:00:00Z" })
    );
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  it("임시파일을 남기지 않는다 (원자적 rename)", () => {
    const target = path.join(dir, "auth.json");
    writeGrokCredentialFile(
      target,
      credential({ expiresAt: "2026-09-01T00:00:00Z" })
    );
    expect(fs.readdirSync(dir)).toEqual(["auth.json"]);
  });

  it("★사본은 심링크가 아니다 — 이것이 근본 수리다", () => {
    const source = path.join(dir, "source-auth.json");
    const target = path.join(dir, "home", "auth.json");
    fs.writeFileSync(source, credential({ expiresAt: "2026-09-01T00:00:00Z" }));

    expect(installGrokCredentialCopy(source, target)).toBe(true);
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(target, "utf-8")).toBe(
      fs.readFileSync(source, "utf-8")
    );
  });

  it("원본이 없거나 못 쓸 모양이면 아무것도 깔지 않는다", () => {
    const target = path.join(dir, "home", "auth.json");
    expect(
      installGrokCredentialCopy(path.join(dir, "missing.json"), target)
    ).toBe(false);
    expect(fs.existsSync(target)).toBe(false);

    const empty = path.join(dir, "empty.json");
    fs.writeFileSync(empty, "{}");
    expect(installGrokCredentialCopy(empty, target)).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe("레거시 심링크 일괄 해제", () => {
  let dir: string;
  let userAuth: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(nodeOs.tmpdir(), "marblo-grok-sweep-"));
    userAuth = path.join(dir, "user-auth.json");
    fs.writeFileSync(
      userAuth,
      credential({ expiresAt: "2026-09-01T00:00:00Z" })
    );
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("심링크만 끊고 사용자 실파일·홈·세션은 보존한다", () => {
    const linked = path.join(dir, "grok-home-linked");
    const copied = path.join(dir, "grok-home-copied");
    const foreign = path.join(dir, "codex-home-linked");
    for (const home of [linked, copied, foreign]) fs.mkdirSync(home);
    fs.mkdirSync(path.join(linked, "sessions"));
    fs.symlinkSync(userAuth, path.join(linked, "auth.json"));
    fs.writeFileSync(
      path.join(copied, "auth.json"),
      credential({ expiresAt: "2026-09-01T00:00:00Z" })
    );
    fs.symlinkSync(userAuth, path.join(foreign, "auth.json"));

    expect(unlinkLegacyGrokAuthSymlinks(dir)).toBe(1);

    // 심링크는 사라졌다.
    expect(fs.existsSync(path.join(linked, "auth.json"))).toBe(false);
    // ★사용자 실파일은 살아있다 — 링크만 끊었지 대상을 지운 게 아니다.
    expect(fs.existsSync(userAuth)).toBe(true);
    // 홈과 세션 기록은 보존된다(파괴적 삭제가 아니다).
    expect(fs.existsSync(path.join(linked, "sessions"))).toBe(true);
    // 실파일 사본은 건드리지 않는다.
    expect(fs.existsSync(path.join(copied, "auth.json"))).toBe(true);
    // grok 홈이 아닌 디렉터리는 범위 밖이다.
    expect(fs.lstatSync(path.join(foreign, "auth.json")).isSymbolicLink()).toBe(
      true
    );
  });
});

describe("GrokAuthBroker — write-back", () => {
  let dir: string;
  let source: string;
  let home: string;
  let broker: GrokAuthBroker;
  const agentId = `broker-test-${process.pid}`;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(nodeOs.tmpdir(), "marblo-grok-broker-"));
    source = path.join(dir, "user", "auth.json");
    home = path.join(dir, "grok-home-agent");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(source, credential({ expiresAt: "2026-08-01T00:00:00Z" }));
    broker = new GrokAuthBroker({ sourceAuth: source, pollIntervalMs: 50 });
  });
  afterEach(() => {
    broker.releaseAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("install 은 심링크가 아니라 사본을 깐다", () => {
    expect(broker.install(agentId, home)).toBe(true);
    const target = path.join(home, "auth.json");
    expect(fs.lstatSync(target).isSymbolicLink()).toBe(false);
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  it("종전 실행이 남긴 심링크를 먼저 끊고 사본으로 바꾼다 (마이그레이션)", () => {
    const target = path.join(home, "auth.json");
    fs.symlinkSync(source, target);

    broker.install(agentId, home);

    expect(fs.lstatSync(target).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(source)).toBe(true);
  });

  it("grok 이 refresh 에 성공하면 갱신본을 사용자 파일로 발행한다", () => {
    broker.install(agentId, home);
    // grok 이 자기 홈의 사본을 더 나중 만료로 갱신한 상황.
    fs.writeFileSync(
      path.join(home, "auth.json"),
      credential({ expiresAt: "2026-12-01T00:00:00Z" })
    );

    expect(broker.syncOnce(agentId)).toBe(true);

    const published = parseGrokCredentials(fs.readFileSync(source, "utf-8"))!;
    expect(grokCredentialExpiryMs(published)).toBe(
      Date.parse("2026-12-01T00:00:00Z")
    );
  });

  it("★에이전트 사본이 삭제돼도 사용자 로그인은 살아남는다 — 원래 버그의 회귀 테스트", () => {
    broker.install(agentId, home);
    const before = fs.readFileSync(source, "utf-8");

    // grok 의 permanent_failure 경로: 자기 크레덴셜 파일을 지운다.
    fs.unlinkSync(path.join(home, "auth.json"));

    expect(broker.syncOnce(agentId)).toBe(false);
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.readFileSync(source, "utf-8")).toBe(before);
  });

  it("★grok 이 realpath 를 지우는 실제 동작을 그대로 재현해도 사용자 로그인은 무사하다", () => {
    // ★이 테스트가 진짜 회귀 가드다.
    //
    // grok 은 auth.json 을 **realpath 로 풀어** 잠그고 쓰고 지운다(로그 실측:
    // 격리홈에서 실행했는데 resolved_path 가 ~/.grok/auth.json 이었고,
    // disk_mutation="file deleted (no scopes left)" 로 그 실파일이 사라졌다).
    //
    // 종전 심링크 배선에서는 realpath 가 사용자 파일을 가리켰으므로 아래 삭제가
    // 곧 머신 전체 로그아웃이었다. 사본 배선에서는 realpath 가 격리홈 자기
    // 파일이라 사용자 파일에 닿지 않는다.
    broker.install(agentId, home);
    const target = path.join(home, "auth.json");

    const resolved = fs.realpathSync(target);
    expect(resolved).not.toBe(fs.realpathSync(source));
    fs.unlinkSync(resolved); // grok 의 "cleared credentials" 를 그대로 흉내

    expect(fs.existsSync(source)).toBe(true);
    expect(broker.syncOnce(agentId)).toBe(false);
    expect(fs.existsSync(source)).toBe(true);
  });

  it("에이전트가 빈 껍데기를 남겨도 사용자 파일을 덮지 않는다", () => {
    broker.install(agentId, home);
    const before = fs.readFileSync(source, "utf-8");

    fs.writeFileSync(path.join(home, "auth.json"), "{}");

    expect(broker.syncOnce(agentId)).toBe(false);
    expect(fs.readFileSync(source, "utf-8")).toBe(before);
  });

  it("release 후에는 더 이상 발행하지 않는다", () => {
    broker.install(agentId, home);
    broker.release(agentId);
    fs.writeFileSync(
      path.join(home, "auth.json"),
      credential({ expiresAt: "2026-12-01T00:00:00Z" })
    );
    expect(broker.syncOnce(agentId)).toBe(false);
  });
});
