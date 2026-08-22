// githubApp.ts 단위검증 — node --test (npm run test:github-app).
//
// ★여기서 증명하는 것:
//   1. 인가 판정 순서와 거부 코드 (설계 §3.2 3~6번)
//   2. **탈퇴 차단** — 멤버에서 빠지면 T+0 에 발급이 거부된다 (설계 §7.1)
//   3. **App 제거 차단** — GitHub 이 다른 installation/404 를 주면 거부된다
//   4. **크로스테넌트 차단** — gitRemoteUrl 을 남의 저장소로 바꿔도 거부된다
//   5. 토큰 다운스코프 검증 — 요청보다 넓은 토큰이 오면 버린다
//   6. state nonce 위조·만료 차단
//
// 값은 전부 더미다. 실제 GitHub App id·private key·토큰은 테스트에 넣지 않는다
// (RSA 키는 이 파일이 매 실행마다 즉석 생성한다).

import * as assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { test } from "node:test";

import {
  APP_JWT_TTL_SECONDS,
  buildAppJwt,
  buildAuditEntry,
  buildInstallUrl,
  evaluateInstallationTokenRequest,
  INSTALLATION_TOKEN_PERMISSIONS,
  normalizeInstallationId,
  normalizePrivateKeyPem,
  parseGitHubRepoSlug,
  planHasTeamCollab,
  repoSlugKey,
  signSetupState,
  TEAM_COLLAB_PLANS,
  verifyMintedToken,
  verifyRepoInstallationBinding,
  verifySetupState,
  type ProjectSnapshotForIssue,
} from "./githubApp";

// ── 픽스처 ──────────────────────────────────────────────────────────────────

const OWNER = "owner-uid";
const MEMBER = "member-uid";
const OUTSIDER = "outsider-uid";
const PROJECT_ID = "proj-1";
const INSTALLATION_ID = "12345678";

function project(
  over: Partial<ProjectSnapshotForIssue> = {}
): ProjectSnapshotForIssue {
  return {
    exists: true,
    ownerId: OWNER,
    members: [OWNER, MEMBER],
    githubInstallationId: INSTALLATION_ID,
    gitRemoteUrl: "https://github.com/acme/app.git",
    ...over,
  };
}

function issue(
  uid: string,
  over: Partial<ProjectSnapshotForIssue> = {},
  plan = "team"
) {
  return evaluateInstallationTokenRequest({
    uid,
    project: project(over),
    ownerPlan: plan,
  });
}

// ── 1. 슬러그 도출 ──────────────────────────────────────────────────────────

test("parseGitHubRepoSlug: 허용 형태를 전부 같은 슬러그로 도출한다", () => {
  for (const url of [
    "https://github.com/acme/app.git",
    "https://github.com/acme/app",
    "ssh://git@github.com/acme/app.git",
    "git@github.com:acme/app.git",
    "  https://github.com/acme/app  ",
  ]) {
    assert.deepEqual(
      parseGitHubRepoSlug(url),
      { owner: "acme", repo: "app" },
      url
    );
  }
});

test("parseGitHubRepoSlug: 자격증명이 박힌 레거시 URL 도 슬러그만 뽑는다", () => {
  // 구버전이 Firestore 에 백필한 토큰 URL(결함 B). 토큰을 owner 로 오독하면 안 된다.
  assert.deepEqual(
    parseGitHubRepoSlug("https://oauth2:ghu_dummy@github.com/acme/app.git"),
    { owner: "acme", repo: "app" }
  );
});

test("parseGitHubRepoSlug: github.com 이 아니거나 모양이 어긋나면 null", () => {
  for (const url of [
    "https://gitlab.com/acme/app.git",
    "https://github.com.evil.test/acme/app.git",
    "https://github.com/acme",
    "https://github.com/acme/app/extra",
    "https://github.com/../../etc/passwd",
    "file:///etc/passwd",
    "-upload-pack=touch /tmp/pwn",
    "",
    null,
    42,
  ]) {
    assert.equal(parseGitHubRepoSlug(url), null, String(url));
  }
});

test("repoSlugKey: 대소문자를 정규화한다", () => {
  assert.equal(repoSlugKey({ owner: "ACME", repo: "App" }), "acme/app");
});

test("normalizeInstallationId: 숫자/문자열만 받고 쓰레기는 null", () => {
  assert.equal(normalizeInstallationId(12345678), "12345678");
  assert.equal(normalizeInstallationId(" 12345678 "), "12345678");
  assert.equal(normalizeInstallationId("0"), null);
  assert.equal(normalizeInstallationId("12a"), null);
  assert.equal(normalizeInstallationId(""), null);
  assert.equal(normalizeInstallationId(null), null);
  assert.equal(normalizeInstallationId({}), null);
});

