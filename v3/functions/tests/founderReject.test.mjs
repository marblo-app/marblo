// Unit tests for 파운더 반려 (markFounderRejected) + 대기자 중복제거
// (getFounderWaitlist). 티켓 shvL8qH9TPuk5LMebMrT.
//
// 이 코드는 프로덕션 파운더 grant 를 회수한다 — 실수하면 실제 유저의 베타 접근·Pro
// 구독이 날아간다. 그래서 로직 재구현이 아니라 COMPILED 모듈(lib/index.js)을
// Firestore 에뮬레이터에 붙여 실제 doc 전이를 검증한다.
//
// 실행:
//   cd v3/functions && npm run test:reject
// (test:reject 가 build → Firestore 에뮬레이터 기동 → 이 파일 실행까지 한다.)
// ★ 에뮬레이터는 JDK 21+ 필요(firebase-tools 15). 이 Mac 기본 java 는 1.8 이라
//   먼저 export JAVA_HOME=/opt/homebrew/opt/openjdk@21 후 실행할 것.
//
// 커버:
//   - waitlist 동일 이메일 중복 신청 전건 status=rejected
//   - founders/{email} status=rejected + betaExpiresAt 즉시 만료(grant 회수)
//   - founder_grant 구독 → status=canceled
//   - ★★실경로 "결제먼저→선정→반려": 유료 구독 active·provider·기간 전부 보존
//     (fixture 로 구독을 직접 쓰면 selected 경로의 stomp 가 재현 안 돼 거짓 초록)
//   - ★★실경로 "선정→반려→재선정": getMyFounderAccess 로 접근 실제 복구 단언
//     (어드민 UI 는 resetWindow 를 안 보냄 — 그 조건에서 검증)
//   - ★양방향 대칭(과교정 방지). 보존/회수·부여/미부여를 항상 같이 본다:
//     · 現役 유료(active/past_due) → 선정해도 보존, 반려해도 취소 안 함
//     · 해지·강등한 前결제자(billingKey 잔존) → 선정 시 Pro 정상 부여
//     · 무결제 grant / 레거시 stomp(founderGrant=true) → 반려 시 정상 회수
//   - getFounderWaitlist: 정규화 이메일 기준 1건 중복제거 + rejected 기본 제외
//   - requireAdmin: 무인증/비어드민 호출 차단(permission-denied)

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
// ★ Auth 에뮬레이터 필수. markFounderSelectedInternal 은 lookupUidByEmail
// (admin.auth().getUserByEmail) 로 uid 를 찾을 때만 upsertProSubscription 을
// 태운다. Auth 에뮬 없이 돌리면 uid=null → 구독 경로가 통째로 스킵돼서
// "결제먼저→선정→반려" 사고가 재현되지 않고 테스트가 거짓 초록이 된다.
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.GCLOUD_PROJECT ||= "marblo-test";
process.env.ADMIN_UID = "admin-uid-test";

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

// 실제 가입 계정을 만든다 — lookupUidByEmail 이 uid 를 찾아야 선정이
// upsertProSubscription 을 태우고, 그래야 실경로(결제↔선정 상호작용)가 재현된다.
async function createUser(uid, email) {
  await admin.auth().createUser({ uid, email });
  return uid;
}

// v1 onCall 은 CloudFunction.run(data, context) 로 핸들러를 직접 실행할 수 있다
// (firebase-functions-test 의 wrap() 이 내부적으로 쓰는 것과 같은 경로).
// 테스트 전용 의존성을 functions/package.json 에 넣으면 Cloud Build 의 `npm ci`
// 가 그 트리(jest 피어 등)까지 설치·검증해야 해서 배포가 깨진다 — 실제로 깨졌다.
// 배포 파이프라인을 테스트 때문에 위험하게 만들지 않으려고 .run() 을 쓴다.
const reject = (data, ctx) => mod.markFounderRejected.run(data, ctx);
const waitlist = (data, ctx) => mod.getFounderWaitlist.run(data, ctx);
const select = (data, ctx) => mod.markFounderSelected.run(data, ctx);
const grantOnSignup = (user) => mod.grantBetaProOnSignup.run(user);
// 앱이 실제로 베타 접근을 판정할 때 쓰는 게이트 — 복구 여부를 이걸로 단언한다.
const myAccess = (data, ctx) => mod.getMyFounderAccess.run(data, ctx);

