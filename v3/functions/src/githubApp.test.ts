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
  evaluatePushRef,
  INSTALLATION_TOKEN_PERMISSIONS,
  INSTALLATION_TOKEN_PERMISSIONS_WRITE,
  negotiateInstallationAccess,
  normalizeMemberRole,
  normalizePushRef,
  parseDefaultBranch,
  resolveProjectRole,
  roleCanMerge,
  roleCanWriteRepo,
  normalizeInstallationId,
  normalizePrivateKeyPem,
  parseGitHubRepoSlug,
  planHasTeamCollab,
  repoSlugKey,
  signSetupState,
  TEAM_COLLAB_PLANS,
  TEAM_SEAT_ENTITLEMENTS,
  verifyMintedToken,
  verifyRepoInstallationBinding,
  verifySetupState,
  type ProjectRole,
  type ProjectSnapshotForIssue,
  type RepoAccess,
} from "./githubApp";

// ── 픽스처 ──────────────────────────────────────────────────────────────────

const OWNER = "owner-uid";
const MEMBER = "member-uid";
const OUTSIDER = "outsider-uid";
const PROJECT_ID = "proj-1";
const INSTALLATION_ID = "12345678";

function project(
  over: Partial<ProjectSnapshotForIssue> = {},
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
  plan = "team",
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
      url,
    );
  }
});

test("parseGitHubRepoSlug: 자격증명이 박힌 레거시 URL 도 슬러그만 뽑는다", () => {
  // 구버전이 Firestore 에 백필한 토큰 URL(결함 B). 토큰을 owner 로 오독하면 안 된다.
  assert.deepEqual(
    parseGitHubRepoSlug("https://oauth2:ghu_dummy@github.com/acme/app.git"),
    { owner: "acme", repo: "app" },
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

test("TEAM_SEAT_ENTITLEMENTS 는 planLimits.ts 의 좌석 정책과 같다", () => {
  // ★MIRROR 계약 — 좌석 수는 기능 불리언이 아니라 가격/초대 집행 단위다.
  assert.deepEqual(TEAM_SEAT_ENTITLEMENTS, {
    team: { includedSeats: 1, viewerConsumesSeat: false },
    team_plus: { includedSeats: 5, viewerConsumesSeat: false },
    enterprise: { includedSeats: Infinity, viewerConsumesSeat: false },
  });
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
      SLUG,
    ),
    { ok: true },
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
      { owner: "victim", repo: "private" },
    ),
    { ok: false, reason: "installation-mismatch" },
  );
});

test("★계정이 슬러그 소유자와 다르면 거부 (이름 기반 다운스코프 보호)", () => {
  assert.deepEqual(
    verifyRepoInstallationBinding(
      { id: 12345678, account: { login: "other-org" } },
      INSTALLATION_ID,
      SLUG,
    ),
    { ok: false, reason: "account-mismatch" },
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
      SLUG,
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
    SLUG,
  );
  assert.deepEqual(r, { ok: false, reason: "over-scoped-repos" });
});

test("★엉뚱한 저장소로 풀린 토큰은 버린다", () => {
  const r = verifyMintedToken(
    { ...OK_TOKEN, repositories: [{ full_name: "victim/private" }] },
    SLUG,
  );
  assert.deepEqual(r, { ok: false, reason: "over-scoped-repos" });
});