// ── 2. 인가 판정 ────────────────────────────────────────────────────────────

test("멤버·오너는 통과한다", () => {
  for (const uid of [OWNER, MEMBER]) {
    const d = issue(uid);
    assert.equal(d.ok, true, uid);
    if (d.ok) {
      assert.equal(d.installationId, INSTALLATION_ID);
      assert.deepEqual(d.slug, { owner: "acme", repo: "app" });
    }
  }
});

test("★탈퇴 차단: members 에서 빠지면 T+0 에 거부된다 (설계 §7.1)", () => {
  // 오너가 removeMember() → members: arrayRemove(uid). 캐시도 전파 지연도 없다 —
  // 발급 함수가 Admin SDK 로 문서를 직접 읽어 판정하기 때문이다.
  const d = evaluateInstallationTokenRequest({
    uid: MEMBER,
    project: project({ members: [OWNER] }),
    ownerPlan: "team",
  });
  assert.deepEqual(d, { ok: false, code: "not-a-member" });
});

test("★남은 프로젝트 존재 여부조차 알 수 없다 — 없는 프로젝트와 같은 코드", () => {
  const outsider = issue(OUTSIDER);
  const missing = evaluateInstallationTokenRequest({
    uid: MEMBER,
    project: project({ exists: false }),
    ownerPlan: "team",
  });
  assert.deepEqual(outsider, { ok: false, code: "not-a-member" });
  assert.deepEqual(missing, { ok: false, code: "not-a-member" });
});

test("★멤버십이 엔타이틀먼트보다 먼저 판정된다 (설치 유무 프로빙 차단)", () => {
  // 남이면 플랜·설치 상태와 무관하게 not-a-member 다. 순서가 뒤집히면
  // 거부 코드가 "그 프로젝트에 설치가 있는지" 를 흘리는 오라클이 된다.
  const d = evaluateInstallationTokenRequest({
    uid: OUTSIDER,
    project: project({ githubInstallationId: null }),
    ownerPlan: "free",
  });
  assert.deepEqual(d, { ok: false, code: "not-a-member" });
});

test("오너 플랜에 팀 협업이 없으면 거부 (유료 게이트 우회 차단)", () => {
  for (const plan of ["free", "pro", "", "unknown"]) {
    const d = issue(MEMBER, {}, plan);
    assert.deepEqual(d, { ok: false, code: "no-team-entitlement" }, plan);
  }
  for (const plan of TEAM_COLLAB_PLANS) {
    assert.equal(issue(MEMBER, {}, plan).ok, true, plan);
  }
});

test("planHasTeamCollab 은 planLimits.ts 의 hasTeamCollab 집합과 같다", () => {
  // ★MIRROR 계약 — v3/src/lib/planLimits.ts 에서 hasTeamCollab:true 인 플랜만.
  assert.deepEqual([...TEAM_COLLAB_PLANS], ["team", "team_plus", "enterprise"]);
  assert.equal(planHasTeamCollab("team"), true);
  assert.equal(planHasTeamCollab("pro"), false);
  assert.equal(planHasTeamCollab(null), false);
});

test("설치가 없으면 no-installation — 클라는 이걸 받고 device 경로로 간다", () => {
  for (const v of [null, undefined, "", "abc", 0]) {
    const d = issue(MEMBER, { githubInstallationId: v });
    assert.deepEqual(d, { ok: false, code: "no-installation" }, String(v));
  }
});

test("gitRemoteUrl 이 GitHub 이 아니면 no-repo-url", () => {
  const d = issue(MEMBER, { gitRemoteUrl: "https://gitlab.com/acme/app.git" });
  assert.deepEqual(d, { ok: false, code: "no-repo-url" });
});

// ── 3. GitHub 되묻기 — 크로스테넌트·App 제거 차단 ──────────────────────────

const SLUG = { owner: "acme", repo: "app" };

test("★installation id 가 일치할 때만 통과한다", () => {
  assert.deepEqual(
    verifyRepoInstallationBinding(
      { id: 12345678, account: { login: "acme" } },
      INSTALLATION_ID,
      SLUG
    ),
    { ok: true }
  );
});