const ts = (d) => admin.firestore.Timestamp.fromDate(d);
const DAY = 86400000;

// ─── 시나리오 1: 선정된 파운더 반려 → grant 회수 ────────────────────
{
  await wipe();
  const email = "dupe@example.com";
  // 동일인이 대소문자/공백 섞어 3번 신청 (클라가 직접 쓰므로 중복 방지 없음)
  await db.collection("betatester50_waitlist").add({
    email: "Dupe@Example.com",
    createdAt: ts(new Date(Date.now() - 2 * DAY)),
    source: "landing",
  });
  await db.collection("betatester50_waitlist").add({
    email: " DUPE@example.com ",
    createdAt: ts(new Date(Date.now() - 1 * DAY)),
    source: "landing",
  });
  await db
    .collection("betatester50_waitlist")
    .add({ email: "other@example.com", createdAt: ts(new Date()) });

  // 이미 선정된 상태 + Pro grant 구독 materialized
  await db
    .collection("founders")
    .doc(email)
    .set({
      email,
      status: "selected",
      accessGrantedAt: ts(new Date(Date.now() - DAY)),
      betaExpiresAt: ts(new Date(Date.now() + 30 * DAY)),
      proSubscriptionUid: "uid-granted",
    });
  await db.collection("subscriptions").doc("uid-granted").set({
    userId: "uid-granted",
    planType: "pro",
    status: "active",
    paymentProvider: "founder_grant",
    founderGrant: true,
  });

  const res = await reject({ email: "DUPE@Example.com " }, ADMIN_CTX);

  check(res.ok === true && res.email === email, "정규화된 이메일로 반려 응답");
  check(
    res.waitlistRejected === 2,
    `중복 신청 2건 모두 반려 (got ${res.waitlistRejected})`,
  );
  check(res.founderRevoked === true, "founders grant 회수됨");
  check(res.subscriptionRevoked === true, "founder_grant 구독 회수됨");

  const wl = await db.collection("betatester50_waitlist").get();
  const rejected = wl.docs.filter((d) => d.data().status === "rejected");
  check(rejected.length === 2, "waitlist 중복 2건 status=rejected");
  const untouched = wl.docs.find((d) => d.data().email === "other@example.com");
  check(untouched.data().status === undefined, "무관한 신청자는 안 건드림");

  const f = (await db.collection("founders").doc(email).get()).data();
  check(f.status === "rejected", "founders status=rejected");
  check(
    f.betaExpiresAt.toMillis() <= Date.now() + 5000,
    "betaExpiresAt 즉시 만료로 당겨짐",
  );

  const sub = (
    await db.collection("subscriptions").doc("uid-granted").get()
  ).data();
  check(sub.status === "canceled", "founder_grant 구독 status=canceled");
  check(
    sub.currentPeriodEnd.toMillis() <= Date.now() + 5000,
    "구독 기간도 즉시 만료",
  );
}

