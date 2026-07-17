// 파운더 미활성자 팔로업 리포트/발송 테스트 (티켓 WjGoowu1rjLH4K2PNIXb).
//
// 이 코드는 실사용자에게 메일을 보내는 경로다 — 오발송하면 outward-facing 사고.
// 그래서 로직 재구현이 아니라 COMPILED 모듈(lib/index.js)을 Firestore+Auth
// 에뮬레이터에 붙여 실제 doc/계정 전이를 검증한다(손 fixture 는 거짓 초록).
//
// 실행:
//   cd v3/functions && npm run test:followup
// ★ 에뮬레이터는 JDK 21+ 필요. 먼저 export JAVA_HOME=/opt/homebrew/opt/openjdk@21.
//
// 커버:
//   - classifyFounderActivation 순수 분류기 4버킷
//   - getFounderActivationReport: 선정 4명 → active1/sub_expired1/account_no_sub1/
//     no_account1, followupTargets{reactivate2,download1}. rejected/미부여 제외.
//   - sendFounderFollowupEmails dryRun(기본): eligible 3, sent 0, ★founders 에
//     founderFollowupSentAt 를 절대 쓰지 않음(발송 흔적 없음).
//   - 쿨다운: 최근 발송자 제외.
//   - 실발송 게이트: dryRun:false + confirm 누락 → failed-precondition throw.
//   - requireAdmin: 무인증 차단.

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.GCLOUD_PROJECT ||= "marblo-test";
process.env.ADMIN_UID = "admin-uid-test";
// ★ RESEND_API_KEY 는 반드시 미설정 — 실발송 방지(발송 함수가 스킵 반환).
delete process.env.RESEND_API_KEY;

const ADMIN_CTX = { auth: { uid: "admin-uid-test", token: {} } };

const admin = (await import("firebase-admin")).default;
const mod = await import("../lib/index.js");
const db = admin.firestore();

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

async function wipe() {
  for (const col of ["betatester50_waitlist", "founders", "subscriptions"]) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await admin
    .auth()
    .deleteUsers((await admin.auth().listUsers()).users.map((u) => u.uid));
}

const ts = (d) => admin.firestore.Timestamp.fromDate(d);
const DAY = 86400000;
const report = (ctx = ADMIN_CTX) => mod.getFounderActivationReport.run({}, ctx);
const followup = (data, ctx = ADMIN_CTX) =>
  mod.sendFounderFollowupEmails.run(data, ctx);

// ─── 시나리오 0: 순수 분류기 ────────────────────────────────────────
{
  const now = Date.now();
  const c = mod.classifyFounderActivation;
  check(
    c({
      hasAccount: true,
      subExists: true,
      subStatus: "active",
      subPeriodEndMs: now + DAY,
      nowMs: now,
    }) === "active",
    "classify: 계정+활성구독 → active",
  );
  check(
    c({
      hasAccount: true,
      subExists: true,
      subStatus: "canceled",
      subPeriodEndMs: now - DAY,
      nowMs: now,
    }) === "sub_expired",
    "classify: 계정+만료구독 → sub_expired",
  );
  check(
    c({
      hasAccount: true,
      subExists: false,
      subStatus: null,
      subPeriodEndMs: null,
      nowMs: now,
    }) === "account_no_sub",
    "classify: 계정+구독없음 → account_no_sub",
  );
  check(
    c({
      hasAccount: false,
      subExists: false,
      subStatus: null,
      subPeriodEndMs: null,
      nowMs: now,
    }) === "no_account",
    "classify: 계정없음 → no_account",
  );
  check(
    c({
      hasAccount: true,
      subExists: true,
      subStatus: "active",
      subPeriodEndMs: now - DAY,
      nowMs: now,
    }) === "sub_expired",
    "classify: active 지만 기간만료 → sub_expired",
  );
}