test("★크로스테넌트: gitRemoteUrl 을 남의 저장소로 바꿔도 거부된다", () => {
  // 공격: 프로젝트 A 의 멤버가 A.gitRemoteUrl 을 victim/private 로 바꾼다.
  // GitHub 은 그 저장소의 **진짜** installation id(=피해자 것)를 돌려주므로
  // A 에 바인딩된 id 와 어긋나고, 거기서 끊긴다.
  assert.deepEqual(
    verifyRepoInstallationBinding(
      { id: 99999999, account: { login: "victim" } },
      INSTALLATION_ID,
      { owner: "victim", repo: "private" }
    ),
    { ok: false, reason: "installation-mismatch" }
  );
});

test("★계정이 슬러그 소유자와 다르면 거부 (이름 기반 다운스코프 보호)", () => {
  assert.deepEqual(
    verifyRepoInstallationBinding(
      { id: 12345678, account: { login: "other-org" } },
      INSTALLATION_ID,
      SLUG
    ),
    { ok: false, reason: "account-mismatch" }
  );
});

test("응답이 망가졌으면(=App 제거 후 빈 응답 등) 거부", () => {
  for (const bad of [
    null,
    undefined,
    { id: null },
    { id: 12345678, account: null },
    { id: 12345678, account: { login: 7 } },
  ]) {
    const r = verifyRepoInstallationBinding(
      bad as never,
      INSTALLATION_ID,
      SLUG
    );
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});

// ── 4. 발급 토큰 다운스코프 검증 ───────────────────────────────────────────

const OK_TOKEN = {
  token: "ghs_dummy_for_test_only",
  expires_at: "2026-08-21T12:00:00Z",
  permissions: { contents: "read", metadata: "read" },
  repositories: [{ full_name: "acme/app" }],
};

test("정상 응답은 통과하고 만료시각을 ms 로 준다", () => {
  const r = verifyMintedToken(OK_TOKEN, SLUG);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.minted.token, OK_TOKEN.token);
    assert.equal(r.minted.expiresAtMs, Date.parse(OK_TOKEN.expires_at));
  }
});

test("★요청보다 넓은 토큰이 오면 버린다 — 저장소가 2개면 거부", () => {
  const r = verifyMintedToken(
    {
      ...OK_TOKEN,
      repositories: [{ full_name: "acme/app" }, { full_name: "acme/other" }],
    },
    SLUG
  );
  assert.deepEqual(r, { ok: false, reason: "over-scoped-repos" });
});

test("★엉뚱한 저장소로 풀린 토큰은 버린다", () => {
  const r = verifyMintedToken(
    { ...OK_TOKEN, repositories: [{ full_name: "victim/private" }] },
    SLUG
  );
  assert.deepEqual(r, { ok: false, reason: "over-scoped-repos" });
});

test("★contents:write 나 그 밖의 권한이 섞이면 버린다 (v1 은 read 만)", () => {
  assert.deepEqual(
    verifyMintedToken(
      { ...OK_TOKEN, permissions: { contents: "write" } },
      SLUG
    ),
    { ok: false, reason: "over-scoped-permissions" }
  );
  assert.deepEqual(
    verifyMintedToken(
      {
        ...OK_TOKEN,
        permissions: { contents: "read", administration: "write" },
      },
      SLUG
    ),
    { ok: false, reason: "over-scoped-permissions" }
  );
  assert.deepEqual(verifyMintedToken({ ...OK_TOKEN, permissions: {} }, SLUG), {
    ok: false,
    reason: "over-scoped-permissions",
  });
});

test("요청 권한은 contents:read 하나뿐이다 (write 를 받지 않는다)", () => {
  assert.deepEqual({ ...INSTALLATION_TOKEN_PERMISSIONS }, { contents: "read" });
});

test("토큰/만료가 없으면 거부", () => {
  assert.deepEqual(verifyMintedToken({ ...OK_TOKEN, token: "" }, SLUG), {
    ok: false,
    reason: "no-token",
  });
  assert.deepEqual(
    verifyMintedToken({ ...OK_TOKEN, expires_at: "nope" }, SLUG),
    {
      ok: false,
      reason: "bad-expiry",
    }
  );
});

// ── 5. App JWT ──────────────────────────────────────────────────────────────

function testKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

test("buildAppJwt: RS256 서명이 검증되고 iat/exp 가 GitHub 상한 안이다", () => {
  const { publicKey, privateKey } = testKeyPair();
  const nowSec = 1_800_000_000;
  const jwt = buildAppJwt({
    appId: "1234567",
    privateKeyPem: privateKey,
    nowSec,
  });

  const [h, p, s] = jwt.split(".");
  assert.equal(
    crypto
      .createVerify("RSA-SHA256")
      .update(`${h}.${p}`)
      .verify(publicKey, new Uint8Array(Buffer.from(s, "base64url"))),
    true
  );

  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  assert.deepEqual(header, { alg: "RS256", typ: "JWT" });
  assert.equal(payload.iss, "1234567");
  assert.equal(payload.iat, nowSec - 60);
  assert.equal(payload.exp, nowSec + APP_JWT_TTL_SECONDS);
  assert.ok(payload.exp - payload.iat <= 600, "GitHub 상한 10분 초과 금지");
});