// ─── 시나리오 2: ★★실경로 — 결제먼저 → 선정 → 반려 (실결제 사고) ────
//
// 적대검증(PR#453)이 잡은 BLOCKER. fixture 로 subscriptions 를 직접 쓰면
// markFounderSelected 를 안 타서 stomp 가 안 일어나고 테스트가 거짓 초록이 된다.
// 여기서는 실제 유저를 만들고 markFounderSelected 를 진짜 호출해서
// "돈 내던 사람이 파운더로도 뽑혔다가 반려되는" 실제 순서를 재현한다.
{
  await wipe();
  const email = "payer-first@example.com";
  const uid = await createUser("uid-payer-first", email);
  await db
    .collection("betatester50_waitlist")
    .add({ email, createdAt: ts(new Date()) });

  // 이미 toss 로 결제 중인 유저 (남은 기간 30일)
  const paidEnd = new Date(Date.now() + 30 * DAY);
  await db
    .collection("subscriptions")
    .doc(uid)
    .set({
      userId: uid,
      planType: "pro",
      status: "active",
      paymentProvider: "toss",
      tossBillingKey: "REDACTED",
      currentPeriodEnd: ts(paidEnd),
    });

  const selectRes = await select({ email }, ADMIN_CTX);

  const afterSelect = (
    await db.collection("subscriptions").doc(uid).get()
  ).data();
  check(
    afterSelect.paymentProvider === "toss",
    "★선정이 유료 구독의 paymentProvider 를 stomp 하지 않음",
  );
  // 조용한 실패 금지: 현역 유료라 스킵한 것을 성공으로 보고하면 안 된다.
  check(
    selectRes.subscriptionGranted === false &&
      selectRes.subscriptionSkippedReason === "live_paid",
    "★현역 유료 스킵을 granted=false + skippedReason=live_paid 로 정직 보고",
  );
  check(
    afterSelect.founderGrant !== true,
    "★현역 유료 구독에 founderGrant 마커를 달지 않음(달면 재과금 정지)",
  );
  // billing.selectDueForCharge 는 paymentProvider!=="toss" 면 과금을 건너뛴다.
  // stomp 되면 이 유저는 영영 재과금되지 않는다(무료 영구) — 반려 이전의 사고.
  check(
    afterSelect.paymentProvider === "toss" && afterSelect.status === "active",
    "★선정 후에도 갱신크론(paymentProvider==toss) 대상 유지 = 재과금 살아있음",
  );

  const res = await reject({ email }, ADMIN_CTX);

  const afterReject = (
    await db.collection("subscriptions").doc(uid).get()
  ).data();
  check(
    afterReject.status === "active",
    "★★결제먼저→선정→반려: 유료 구독 active 유지(취소 금지)",
  );
  check(
    afterReject.paymentProvider === "toss",
    "★★반려 후에도 paymentProvider=toss 보존",
  );
  check(
    Math.abs(afterReject.currentPeriodEnd.toMillis() - paidEnd.getTime()) <
      5000,
    "★★남은 결제기간(30일) 절단되지 않음",
  );
  check(
    res.subscriptionRevoked === false,
    "유료 구독은 회수 대상 아님으로 보고",
  );
  check(
    (await db.collection("founders").doc(email).get()).data().status ===
      "rejected",
    "유료 유저라도 파운더 자격 자체는 반려됨",
  );
}

// ─── 시나리오 2b: 순수 grant 유저는 정상 회수 (선정 → 반려) ──────────
// 2 번 fix 가 "아무 구독도 안 건드림" 으로 과교정되지 않았는지 대칭 확인.
{
  await wipe();
  const email = "grant-only@example.com";
  const uid = await createUser("uid-grant-only", email);
  await db
    .collection("betatester50_waitlist")
    .add({ email, createdAt: ts(new Date()) });

  await select({ email }, ADMIN_CTX);
  const afterSelect = (
    await db.collection("subscriptions").doc(uid).get()
  ).data();
  check(
    afterSelect.paymentProvider === "founder_grant" &&
      afterSelect.status === "active",
    "무료 유저 선정 → founder_grant 구독 생성",
  );

  const res = await reject({ email }, ADMIN_CTX);
  const afterReject = (
    await db.collection("subscriptions").doc(uid).get()
  ).data();
  check(
    afterReject.status === "canceled",
    "선정→반려: founder_grant 구독은 정상 회수(canceled)",
  );
  check(res.subscriptionRevoked === true, "subscriptionRevoked=true 로 보고");
}

// ─── 시나리오 2c: ★해지/실효한 前결제자도 grant 를 정상 부여받는다 ────
//
// 재검증이 잡은 과교정 회귀. cancelTossSubscription 과 결제실패 강등은
// status 만 canceled/free 로 내리고 paymentProvider="toss" + tossBillingKey 를
// 남긴다. 결제 "흔적" 만 보고 유료 판정하면 이 사람들이 영구히 유료로 오판돼
// 파운더로 뽑혀도 Pro 를 못 받는다(= 조용한 미부여).
{
  const cases = [
    {
      label: "해지(cancelTossSubscription)",
      email: "ex-payer-canceled@example.com",
      uid: "uid-ex-canceled",
      sub: {
        planType: "pro",
        status: "canceled",
        paymentProvider: "toss",
        tossBillingKey: "REDACTED",
        canceledAt: ts(new Date(Date.now() - DAY)),
      },
    },
    {
      label: "결제실패 강등(free)",
      email: "ex-payer-downgraded@example.com",
      uid: "uid-ex-downgraded",
      sub: {
        planType: "free",
        status: "canceled",
        paymentProvider: "toss",
        tossBillingKey: "REDACTED",
        tossCustomerKey: "REDACTED",
      },
    },
  ];

  for (const c of cases) {
    await wipe();
    const uid = await createUser(c.uid, c.email);
    await db
      .collection("betatester50_waitlist")
      .add({ email: c.email, createdAt: ts(new Date()) });
    await db
      .collection("subscriptions")
      .doc(uid)
      .set({ userId: uid, ...c.sub });

    const res = await select({ email: c.email }, ADMIN_CTX);
    const after = (await db.collection("subscriptions").doc(uid).get()).data();

    check(
      after.status === "active" && after.planType === "pro",
      `★${c.label} 前결제자 → 선정 시 Pro 정상 부여(active)`,
    );
    check(
      after.founderGrant === true &&
        after.currentPeriodEnd.toMillis() > Date.now(),
      `★${c.label} → founder_grant 로 부여되고 기간 미래`,
    );
    // 조용한 실패 제거: 부여 여부를 정확히 보고해야 한다.
    check(
      res.subscriptionGranted === true,
      `★${c.label} → subscriptionGranted=true 로 정직 보고`,
    );
  }
}

