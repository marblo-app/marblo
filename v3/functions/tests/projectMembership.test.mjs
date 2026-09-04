// updateProjectMembership 콜러블 — 좌석·플랜 강제와 역할 문서 보장 검증.
// 감사 F2 (PR #1378 §2.2), 티켓 d0x7NG8CIGmcQGBg16iy.
//
// 실행:
//   cd v3/functions && npm run test:membership
// (test:membership 이 build → Firestore 에뮬레이터 기동 → 이 파일 실행까지 한다.)
// ★ 에뮬레이터는 JDK 21+ 필요. 먼저 export JAVA_HOME=/opt/homebrew/opt/openjdk@21.
//
// ★왜 순수 단위테스트로 안 끝내는가: `planProjectMembershipChange` 의 판정은
//   `src/orgOnboarding.test.ts` 가 이미 고정한다. 여기서 확인해야 하는 건 그
//   판정이 **실제 Firestore 쓰기로 이어지는가**다 — 특히 "이 경로로 들어온
//   멤버에게 memberRoles 문서가 반드시 생긴다"(#1299 재발 방지)는 배치 쓰기가
//   실제로 두 문서를 함께 남길 때만 참이다. 판정만 봐서는 거짓 초록이 난다.
//
// 커버:
//   - 무료 플랜 오너: 멤버 추가 거부(failed-precondition) — 프로브 D 조건 ①
//   - 좌석 초과(team=1석): 멤버 추가 거부(resource-exhausted) — 프로브 D 조건 ②
//   - ★정상 경로(team_plus=5석): 추가 성공 + memberRoles 문서 생성
//   - viewer 는 좌석을 안 먹는다 — 좌석이 찬 team 에서도 viewer 추가 허용
//   - ★역할 문서 없는 레거시 멤버를 add 로 치유 — 좌석이 차 있어도 통과
//   - 비관리자 호출 거부 / admin 역할 부여는 owner 전용
//   - 제거: members 와 memberRoles 가 함께 사라진다 · 오너는 제거 불가
//   - 제거는 플랜 게이트를 받지 않는다(무료로 떨어진 팀이 정리에 갇히지 않는다)

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ||= "marblo-test";

const admin = (await import("firebase-admin")).default;
const mod = await import("../lib/index.js");

const db = admin.firestore();
const call = (data, ctx) => mod.updateProjectMembership.run(data, ctx);

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

/** 콜러블이 던진 HttpsError 의 code 를 돌려준다(성공하면 null). */
async function callCode(data, ctx) {
  try {
    await call(data, ctx);
    return null;
  } catch (err) {
    return err?.code ?? `unknown:${err?.message ?? err}`;
  }
}

const OWNER = "f2fn-owner";
const ADMIN = "f2fn-admin";
const FILLER = "f2fn-filler";
const TARGET = "f2fn-target";
const OUTSIDER = "f2fn-outsider";

const ctxOf = (uid) => ({ auth: { uid, token: {} } });