test("buildAppJwt: appId 가 숫자가 아니면 던진다", () => {
  const { privateKey } = testKeyPair();
  assert.throws(() =>
    buildAppJwt({ appId: "not-a-number", privateKeyPem: privateKey, nowSec: 1 })
  );
});

test("normalizePrivateKeyPem: \\n 이스케이프를 되돌리고 비 PEM 은 null", () => {
  const { privateKey } = testKeyPair();
  const escaped = privateKey.trim().split("\n").join("\\n");
  assert.equal(normalizePrivateKeyPem(escaped), `${privateKey.trim()}\n`);
  assert.equal(normalizePrivateKeyPem("not a key"), null);
  assert.equal(normalizePrivateKeyPem(""), null);
  assert.equal(normalizePrivateKeyPem(null), null);
});

// ── 6. 설치 콜백 state ─────────────────────────────────────────────────────

const SECRET = "dummy-setup-state-secret-for-tests";
const NOW = 1_755_000_000_000;

function state(
  over: Partial<Parameters<typeof signSetupState>[0]> = {}
): string {
  return signSetupState(
    {
      nonce: "nonce-1",
      uid: OWNER,
      projectId: PROJECT_ID,
      exp: NOW + 60_000,
      ...over,
    },
    SECRET
  );
}

test("state: 서명한 값은 그대로 검증된다", () => {
  const r = verifySetupState(state(), SECRET, NOW);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.payload.uid, OWNER);
    assert.equal(r.payload.projectId, PROJECT_ID);
    assert.equal(r.payload.nonce, "nonce-1");
  }
});

test("★state 위조 차단: 다른 시크릿·본문 변조는 bad-signature", () => {
  assert.deepEqual(verifySetupState(state(), "other-secret", NOW), {
    ok: false,
    reason: "bad-signature",
  });

  const [v, body, sig] = state().split(".");
  const tampered = Buffer.from(
    JSON.stringify({
      nonce: "nonce-1",
      uid: OUTSIDER,
      projectId: "victim-project",
      exp: NOW + 60_000,
    }),
    "utf8"
  ).toString("base64url");
  assert.equal(body !== tampered, true);
  assert.deepEqual(verifySetupState(`${v}.${tampered}.${sig}`, SECRET, NOW), {
    ok: false,
    reason: "bad-signature",
  });
});

test("state: 만료·형식오류는 거부", () => {
  assert.deepEqual(verifySetupState(state({ exp: NOW - 1 }), SECRET, NOW), {
    ok: false,
    reason: "expired",
  });
  for (const bad of ["", "junk", "v1.only-two", "v2.a.b", null, 7]) {
    assert.equal(verifySetupState(bad, SECRET, NOW).ok, false, String(bad));
  }
});

test("buildInstallUrl: state 를 인코딩해 붙인다 / slug 미설정은 던진다", () => {
  const url = buildInstallUrl("marblo", "v1.abc.def");
  assert.equal(
    url,
    "https://github.com/apps/marblo/installations/new?state=v1.abc.def"
  );
  assert.throws(() => buildInstallUrl("", "s"));
  assert.throws(() => buildInstallUrl("bad slug", "s"));
});

// ── 7. 감사 원장에 토큰이 들어갈 길이 없다 ─────────────────────────────────

test("★감사 항목에 토큰이 들어가지 않는다 (필드 자체가 없다)", () => {
  const entry = buildAuditEntry({
    uid: MEMBER,
    projectId: PROJECT_ID,
    slug: SLUG,
    installationId: INSTALLATION_ID,
    outcome: "issued",
    reason: null,
    nowMs: NOW,
  });
  assert.deepEqual(Object.keys(entry).sort(), [
    "at",
    "installationId",
    "outcome",
    "projectId",
    "reason",
    "repoSlug",
    "uid",
  ]);
  assert.equal(JSON.stringify(entry).includes("ghs_"), false);
});

// ── 8. ★접근 차단이 실제로 동작하는가 (설계 §7) ────────────────────────────
//
// "설계상 그렇다" 로 끝내지 않으려고, GitHub 응답 → 판정의 매핑을 그대로
// 태워 시간축 시나리오를 돌린다. index.ts 는 이 함수들의 결과를 따를 뿐
// 자체 판정을 하지 않으므로, 여기서 통과한 것이 곧 배포되는 동작이다.
//
// 라이브 GitHub 검증(실제 App 설치/제거)은 App 이 등록된 뒤에만 가능하다 —
// 이 티켓은 App 생성·설치를 하지 않는다. 런북: docs/github-app-registration-…