// ─── 시나리오 2d: ★레거시 stomp doc 반려 시 무료 grant 회수 ───────────
//
// stomp 를 막기 전에 만들어진 doc: provider=founder_grant + founderGrant=true 인데
// 옛 tossBillingKey 가 merge 로 살아남아 있다. 결제 흔적만 보면 "유료" 로 오판해
// 무료 Pro 를 회수 못 한다 → founderGrant 마커를 authoritative 로 삼아야 한다.
{
  await wipe();
  const email = "legacy-stomp@example.com";
  const uid = await createUser("uid-legacy-stomp", email);
  await db
    .collection("betatester50_waitlist")
    .add({ email, createdAt: ts(new Date()) });
  await db
    .collection("founders")
    .doc(email)
    .set({
      email,
      status: "selected",
      accessGrantedAt: ts(new Date()),
      proSubscriptionUid: uid,
    });
  await db
    .collection("subscriptions")
    .doc(uid)
    .set({
      userId: uid,
      planType: "pro",
      status: "active",
      paymentProvider: "founder_grant",
      founderGrant: true,
      tossBillingKey: "REDACTED", // 과거 stomp 로 남은 흔적
      currentPeriodEnd: ts(new Date(Date.now() + 30 * DAY)),
    });

  const res = await reject({ email }, ADMIN_CTX);
  const after = (await db.collection("subscriptions").doc(uid).get()).data();
  check(
    after.status === "canceled",
    "★레거시 stomp(founderGrant=true) 반려 → 무료 grant 회수됨",
  );
  check(res.subscriptionRevoked === true, "레거시 stomp 회수 보고");
}

// ─── 시나리오 2e: ★선정 → 가입(onCreate) 도 Pro grant materialize ───────
{
  await wipe();
  const email = "selected-then-signup@example.com";
  await db
    .collection("betatester50_waitlist")
    .add({ email, createdAt: ts(new Date()) });

  const selected = await select({ email }, ADMIN_CTX);
  check(
    selected.subscriptionGranted === false && selected.subscriptionUid === null,
    "선정 시점 미가입이면 즉시 구독 부여는 스킵",
  );

  const uid = await createUser("uid-selected-then-signup", email);
  await grantOnSignup({ uid, email });

  const sub = (await db.collection("subscriptions").doc(uid).get()).data();
  check(
    sub.paymentProvider === "founder_grant" && sub.status === "active",
    "★★선정→가입: auth onCreate 가 founder_grant 구독 생성",
  );
  const founder = (await db.collection("founders").doc(email).get()).data();
  check(
    founder.proSubscriptionUid === uid,
    "선정→가입: founders doc 에 proSubscriptionUid 기록",
  );
}

// ─── 시나리오 2f: ★가입 → 선정(callable) 도 Pro grant materialize ───────
{
  await wipe();
  const email = "signup-then-selected@example.com";
  const uid = await createUser("uid-signup-then-selected", email);
  await db
    .collection("betatester50_waitlist")
    .add({ email, createdAt: ts(new Date()) });

  const res = await select({ email }, ADMIN_CTX);
  const sub = (await db.collection("subscriptions").doc(uid).get()).data();
  check(
    res.subscriptionGranted === true && res.subscriptionUid === uid,
    "★★가입→선정: callable 응답이 구독 부여를 정직 보고",
  );
  check(
    sub.paymentProvider === "founder_grant" && sub.status === "active",
    "★★가입→선정: founder_grant 구독 생성",
  );
}