// ─── 시나리오 1: 리포트 4버킷 + 제외 규칙 ───────────────────────────
async function seedFour() {
  await wipe();
  const grantAt = ts(new Date(Date.now() - 3 * DAY));
  const betaEnd = ts(new Date(Date.now() + 20 * DAY));
  // A: active (계정 + 활성구독)
  await admin.auth().createUser({ uid: "uidA", email: "a@example.com" });
  await db.collection("founders").doc("a@example.com").set({
    email: "a@example.com",
    status: "selected",
    accessGrantedAt: grantAt,
    betaExpiresAt: betaEnd,
  });
  await db.collection("subscriptions").doc("uidA").set({
    status: "active",
    planType: "pro",
    paymentProvider: "founder_grant",
    currentPeriodEnd: betaEnd,
  });
  // B: sub_expired (계정 + 취소구독)
  await admin.auth().createUser({ uid: "uidB", email: "b@example.com" });
  await db.collection("founders").doc("b@example.com").set({
    email: "b@example.com",
    status: "selected",
    accessGrantedAt: grantAt,
    betaExpiresAt: betaEnd,
  });
  await db
    .collection("subscriptions")
    .doc("uidB")
    .set({
      status: "canceled",
      planType: "pro",
      paymentProvider: "founder_grant",
      currentPeriodEnd: ts(new Date(Date.now() - DAY)),
    });
  // C: account_no_sub (계정, 구독 doc 없음)
  await admin.auth().createUser({ uid: "uidC", email: "c@example.com" });
  await db.collection("founders").doc("c@example.com").set({
    email: "c@example.com",
    status: "selected",
    accessGrantedAt: grantAt,
    betaExpiresAt: betaEnd,
  });
  // D: no_account (계정 없음)
  await db.collection("founders").doc("d@example.com").set({
    email: "d@example.com",
    status: "selected",
    accessGrantedAt: grantAt,
    betaExpiresAt: betaEnd,
  });
  // E: rejected → 제외
  await db.collection("founders").doc("e@example.com").set({
    email: "e@example.com",
    status: "rejected",
    accessGrantedAt: grantAt,
  });
  // F: accessGrantedAt 없음 → 제외
  await db.collection("founders").doc("f@example.com").set({
    email: "f@example.com",
    status: "selected",
  });
}

{
  await seedFour();
  const r = await report();
  check(
    r.totalSelected === 4,
    `report.totalSelected=4 (got ${r.totalSelected})`,
  );
  check(r.active === 1, `report.active=1 (got ${r.active})`);
  check(r.inactive === 3, `report.inactive=3 (got ${r.inactive})`);
  check(
    r.bySegment.sub_expired === 1,
    `bySegment.sub_expired=1 (got ${r.bySegment.sub_expired})`,
  );
  check(
    r.bySegment.account_no_sub === 1,
    `bySegment.account_no_sub=1 (got ${r.bySegment.account_no_sub})`,
  );
  check(
    r.bySegment.no_account === 1,
    `bySegment.no_account=1 (got ${r.bySegment.no_account})`,
  );
  check(
    r.followupTargets.activated === 2,
    `followupTargets.activated=2 (got ${r.followupTargets.activated})`,
  );
  check(
    r.followupTargets.download === 1,
    `followupTargets.download=1 (got ${r.followupTargets.download})`,
  );
}

// ─── 시나리오 2: 기본 dryRun 발송 — ★download(④)만, ③ 제외, 흔적 무기록 ──
{
  await seedFour();
  const r = await followup({}); // dryRun 기본 true, segment 기본 "download"
  check(r.dryRun === true, "dryRun 기본값 true");
  check(r.segmentFilter === "download", "★기본 segment=download(④만)");
  // ★사장님 결정: 기본 발송 대상은 ④(no_account) 1건뿐. ③은 백필로 제외.
  check(r.eligibleTotal === 1, `기본 eligibleTotal=1 (got ${r.eligibleTotal})`);
  check(
    r.eligibleBySegment.download === 1,
    `eligible download=1 (got ${r.eligibleBySegment.download})`,
  );
  check(
    r.eligibleBySegment.activated === 0,
    `★기본 발송에서 ③(activated) 제외 → 0 (got ${r.eligibleBySegment.activated})`,
  );
  check(r.sent === 0, `dryRun sent=0 (got ${r.sent})`);
  // ★ dryRun 은 founders 에 발송 흔적을 절대 남기지 않아야 한다.
  const snap = await db.collection("founders").get();
  const anyStamped = snap.docs.some(
    (d) => d.data().founderFollowupSentAt != null,
  );
  check(!anyStamped, "dryRun: founderFollowupSentAt 미기록(발송 흔적 없음)");
}