test("★contents:write 나 그 밖의 권한이 섞이면 버린다 (v1 은 read 만)", () => {
  assert.deepEqual(
    verifyMintedToken(
      { ...OK_TOKEN, permissions: { contents: "write" } },
      SLUG,
    ),
    { ok: false, reason: "over-scoped-permissions" },
  );
  assert.deepEqual(
    verifyMintedToken(
      {
        ...OK_TOKEN,
        permissions: { contents: "read", administration: "write" },
      },
      SLUG,
    ),
    { ok: false, reason: "over-scoped-permissions" },
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
    },
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
    true,
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
    buildAppJwt({
      appId: "not-a-number",
      privateKeyPem: privateKey,
      nowSec: 1,
    }),
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
  over: Partial<Parameters<typeof signSetupState>[0]> = {},
): string {
  return signSetupState(
    {
      nonce: "nonce-1",
      uid: OWNER,
      projectId: PROJECT_ID,
      exp: NOW + 60_000,
      ...over,
    },
    SECRET,
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
    "utf8",
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
    "https://github.com/apps/marblo/installations/new?state=v1.abc.def",
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
  // ★v2 가 role/access/branch 를 더했다("누가 밀었나" 의 답이 여기 남는다).
  //   ★token 은 여전히 **필드 자체가 없다** — 그게 이 테스트의 요지다.
  assert.deepEqual(Object.keys(entry).sort(), [
    "access",
    "at",
    "branch",
    "installationId",
    "outcome",
    "projectId",
    "reason",
    "repoSlug",
    "role",
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
  // v2: ok 응답이 설치 승인 권한을 함께 실어 온다(협상 입력). LOOKUP_OK 에는
  // permissions 가 없으므로 빈 맵 = "write 승인 없음" 으로 접힌다.
  assert.deepEqual(
    evaluateRepoInstallationLookup(200, LOOKUP_OK, INSTALLATION_ID, SLUG),
    { ok: true, permissions: {} },
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
    evaluateRepoInstallationLookup(
      404,
      { message: "Not Found" },
      INSTALLATION_ID,
      SLUG,
    ).ok,
    false,
  );
});

test("★저장소가 org 로 이전되면 낡은 installation id 와 어긋나 끊긴다", () => {
  // 개인 계정 설치는 이전을 따라가지 않는다(설계 §8). 새 org 설치가 생기면
  // 그 id 는 프로젝트에 적힌 낡은 id 와 다르다.
  const r = evaluateRepoInstallationLookup(
    200,
    { id: 87654321, account: { login: "acme-org" } },
    INSTALLATION_ID,
    SLUG,
  );
  assert.deepEqual(r, { ok: false, reason: "installation-mismatch" });
});

test("★App JWT 가 죽으면(키 회전 사고) 접근 허용으로 위장하지 않는다", () => {
  for (const status of [401, 403]) {
    assert.deepEqual(
      evaluateRepoInstallationLookup(status, null, INSTALLATION_ID, SLUG),
      { ok: false, reason: "app-unauthorized" },
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
    SLUG,
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
    assert.equal(
      Object.keys(mint.minted).sort().join(","),
      "expiresAtMs,token",
    );
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// v2 — contents:write · 역할 게이트 · 재승인 협상 (티켓 FYIyUuhJbv2cDVjgkRGf)
//
// ★여기서 증명하는 것:
//   1. 역할 모델이 마블로의 기존 판정과 **같다** (새 권한 개념을 안 만들었다)
//   2. viewer 는 write 토큰을 못 받는다 — 판정 순서까지
//   3. ★역할 회수가 T+0 에 먹힌다 (member → viewer 로 바꾸면 즉시 거부)
//   4. ★화면의 Merge 게이트와 토큰 게이트가 모순이 없다 (기본 브랜치)
//   5. ★재승인 전에는 v1(read) 로 동작한다 — 회귀 0
//   6. 발급 응답 권한 재검증이 write 요청에서도 정확히 동작한다
// ═════════════════════════════════════════════════════════════════════════════

const ADMIN = "admin-uid";
const VIEWER = "viewer-uid";

function projectWithRoles(
  over: Partial<ProjectSnapshotForIssue> = {},
): ProjectSnapshotForIssue {
  return project({ members: [OWNER, ADMIN, MEMBER, VIEWER], ...over });
}

function issueV2(
  uid: string,
  opts: {
    memberRole?: unknown;
    memberRoleDocumentExists?: boolean;
    requestedAccess?: RepoAccess;
    over?: Partial<ProjectSnapshotForIssue>;
    plan?: string;
  } = {},
) {
  return evaluateInstallationTokenRequest({
    uid,
    project: projectWithRoles(opts.over),
    ownerPlan: opts.plan ?? "team",
    memberRole: opts.memberRole,
    memberRoleDocumentExists: opts.memberRoleDocumentExists,
    requestedAccess: opts.requestedAccess,
  });
}

// ── v2-1. 역할 모델은 마블로의 기존 판정 그대로다 ───────────────────────────

test("v2 역할 모델: write=owner/admin/member, merge=owner/admin (MIRROR)", () => {
  // ★src/types/invitation.ts 의 ROLE_PERMISSIONS 와 같은 집합이어야 한다.
  //   owner/admin/member 에 'write', owner/admin 에만 'merge'.
  //   여기가 갈라지면 화면이 막는 것과 토큰이 막는 것이 달라진다.
  assert.deepEqual(
    (["owner", "admin", "member", "viewer"] as ProjectRole[]).map(
      roleCanWriteRepo,
    ),
    [true, true, true, false],
  );
  assert.deepEqual(
    (["owner", "admin", "member", "viewer"] as ProjectRole[]).map(roleCanMerge),
    [true, true, false, false],
  );
});

test("normalizeMemberRole: 문서가 없거나 모르는 값이면 member — 룰의 getMemberRole 과 같다", () => {
  assert.equal(normalizeMemberRole(undefined), "member");
  assert.equal(normalizeMemberRole(null), "member");
  assert.equal(normalizeMemberRole(""), "member");
  assert.equal(normalizeMemberRole("maintainer"), "member");
  assert.equal(normalizeMemberRole(42), "member");
  assert.equal(normalizeMemberRole(" ADMIN "), "admin");
  assert.equal(normalizeMemberRole("Viewer"), "viewer");
});

test("normalizeMemberRole: memberRoles 문서의 'owner' 로는 승격되지 않는다", () => {
  // ★멤버가 자기 역할 문서에 owner 를 써 넣어 승격하는 경로를 끊는다.
  //   owner 는 projects.ownerId 로만 된다(룰의 isProjectOwner 와 같다).
  assert.equal(normalizeMemberRole("owner"), "member");
});

test("resolveProjectRole: ownerId 가 역할 문서를 이긴다", () => {
  assert.equal(
    resolveProjectRole({
      uid: OWNER,
      project: projectWithRoles(),
      memberRole: "viewer",
    }),
    "owner",
  );
});

test("resolveProjectRole: 남이면 null — 역할도 알려주지 않는다", () => {
  assert.equal(
    resolveProjectRole({
      uid: OUTSIDER,
      project: projectWithRoles(),
      memberRole: "admin",
    }),
    null,
  );
  assert.equal(
    resolveProjectRole({
      uid: MEMBER,
      project: projectWithRoles({ exists: false }),
    }),
    null,
  );
});

// ── v2-2. viewer 는 write 토큰을 못 받는다 ──────────────────────────────────

test("★viewer 는 write 를 거부당한다 — read 는 v1 그대로 통과한다", () => {
  const denied = issueV2(VIEWER, {
    memberRole: "viewer",
    requestedAccess: "write",
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.ok === false && denied.code, "role-cannot-write");

  // 같은 사람이 clone(read)은 그대로 된다 — v1 기능을 뺏지 않는다.
  const allowed = issueV2(VIEWER, {
    memberRole: "viewer",
    requestedAccess: "read",
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.ok === true && allowed.access, "read");
  assert.equal(allowed.ok === true && allowed.role, "viewer");
});

test("member/admin/owner 는 write 를 받는다", () => {
  for (const [uid, role] of [
    [OWNER, undefined],
    [ADMIN, "admin"],
    [MEMBER, "member"],
  ] as const) {
    const d = issueV2(uid, { memberRole: role, requestedAccess: "write" });
    assert.equal(d.ok, true, `${uid} 는 write 를 받아야 한다`);
    assert.equal(d.ok === true && d.access, "write");
  }
});

// ── v2-2b. ★역할 문서가 **없는** 멤버 (티켓 uhkQrRBgeBRddWb6OeDa) ──────────
//
// 이게 이번 P1 의 실제 사고 모양이다. 초대 수락이 `invitation.role` 을 버려서
// 역할 문서 없는 멤버가 생겼고, 기본값 member 로 접혀 저장소 write 가 나갔다.
// 라이브 확인: 문서 없는 계정 → {"ok":true,"role":"member","access":"write"}.
//
// ★기본값은 지금도 member 다(백필 전에 viewer 로 뒤집으면 기존 멤버 전원이 push
//   를 잃는다). 이 테스트는 그 값을 **못 박아** 둔다 — 룰의 getMemberRole 과 함께
//   바꾸지 않고 한쪽만 뒤집는 변경이 여기서 깨진다.

test("★역할 문서 없음 × read/write — 기본값 member 로 접힌다 (룰과 같은 값)", () => {
  for (const missing of [undefined, null, ""] as const) {
    const read = issueV2(MEMBER, {
      memberRole: missing,
      requestedAccess: "read",
    });
    assert.equal(read.ok, true);
    assert.equal(read.ok === true && read.role, "member");
    assert.equal(read.ok === true && read.access, "read");

    const write = issueV2(MEMBER, {
      memberRole: missing,
      requestedAccess: "write",
    });
    assert.equal(write.ok, true, `memberRole=${String(missing)} 는 member 로 접힌다`);
    assert.equal(write.ok === true && write.role, "member");
    assert.equal(write.ok === true && write.access, "write");
  }
});

test("★role 없는 memberRoles 문서는 viewer로 fail-closed 된다", () => {
  const read = issueV2(MEMBER, {
    memberRole: undefined,
    memberRoleDocumentExists: true,
    requestedAccess: "read",
  });
  assert.equal(read.ok, true);
  assert.equal(read.ok === true && read.role, "viewer");

  const write = issueV2(MEMBER, {
    memberRole: undefined,
    memberRoleDocumentExists: true,
    requestedAccess: "write",
  });
  assert.equal(write.ok, false);
  assert.equal(write.ok === false && write.code, "role-cannot-write");
});

test("★역할 문서 없음 — 기본 브랜치는 못 민다 (member 와 같은 선)", () => {
  const d = evaluateInstallationTokenRequest({
    uid: MEMBER,
    project: projectWithRoles(),
    ownerPlan: "team",
    memberRole: undefined,
    requestedAccess: "write",
  });
  assert.equal(d.ok, true);
  assert.equal(d.ok === true && roleCanMerge(d.role), false);
});

test("★문서없음/viewer/member/admin × read·write 전수", () => {
  // 행: 역할 문서의 raw 값. 열: read 결과 / write 결과.
  const cases: Array<[unknown, string, boolean]> = [
    [undefined, "member", true], // 문서 없음 → 기본값
    ["viewer", "viewer", false],
    ["member", "member", true],
    ["admin", "admin", true],
  ];
  for (const [raw, expectedRole, canWrite] of cases) {
    const read = issueV2(MEMBER, { memberRole: raw, requestedAccess: "read" });
    assert.equal(read.ok, true, `${String(raw)} 는 read 를 받아야 한다`);
    assert.equal(read.ok === true && read.role, expectedRole);

    const write = issueV2(MEMBER, { memberRole: raw, requestedAccess: "write" });
    if (canWrite) {
      assert.equal(write.ok, true, `${String(raw)} 는 write 를 받아야 한다`);
      assert.equal(write.ok === true && write.access, "write");
    } else {
      assert.equal(write.ok, false, `${String(raw)} 는 write 를 거부당해야 한다`);
      assert.equal(write.ok === false && write.code, "role-cannot-write");
    }
  }
});

test("access 를 안 주면 read — v1 호출부가 그대로 동작한다", () => {
  const d = issueV2(MEMBER, { memberRole: "member" });
  assert.equal(d.ok === true && d.access, "read");
});

test("★판정 순서: 남이면 역할 거부가 아니라 not-a-member 다", () => {
  // 역할 거부가 멤버십 거부보다 먼저 나오면 "너는 멤버는 맞다" 가 새어
  // 프로젝트 존재를 프로빙하는 도구가 된다.
  const d = issueV2(OUTSIDER, {
    memberRole: "viewer",
    requestedAccess: "write",
  });
  assert.equal(d.ok === false && d.code, "not-a-member");
});

test("★판정 순서: 엔타이틀먼트가 역할보다 먼저다", () => {
  const d = issueV2(VIEWER, {
    memberRole: "viewer",
    requestedAccess: "write",
    plan: "free",
  });
  assert.equal(d.ok === false && d.code, "no-team-entitlement");
});

test("★판정 순서: 역할 거부가 설치 조회보다 먼저다 — 남의 저장소에 요청을 쏘지 않는다", () => {
  const d = issueV2(VIEWER, {
    memberRole: "viewer",
    requestedAccess: "write",
    over: { githubInstallationId: null },
  });
  assert.equal(d.ok === false && d.code, "role-cannot-write");
});

// ── v2-3. ★역할 회수가 T+0 에 먹힌다 ───────────────────────────────────────

test("★역할 회수: member → viewer 로 강등되면 다음 발급에서 즉시 write 거부", () => {
  const before = issueV2(MEMBER, {
    memberRole: "member",
    requestedAccess: "write",
  });
  assert.equal(before.ok, true);

  // 오너가 보드에서 역할을 viewer 로 내린 직후. 재로그인·캐시 만료를
  // 기다리지 않는다 — 판정이 매 요청마다 새로 읽은 역할로 이루어진다.
  const after = issueV2(MEMBER, {
    memberRole: "viewer",
    requestedAccess: "write",
  });
  assert.equal(after.ok === false && after.code, "role-cannot-write");
});

test("★멤버 제거: members 에서 빠지면 read 조차 T+0 에 거부 (v1 규율 유지)", () => {
  const after = issueV2(MEMBER, {
    memberRole: "member",
    requestedAccess: "write",
    over: { members: [OWNER, ADMIN, VIEWER] },
  });
  assert.equal(after.ok === false && after.code, "not-a-member");
});

// ── v2-4. ★기본 브랜치 게이트 — 화면의 Merge 와 모순이 없다 ────────────────

test("★member 는 기본 브랜치에 직접 밀 수 없다 (화면 Merge 게이트와 같은 선)", () => {
  const d = evaluatePushRef({
    role: "member",
    ref: "main",
    defaultBranch: "main",
  });
  assert.equal(d.ok === false && d.code, "default-branch-requires-merge-role");
});

test("member 도 피처 브랜치는 민다 — PR 을 올릴 수 있어야 제품이 성립한다", () => {
  const d = evaluatePushRef({
    role: "member",
    ref: "feature/login",
    defaultBranch: "main",
  });
  assert.equal(d.ok, true);
  assert.equal(d.ok === true && d.isDefaultBranch, false);
});

test("owner/admin 은 기본 브랜치에 민다", () => {
  for (const role of ["owner", "admin"] as ProjectRole[]) {
    const d = evaluatePushRef({ role, ref: "main", defaultBranch: "main" });
    assert.equal(d.ok, true, `${role} 는 기본 브랜치에 밀 수 있어야 한다`);
    assert.equal(d.ok === true && d.isDefaultBranch, true);
  }
});

test("기본 브랜치 판정은 이름 대소문자·refs/heads 접두사를 흡수한다", () => {
  const d = evaluatePushRef({
    role: "member",
    ref: "refs/heads/MAIN",
    defaultBranch: "main",
  });
  assert.equal(d.ok === false && d.code, "default-branch-requires-merge-role");
});

test("★기본 브랜치를 모르면 통과시키지 않는다 — 조회가 흔들릴 때 게이트가 열리면 안 된다", () => {
  const d = evaluatePushRef({
    role: "member",
    ref: "feature/x",
    defaultBranch: null,
  });
  assert.equal(d.ok === false && d.code, "unknown-default-branch");
});

test("normalizePushRef: git 이 거부하는 모양·옵션 주입을 전부 막는다", () => {
  for (const bad of [
    "",
    "   ",
    "-force",
    "--upload-pack=evil",
    "a b",
    "a..b",
    "a~1",
    "a^",
    "a:b",
    "a?",
    "a*",
    "a[1]",
    "a\\b",
    "a@{0}",
    "a.lock",
    "trailing.",
    "/leading",
    "trailing/",
    "with\nnewline",
    42,
    null,
  ]) {
    assert.equal(normalizePushRef(bad), null, `거부해야 한다: ${String(bad)}`);
  }
  assert.equal(normalizePushRef("feature/login"), "feature/login");
  assert.equal(normalizePushRef("refs/heads/feature/login"), "feature/login");
  assert.equal(normalizePushRef("  main  "), "main");
});

test("parseDefaultBranch: 모양이 어긋나면 null", () => {
  assert.equal(parseDefaultBranch({ default_branch: "trunk" }), "trunk");
  assert.equal(parseDefaultBranch({ default_branch: "  main  " }), "main");
  assert.equal(parseDefaultBranch({ default_branch: "" }), null);
  assert.equal(parseDefaultBranch({ default_branch: 7 }), null);
  assert.equal(parseDefaultBranch(null), null);
});

// ── v2-5. ★재승인 전에는 v1(read) 로 동작한다 — 회귀 0 ─────────────────────

test("★오너 재승인 전: write 요청이 read 로 강등되고 downgraded 로 표시된다", () => {
  // App 권한을 write 로 올려도 **기존 설치처**는 오너가 재승인하기 전까지
  // contents:read 그대로다. 그 상태에서 write 를 요청하면 GitHub 이 422 로
  // 발급 자체를 거절해 clone 까지 죽는다. 그래서 요청 전에 깎는다.
  const n = negotiateInstallationAccess("write", { contents: "read" });
  assert.equal(n.access, "read");
  assert.equal(n.downgraded, true);
  assert.deepEqual({ ...n.permissions }, { contents: "read" });
});

test("재승인 후: write 요청이 그대로 나간다", () => {
  const n = negotiateInstallationAccess("write", {
    contents: "write",
    pull_requests: "write",
    metadata: "read",
  });
  assert.equal(n.access, "write");
  assert.equal(n.downgraded, false);
  assert.deepEqual(
    { ...n.permissions },
    { contents: "write", pull_requests: "write" },
  );
});

test("pull_requests 가 승인 안 됐으면 그것만 빼고 write 로 간다", () => {
  const n = negotiateInstallationAccess("write", { contents: "write" });
  assert.equal(n.access, "write");
  assert.deepEqual({ ...n.permissions }, { contents: "write" });
});

test("read 요청은 설치가 write 를 줘도 read 만 받는다 — 다운스코프 유지", () => {
  const n = negotiateInstallationAccess("read", {
    contents: "write",
    pull_requests: "write",
  });
  assert.equal(n.access, "read");
  assert.equal(n.downgraded, false);
  assert.deepEqual({ ...n.permissions }, { contents: "read" });
});

test("evaluateRepoInstallationLookup 이 설치 승인 권한을 함께 돌려준다", () => {
  const r = evaluateRepoInstallationLookup(
    200,
    {
      id: Number(INSTALLATION_ID),
      account: { login: "acme" },
      permissions: { contents: "write", metadata: "read", junk: 7 },
    },
    INSTALLATION_ID,
    { owner: "acme", repo: "app" },
  );
  assert.equal(r.ok, true);
  // 문자열이 아닌 값은 버린다 — 모르는 모양은 "없다" 로 접혀 read 로 내려간다.
  assert.deepEqual(r.ok === true ? { ...r.permissions } : null, {
    contents: "write",
    metadata: "read",
  });
});

test("permissions 가 없는 응답은 빈 맵 — write 요청이 read 로 강등된다", () => {
  const r = evaluateRepoInstallationLookup(
    200,
    { id: Number(INSTALLATION_ID), account: { login: "acme" } },
    INSTALLATION_ID,
    { owner: "acme", repo: "app" },
  );
  assert.equal(r.ok, true);
  const n = negotiateInstallationAccess(
    "write",
    r.ok === true ? r.permissions : {},
  );
  assert.equal(n.downgraded, true);
});

// ── v2-6. 발급 응답 권한 재검증 (write 판) ──────────────────────────────────

const V2_SLUG = { owner: "acme", repo: "app" };
const OK_REPOS = [{ full_name: "acme/app" }];

function minted(permissions: Record<string, string>) {
  return {
    token: "ghs_dummy",
    expires_at: "2026-08-22T01:00:00Z",
    permissions,
    repositories: OK_REPOS,
  };
}

test("write 요청: 정확히 요청한 권한이면 통과한다", () => {
  const want = { contents: "write", pull_requests: "write" };
  const r = verifyMintedToken(
    minted({ ...want, metadata: "read" }),
    V2_SLUG,
    want,
  );
  assert.equal(r.ok, true);
});

test("★write 요청이어도 요청보다 넓으면 버린다 (admin 승격·미요청 권한)", () => {
  const want = { contents: "write" };
  assert.equal(
    verifyMintedToken(minted({ contents: "admin" }), V2_SLUG, want).ok,
    false,
  );
  assert.equal(
    verifyMintedToken(
      minted({ contents: "write", administration: "write" }),
      V2_SLUG,
      want,
    ).ok,
    false,
  );
});

test("★read 요청에 write 토큰이 오면 버린다 — 다운스코프가 한 방향으로만 샌다", () => {
  const r = verifyMintedToken(
    minted({ contents: "write" }),
    V2_SLUG,
    INSTALLATION_TOKEN_PERMISSIONS,
  );
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "over-scoped-permissions");
});

test("요청한 권한이 응답에 없으면 버린다 — 있다고 믿고 push 하지 않는다", () => {
  const r = verifyMintedToken(minted({ contents: "read" }), V2_SLUG, {
    contents: "write",
  });
  assert.equal(r.ok, false);
});

test("v1 호출부(기대권한 미지정)는 바이트 동일하게 동작한다", () => {
  assert.equal(
    verifyMintedToken(minted({ contents: "read" }), V2_SLUG).ok,
    true,
  );
  assert.equal(
    verifyMintedToken(minted({ contents: "write" }), V2_SLUG).ok,
    false,
  );
});

test("write 요청이어도 저장소는 여전히 1개로 다운스코프된다", () => {
  const want = { contents: "write" };
  const r = verifyMintedToken(
    {
      token: "ghs_dummy",
      expires_at: "2026-08-22T01:00:00Z",
      permissions: want,
      repositories: [{ full_name: "acme/app" }, { full_name: "acme/other" }],
    },
    V2_SLUG,
    want,
  );
  assert.equal(r.ok === false && r.reason, "over-scoped-repos");
});

test("evaluateMintResponse 가 기대권한을 그대로 넘긴다", () => {
  const want = { contents: "write", pull_requests: "write" };
  assert.equal(evaluateMintResponse(201, minted(want), V2_SLUG, want).ok, true);
  assert.equal(evaluateMintResponse(201, minted(want), V2_SLUG).ok, false);
  // 재승인 전이면 GitHub 이 422 를 준다 — 그것도 거부로 접힌다.
  assert.equal(evaluateMintResponse(422, null, V2_SLUG, want).ok, false);
});

// ── v2-7. 감사 원장 ─────────────────────────────────────────────────────────

test("★감사 원장에 role/access/branch 가 남고 token 은 여전히 없다", () => {
  const row = buildAuditEntry({
    uid: MEMBER,
    projectId: PROJECT_ID,
    slug: V2_SLUG,
    installationId: INSTALLATION_ID,
    outcome: "issued",
    reason: null,
    nowMs: 1_700_000_000_000,
    role: "member",
    access: "write",
    branch: "feature/login",
  });
  assert.equal(row.role, "member");
  assert.equal(row.access, "write");
  assert.equal(row.branch, "feature/login");
  // ★"누가 밀었나" 가 GitHub 에서 marblo[bot] 으로 뭉개지는 만큼, 그 답은
  //   여기 있어야 한다. 그리고 토큰은 타입에도 값에도 없어야 한다.
  assert.equal("token" in row, false);
  assert.deepEqual(Object.values(row).includes("ghs_dummy"), false);
});

test("v1 경로는 role/access/branch 가 null 로 남는다", () => {
  const row = buildAuditEntry({
    uid: MEMBER,
    projectId: PROJECT_ID,
    slug: V2_SLUG,
    installationId: INSTALLATION_ID,
    outcome: "denied",
    reason: "not-a-member",
    nowMs: 1,
  });
  assert.equal(row.role, null);
  assert.equal(row.access, null);
  assert.equal(row.branch, null);
});

// ── v2-8. 상수 ──────────────────────────────────────────────────────────────

test("write 권한 상수는 contents+pull_requests 뿐이다 — repo 전권으로 돌아가지 않는다", () => {
  assert.deepEqual(
    { ...INSTALLATION_TOKEN_PERMISSIONS_WRITE },
    { contents: "write", pull_requests: "write" },
  );
  // administration 은 영구 거부 후보다(등록값 문서 §1.1).
  assert.equal("administration" in INSTALLATION_TOKEN_PERMISSIONS_WRITE, false);
});

// ── v2-9. ★역할 회수 창(window) 실측 ────────────────────────────────────────
//
// "이미 발급된 토큰은 만료까지 산다" 는 창이 **얼마인지** 를 코드로 못박는다.
// 라이브 App 없이 측정 가능한 것은 셋이고, 그 셋이 창의 전부다:
//
//   (a) 발급 응답의 `expires_at` — GitHub 이 정하고 우리가 못 줄인다.
//       `POST /app/installations/{id}/access_tokens` 에 TTL 파라미터가 없다
//       (API 버전 2022-11-28). index.ts 의 요청 본문에도 없다.
//   (b) 우리가 그 토큰을 **저장하지 않는다** → 창을 늘리는 캐시가 없다.
//   (c) 역할 판정이 **매 발급마다** 새로 이루어진다 → 새 작업은 T+0 에 끊긴다.
//
// 결론(보고용): **잔여 노출 ≤ 60분, 저장소 1개, 그 시점 역할의 권한 한도 안.**
// 갱신 경로가 없다(응답에 refresh 토큰이 존재하지 않는다).

test("★실측: 발급 토큰의 잔여 수명 상한은 60분이다", () => {
  const issuedAtMs = Date.parse("2026-08-22T00:00:00Z");
  // GitHub 이 실제로 내려주는 모양 — 발급 시각 + 1시간.
  const response = {
    token: "ghs_dummy",
    expires_at: "2026-08-22T01:00:00Z",
    permissions: { contents: "write" },
    repositories: [{ full_name: "acme/app" }],
  };
  const r = verifyMintedToken(response, V2_SLUG, { contents: "write" });
  assert.equal(r.ok, true);
  const windowMs = r.ok === true ? r.minted.expiresAtMs - issuedAtMs : -1;
  assert.equal(windowMs, 60 * 60_000);
});

test("★실측: 만료 시각을 못 읽으면 토큰을 쓰지 않는다 — 창을 추측하지 않는다", () => {
  for (const bad of [undefined, null, "", "not-a-date", 12345]) {
    const r = verifyMintedToken(
      {
        token: "ghs_dummy",
        expires_at: bad,
        permissions: { contents: "read" },
        repositories: [{ full_name: "acme/app" }],
      },
      V2_SLUG,
    );
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, "bad-expiry");
  }
});

test("★역할 판정에 캐시가 없다 — 같은 입력 함수를 두 번 부르면 두 번 다 판정한다", () => {
  // 역할이 바뀌면 그 다음 호출이 곧바로 새 역할로 판정된다는 뜻이다.
  // (index.ts 도 요청마다 memberRoles 를 새로 읽는다 — 메모이즈하지 않는다.)
  const asMember = issueV2(MEMBER, {
    memberRole: "member",
    requestedAccess: "write",
  });
  const asViewer = issueV2(MEMBER, {
    memberRole: "viewer",
    requestedAccess: "write",
  });
  assert.equal(asMember.ok, true);
  assert.equal(asViewer.ok, false);
});