// ─── 시나리오 2g: ★가입 트리거도 현역 유료 구독을 stomp 하지 않음 ───────
{
  await wipe();
  const email = "paid-selected-then-signup@example.com";
  const uid = await createUser("uid-paid-selected-then-signup", email);
  const paidEnd = new Date(Date.now() + 30 * DAY);
  await db.collection("founders").doc(email).set({
    email,
    status: "selected",
    accessGrantedAt: ts(new Date()),
    betaExpiresAt: ts(new Date(Date.now() + 30 * DAY)),
  });
  await db.collection("subscriptions").doc(uid).set({
    userId: uid,
    planType: "pro",
    status: "active",
    paymentProvider: "toss",
    tossBillingKey: "REDACTED",
    currentPeriodEnd: ts(paidEnd),
  });

  await grantOnSignup({ uid, email });

  const sub = (await db.collection("subscriptions").doc(uid).get()).data();
  const founder = (await db.collection("founders").doc(email).get()).data();
  check(
    sub.paymentProvider === "toss" && sub.founderGrant !== true,
    "★가입 트리거: 현역 유료 구독 paymentProvider/founderGrant 보존",
  );
  check(
    founder.proSubscriptionUid === undefined,
    "★가입 트리거: 유료 스킵을 proSubscriptionUid 로 기록하지 않음",
  );
}

// ─── 시나리오 2h: ★레거시 selected doc 의 누락된 betaExpiresAt 복구 ─────
{
  await wipe();
  const email = "legacy-missing-window@example.com";
  const uid = await createUser("uid-legacy-missing-window", email);
  await db.collection("founders").doc(email).set({
    email,
    status: "selected",
    accessGrantedAt: ts(new Date(Date.now() - DAY)),
  });

  await grantOnSignup({ uid, email });

  const sub = (await db.collection("subscriptions").doc(uid).get()).data();
  check(
    sub.paymentProvider === "founder_grant" &&
      sub.currentPeriodEnd.toMillis() > Date.now(),
    "★betaExpiresAt 누락 legacy 선정자도 accessGrantedAt+1개월로 grant 복구",
  );
}

// ─── 시나리오 3: getFounderWaitlist 중복제거 + rejected 제외 ─────────
{
  await wipe();
  await db.collection("betatester50_waitlist").add({
    email: "a@example.com",
    createdAt: ts(new Date(Date.now() - 3 * DAY)),
    source: "old",
  });
  await db.collection("betatester50_waitlist").add({
    email: "A@Example.com",
    createdAt: ts(new Date(Date.now() - 1 * DAY)),
    source: "new",
  });
  await db.collection("betatester50_waitlist").add({
    email: "b@example.com",
    createdAt: ts(new Date(Date.now() - 2 * DAY)),
  });

  const before = await waitlist({}, ADMIN_CTX);
  check(
    before.items.length === 2,
    `중복 접힘: 3신청 → 2건 (got ${before.items.length})`,
  );
  const a = before.items.find((i) => i.normalizedEmail === "a@example.com");
  check(a.source === "new", "중복 중 최신 신청이 대표 항목");
  check(a.duplicateCount === 2, "duplicateCount=2 로 중복 사실 노출");

  await reject({ email: "a@example.com" }, ADMIN_CTX);
  const after = await waitlist({}, ADMIN_CTX);
  check(after.items.length === 1, "반려 항목은 기본 목록서 제외");
  check(
    after.items[0].normalizedEmail === "b@example.com",
    "남은 건 미반려 신청자",
  );
  check(after.rejectedCount === 1, "rejectedCount 로 숨긴 수 보고");

  const incl = await waitlist({ includeRejected: true }, ADMIN_CTX);
  check(incl.items.length === 2, "includeRejected=true 면 반려 포함 조회");
}