// ─── 시나리오 3: segment 필터 (download / activated / all) ──────────
{
  await seedFour();
  const r = await followup({ segment: "download" });
  check(
    r.eligibleTotal === 1 && r.eligibleBySegment.download === 1,
    "segment=download → 1건만(④)",
  );
  // ③ activated 는 명시 opt-in 해야만 대상이 된다.
  const r2 = await followup({ segment: "activated" });
  check(
    r2.eligibleTotal === 2 &&
      r2.eligibleBySegment.activated === 2 &&
      r2.eligibleBySegment.download === 0,
    "segment=activated → 2건(③), download 미포함",
  );
  const r3 = await followup({ segment: "all" });
  check(
    r3.eligibleTotal === 3 &&
      r3.eligibleBySegment.download === 1 &&
      r3.eligibleBySegment.activated === 2,
    "segment=all → 3건(④+③)",
  );
}

// ─── 시나리오 4: 쿨다운 제외 ────────────────────────────────────────
{
  await seedFour();
  // C 를 방금 발송한 것으로 마킹 → 쿨다운(7일)에 걸려 제외돼야 한다.
  // 3건 전체를 보려면 segment:"all"(기본은 download 1건뿐).
  await db
    .collection("founders")
    .doc("c@example.com")
    .set({ founderFollowupSentAt: ts(new Date()) }, { merge: true });
  const r = await followup({ segment: "all" });
  check(r.eligibleTotal === 2, `쿨다운 후 eligible=2 (got ${r.eligibleTotal})`);
  check(
    r.skippedCooldown === 1,
    `skippedCooldown=1 (got ${r.skippedCooldown})`,
  );
  // cooldownDays=0 이면 쿨다운 무시 → 다시 3건.
  const r2 = await followup({ segment: "all", cooldownDays: 0 });
  check(
    r2.eligibleTotal === 3,
    `cooldownDays=0 → eligible=3 (got ${r2.eligibleTotal})`,
  );
}

// ─── 시나리오 5: 실발송 게이트 (confirm 누락) ───────────────────────
{
  await seedFour();
  let threw = false;
  try {
    await followup({ dryRun: false }); // confirm 없음
  } catch (e) {
    threw = e?.code === "failed-precondition";
  }
  check(
    threw,
    "dryRun:false + confirm 누락 → failed-precondition throw(오발송 차단)",
  );
  // 게이트에 막혔으니 발송 흔적도 없어야 한다.
  const snap = await db.collection("founders").get();
  const anyStamped = snap.docs.some(
    (d) => d.data().founderFollowupSentAt != null,
  );
  check(!anyStamped, "게이트 차단 시 발송 흔적 없음");
}

// ─── 시나리오 6: requireAdmin ───────────────────────────────────────
{
  let threw = false;
  try {
    await report({}); // auth 없음
  } catch (e) {
    threw =
      e?.code === "permission-denied" || e?.code === "failed-precondition";
  }
  check(threw, "getFounderActivationReport: 무인증 차단");
  let threw2 = false;
  try {
    await followup({}, {}); // auth 없음
  } catch (e) {
    threw2 =
      e?.code === "permission-denied" || e?.code === "failed-precondition";
  }
  check(threw2, "sendFounderFollowupEmails: 무인증 차단");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