import {
  evaluateMintResponse,
  evaluateRepoInstallationLookup,
} from "./githubApp";

/** 정상 상태: 저장소가 이 installation 에 있다. */
const LOOKUP_OK = { id: 12345678, account: { login: "acme" } };

test("★평시: 저장소가 설치에 있으면 통과하고 토큰이 발급된다", () => {
  assert.deepEqual(
    evaluateRepoInstallationLookup(200, LOOKUP_OK, INSTALLATION_ID, SLUG),
    { ok: true }
  );
  const mint = evaluateMintResponse(201, OK_TOKEN, SLUG);
  assert.equal(mint.ok, true);
});

test("★오너가 App 을 제거하면 GitHub 이 404 → 그 즉시 발급이 끊긴다", () => {
  // GitHub 은 "제거됨" 과 "원래 없음" 을 구분해 주지 않는다. 우리도 구분하지
  // 않는다 — 결론이 같기 때문이다: 이 App 은 이 저장소를 못 연다.
  const r = evaluateRepoInstallationLookup(404, null, INSTALLATION_ID, SLUG);
  assert.deepEqual(r, { ok: false, reason: "repo-installation-404" });
});

test("★설치에서 저장소만 뺀 경우도 같은 404 경로로 끊긴다", () => {
  assert.equal(
    evaluateRepoInstallationLookup(404, { message: "Not Found" }, INSTALLATION_ID, SLUG)
      .ok,
    false
  );
});

test("★저장소가 org 로 이전되면 낡은 installation id 와 어긋나 끊긴다", () => {
  // 개인 계정 설치는 이전을 따라가지 않는다(설계 §8). 새 org 설치가 생기면
  // 그 id 는 프로젝트에 적힌 낡은 id 와 다르다.
  const r = evaluateRepoInstallationLookup(
    200,
    { id: 87654321, account: { login: "acme-org" } },
    INSTALLATION_ID,
    SLUG
  );
  assert.deepEqual(r, { ok: false, reason: "installation-mismatch" });
});

test("★App JWT 가 죽으면(키 회전 사고) 접근 허용으로 위장하지 않는다", () => {
  for (const status of [401, 403]) {
    assert.deepEqual(
      evaluateRepoInstallationLookup(status, null, INSTALLATION_ID, SLUG),
      { ok: false, reason: "app-unauthorized" }
    );
  }
});

test("★조회는 통과했지만 그 사이 설치가 지워지면 발급 단계에서 끊긴다", () => {
  // 조회 200 → (오너가 제거) → 발급 404. 경합에서도 토큰이 나오지 않는다.
  assert.deepEqual(evaluateMintResponse(404, null, SLUG), {
    ok: false,
    reason: "mint-404",
  });
  // 권한이 모자라면 422.
  assert.deepEqual(evaluateMintResponse(422, null, SLUG), {
    ok: false,
    reason: "mint-422",
  });
});

test("★201 이어도 요청보다 넓은 토큰이면 쓰지 않고 버린다", () => {
  const r = evaluateMintResponse(
    201,
    { ...OK_TOKEN, permissions: { contents: "write" } },
    SLUG
  );
  assert.deepEqual(r, { ok: false, reason: "over-scoped-permissions" });
});

test("★차단 시나리오 전체 — 멤버 제거 → 발급 거부, 이미 받은 토큰만 최대 60분", () => {
  // T-1: 멤버였다 → 통과
  assert.equal(issue(MEMBER).ok, true);
  // T+0: 오너가 removeMember → 다음 요청부터 거부. 네트워크 호출도 안 간다.
  const removed = evaluateInstallationTokenRequest({
    uid: MEMBER,
    project: project({ members: [OWNER] }),
    ownerPlan: "team",
  });
  assert.deepEqual(removed, { ok: false, code: "not-a-member" });
  // T+최대 60분: 이미 쥔 토큰의 만료. 갱신·refresh 경로가 없다는 것을
  // 발급 응답 계약이 보장한다(expires_at 만 있고 refresh_token 이 없다).
  const mint = evaluateMintResponse(201, OK_TOKEN, SLUG);
  assert.equal(mint.ok, true);
  if (mint.ok) {
    assert.equal("refreshToken" in mint.minted, false);
    assert.equal(Object.keys(mint.minted).sort().join(","), "expiresAtMs,token");
  }
});