// ─── 시나리오 4: requireAdmin 게이트 ────────────────────────────────
{
  await wipe();
  await db.collection("betatester50_waitlist").add({
    email: "victim@example.com",
    createdAt: ts(new Date()),
  });

  for (const [label, ctx] of [
    ["무인증", {}],
    ["비어드민", { auth: { uid: "not-admin", token: {} } }],
  ]) {
    let code = null;
    try {
      await reject({ email: "victim@example.com" }, ctx);
    } catch (e) {
      code = e.code;
    }
    check(
      code === "permission-denied",
      `${label} 반려 호출 차단 (got ${code})`,
    );
  }
  const wl = await db.collection("betatester50_waitlist").get();
  check(
    wl.docs[0].data().status === undefined,
    "차단된 호출은 doc 을 변경하지 않음",
  );

  let listCode = null;
  try {
    await waitlist({}, { auth: { uid: "not-admin", token: {} } });
  } catch (e) {
    listCode = e.code;
  }
  check(listCode === "permission-denied", "비어드민 목록 조회 차단");
}

// ─── 시나리오 5: 무회귀 — 반려 후 재선정하면 접근 복구 ──────────────
{
  await wipe();
  const email = "comeback@example.com";
  await db
    .collection("betatester50_waitlist")
    .add({ email, createdAt: ts(new Date()) });

  await reject({ email }, ADMIN_CTX);
  check(
    (await db.collection("founders").doc(email).get()).exists === false,
    "미선정자 반려는 founders doc 을 만들지 않음",
  );

  // markFounderSelected 무회귀: 반려됐던 이메일도 다시 선정 가능해야 한다.
  await select({ email }, ADMIN_CTX);
  const f = (await db.collection("founders").doc(email).get()).data();
  check(f.status === "selected", "재선정 시 status=selected 복구");
  check(
    f.betaExpiresAt.toMillis() > Date.now(),
    "재선정 시 betaExpiresAt 미래로 복구(접근 회복)",
  );
}

// ─── 시나리오 5b: ★실경로 — 선정 → 반려 → 재선정 (접근 복구) ─────────
//
// 적대검증이 잡은 HIGH. 어드민 UI 는 resetWindow 를 안 보낸다(기본 false).
// 이미 선정됐던(=founders doc 에 accessGrantedAt 있는) 사람을 반려하면
// betaExpiresAt=now(만료) 가 박히는데, 재선정 시 accessGrantedAt 이 이미
// 있다는 이유로 만료값을 그대로 유지하면 → UI 는 "선정됨" 초록배지인데
// 실제 접근은 만료 = 허위표시. 앱이 실제로 쓰는 게이트(getMyFounderAccess)로 단언.
{
  await wipe();
  const email = "reselect@example.com";
  const uid = await createUser("uid-reselect", email);
  const USER_CTX = { auth: { uid, token: { email } } };
  await db
    .collection("betatester50_waitlist")
    .add({ email, createdAt: ts(new Date()) });

  await select({ email }, ADMIN_CTX);
  const granted = await myAccess({}, USER_CTX);
  check(granted.hasAccess === true, "선정 → 접근 허용");

  await reject({ email }, ADMIN_CTX);
  const revoked = await myAccess({}, USER_CTX);
  check(
    revoked.hasAccess === false,
    "반려 → 접근 차단(getMyFounderAccess rejected 게이트)",
  );

  // 어드민 UI 와 동일하게 resetWindow 없이 재선정
  await select({ email }, ADMIN_CTX);
  const f = (await db.collection("founders").doc(email).get()).data();
  check(f.status === "selected", "재선정 → status=selected");
  check(
    f.betaExpiresAt.toMillis() > Date.now(),
    "★재선정 → betaExpiresAt 미래로 리셋(만료값 잔존 금지)",
  );
  const restored = await myAccess({}, USER_CTX);
  check(
    restored.hasAccess === true,
    "★★선정→반려→재선정: 접근 실제 복구(UI 초록배지와 일치)",
  );
  check(
    restored.betaExpiresAt && new Date(restored.betaExpiresAt) > new Date(),
    "★재선정 후 베타 만료일이 미래",
  );

  // 되돌림 대칭: 재선정하면 신청 doc 의 rejected 마킹도 풀려 기본 목록에 복귀.
  // 안 그러면 재선정된 사람이 "반려됨" 으로 계속 보여 되돌림이 반쪽이 된다.
  const backInList = await waitlist({}, ADMIN_CTX);
  check(
    backInList.items.some((i) => i.normalizedEmail === email),
    "★재선정 → 대기자 기본 목록에 복귀(rejected 마킹 해제)",
  );
  check(backInList.rejectedCount === 0, "재선정 후 반려 카운트 0");
}

await wipe();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