async function wipe() {
  for (const coll of ["projects", "memberRoles", "subscriptions", "invitations"]) {
    const snap = await db.collection(coll).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

/**
 * @param {{projectId: string, members: string[], plan: string|null, roles?: Record<string,string>}} spec
 */
async function seed(spec) {
  await db.collection("projects").doc(spec.projectId).set({
    name: spec.projectId,
    ownerId: OWNER,
    members: spec.members,
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });
  for (const [uid, role] of Object.entries(spec.roles ?? {})) {
    await db
      .collection("memberRoles")
      .doc(`${spec.projectId}_${uid}`)
      .set({ projectId: spec.projectId, userId: uid, role });
  }
  if (spec.plan) {
    await db.collection("subscriptions").doc(OWNER).set({
      userId: OWNER,
      planType: spec.plan,
      status: "active",
      currentPeriodEnd: admin.firestore.Timestamp.fromMillis(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
      ),
    });
  }
}

const members = async (p) =>
  (await db.collection("projects").doc(p).get()).get("members") ?? [];
const roleDoc = async (p, uid) =>
  (await db.collection("memberRoles").doc(`${p}_${uid}`).get());

// ── ① 무료 플랜: 멤버 추가 거부 (프로브 D 조건 ①) ─────────────────────────
{
  await wipe();
  const P = "f2fn-free";
  // 구독 문서 자체가 없다 — 무료 계정의 실제 모양.
  await seed({ projectId: P, members: [OWNER], plan: null });

  const code = await callCode(
    { projectId: P, userId: TARGET, action: "add", role: "member" },
    ctxOf(OWNER),
  );
  check(
    code === "failed-precondition",
    `무료 플랜 오너의 멤버 추가는 거부된다 (code=${code})`,
  );
  check(
    !(await members(P)).includes(TARGET),
    "거부된 추가는 members 를 바꾸지 않는다",
  );
  check(
    !(await roleDoc(P, TARGET)).exists,
    "거부된 추가는 memberRoles 문서를 남기지 않는다",
  );
}

// ── ② 좌석 초과(team = 1석): 멤버 추가 거부 (프로브 D 조건 ②) ──────────────
{
  await wipe();
  const P = "f2fn-overseat";
  // team 은 includedSeats = 1. 오너 1석 + 비 viewer 멤버 1석 = 이미 2석.
  await seed({
    projectId: P,
    members: [OWNER, FILLER],
    plan: "team",
    roles: { [FILLER]: "member" },
  });

  const code = await callCode(
    { projectId: P, userId: TARGET, action: "add", role: "member" },
    ctxOf(OWNER),
  );
  check(
    code === "resource-exhausted",
    `좌석 초과 상태의 멤버 추가는 거부된다 (code=${code})`,
  );
  check(
    !(await members(P)).includes(TARGET),
    "좌석 초과 거부는 members 를 바꾸지 않는다",
  );

  // viewer 는 좌석을 쓰지 않는다 — 같은 상태에서 허용되어야 한다(과교정 방지).
  const viewerCode = await callCode(
    { projectId: P, userId: TARGET, action: "add", role: "viewer" },
    ctxOf(OWNER),
  );
  check(
    viewerCode === null,
    `좌석이 차 있어도 viewer 추가는 허용된다 (code=${viewerCode})`,
  );
  check(
    (await roleDoc(P, TARGET)).get("role") === "viewer",
    "viewer 추가도 memberRoles 문서를 남긴다",
  );
}

// ── ③ ★정상 경로: 추가 성공 + memberRoles 문서 생성 ───────────────────────
{
  await wipe();
  const P = "f2fn-ok";
  await seed({ projectId: P, members: [OWNER], plan: "team_plus" });

  const res = await call(
    { projectId: P, userId: TARGET, action: "add", role: "member" },
    ctxOf(OWNER),
  );
  check(res?.ok === true && res.action === "add", "team_plus 오너의 추가는 성공한다");
  check((await members(P)).includes(TARGET), "members 에 대상이 들어간다");

  const rd = await roleDoc(P, TARGET);
  check(rd.exists, "★콜러블 경로로 들어온 멤버에게 memberRoles 문서가 생긴다");
  check(rd.get("role") === "member", `역할이 초대 값 그대로 못 박힌다 (${rd.get("role")})`);
  check(rd.get("projectId") === P && rd.get("userId") === TARGET, "역할 문서는 3필드 규약을 지킨다");
  check(
    Object.keys(rd.data()).sort().join(",") === "projectId,role,userId",
    "역할 문서에 확장 필드를 심지 않는다",
  );

  // 손상 role 이 와도 역할 문서는 반드시 생긴다(#1299 재발 방지).
  await call(
    { projectId: P, userId: OUTSIDER, action: "add", role: "superadmin" },
    ctxOf(OWNER),
  );
  check(
    (await roleDoc(P, OUTSIDER)).get("role") === "member",
    "★모르는 role 은 member 로 접히고, 문서 없는 멤버가 되지 않는다",
  );
}

// ── ④ ★역할 문서 없는 레거시 멤버 치유 — 좌석이 차 있어도 통과 ────────────
{
  await wipe();
  const P = "f2fn-heal";
  // 오너 + roleless 멤버(문서 없음 → member 로 접혀 이미 1석을 쓴다). team=1석.
  await seed({ projectId: P, members: [OWNER, TARGET], plan: "team" });
  check(!(await roleDoc(P, TARGET)).exists, "전제: 역할 문서 없는 레거시 멤버");

  const code = await callCode(
    { projectId: P, userId: TARGET, action: "add", role: "viewer" },
    ctxOf(OWNER),
  );
  check(
    code === null,
    `★이미 좌석을 쓰는 멤버의 역할 재고정은 좌석 검사를 다시 물지 않는다 (code=${code})`,
  );
  check(
    (await roleDoc(P, TARGET)).get("role") === "viewer",
    "★레거시 멤버에게 역할 문서가 생긴다 (member 기본값 접힘 해소)",
  );
}

// ── ⑤ 자격: 비관리자 거부 · admin 부여는 owner 전용 ────────────────────────
{
  await wipe();
  const P = "f2fn-authz";
  await seed({
    projectId: P,
    members: [OWNER, ADMIN, FILLER],
    plan: "team_plus",
    roles: { [ADMIN]: "admin", [FILLER]: "member" },
  });

  check(
    (await callCode(
      { projectId: P, userId: TARGET, action: "add", role: "member" },
      ctxOf(FILLER),
    )) === "permission-denied",
    "일반 멤버는 멤버십을 바꿀 수 없다",
  );
  check(
    (await callCode(
      { projectId: P, userId: TARGET, action: "add", role: "member" },
      ctxOf(OUTSIDER),
    )) === "permission-denied",
    "비멤버는 멤버십을 바꿀 수 없다 (존재 비노출과 같은 사유)",
  );
  check(
    (await callCode(
      { projectId: P, userId: TARGET, action: "add", role: "member" },
      {},
    )) === "unauthenticated",
    "미인증 호출은 거부된다",
  );
  check(
    (await callCode(
      { projectId: P, userId: TARGET, action: "add", role: "admin" },
      ctxOf(ADMIN),
    )) === "invalid-argument",
    "admin 역할 부여는 owner 전용이다 (초대 게이트와 같은 불변식)",
  );
  check(
    (await callCode(
      { projectId: P, userId: TARGET, action: "add", role: "admin" },
      ctxOf(OWNER),
    )) === null,
    "owner 는 admin 을 부여할 수 있다",
  );
  check(
    (await callCode({ projectId: P, userId: TARGET, action: "grant" }, ctxOf(OWNER))) ===
      "invalid-argument",
    "모르는 action 은 거부된다",
  );
}

// ── ⑥ 제거: members 와 memberRoles 가 함께 사라진다 · 오너는 제거 불가 ──────
{
  await wipe();
  const P = "f2fn-remove";
  await seed({
    projectId: P,
    members: [OWNER, ADMIN, FILLER],
    plan: "team_plus",
    roles: { [ADMIN]: "admin", [FILLER]: "member" },
  });

  const res = await call(
    { projectId: P, userId: FILLER, action: "remove" },
    ctxOf(ADMIN),
  );
  check(res?.ok === true && res.action === "remove", "admin 은 멤버를 제거할 수 있다");
  check(!(await members(P)).includes(FILLER), "members 에서 빠진다");
  check(
    !(await roleDoc(P, FILLER)).exists,
    "★역할 문서도 같은 배치로 사라진다 (반쪽 상태 없음)",
  );

  check(
    (await callCode({ projectId: P, userId: OWNER, action: "remove" }, ctxOf(ADMIN))) ===
      "failed-precondition",
    "오너는 members 에서 제거할 수 없다",
  );
  check((await members(P)).includes(OWNER), "거부 후에도 오너는 members 에 남는다");

  check(
    (await callCode({ projectId: P, userId: OUTSIDER, action: "remove" }, ctxOf(OWNER))) ===
      null,
    "비멤버 제거는 멱등 성공이다 (연타·재시도가 실패로 보이지 않는다)",
  );
}

// ── ⑦ 제거는 플랜 게이트를 받지 않는다 ─────────────────────────────────────
{
  await wipe();
  const P = "f2fn-remove-free";
  // 팀 플랜이 만료돼 무료로 떨어진 팀. 정리를 못 하면 좌석 초과에서 못 빠져나온다.
  await seed({
    projectId: P,
    members: [OWNER, FILLER],
    plan: null,
    roles: { [FILLER]: "member" },
  });

  const code = await callCode(
    { projectId: P, userId: FILLER, action: "remove" },
    ctxOf(OWNER),
  );
  check(code === null, `무료 플랜에서도 멤버 제거는 허용된다 (code=${code})`);
  check(!(await members(P)).includes(FILLER), "무료 플랜 제거가 실제로 반영된다");
}

await wipe();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
