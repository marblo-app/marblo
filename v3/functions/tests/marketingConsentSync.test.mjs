// 가입 시 마케팅 동의 → marketing_contacts 발송 게이트 배선 테스트 (티켓 5oQkQL8b).
//
// 이 경로는 "동의하지 않은 사람에게 마케팅 메일이 나가는가"를 결정한다 —
// 틀리면 PIPA 위반이자 outward-facing 사고다. 그래서 손 fixture 로 로직을
// 재구현하지 않고, COMPILED 모듈(lib/index.js)의 실제 훅을 Firestore+Auth
// 에뮬레이터에 붙여 실제 문서 전이를 검증한다(손 fake 는 거짓 초록).
//
// 실행:
//   cd v3/functions && npm run test:consent-sync
// ★ 에뮬레이터는 JDK 21+ 필요. 먼저 export JAVA_HOME=/opt/homebrew/opt/openjdk@21.
//
// 커버:
//   - 동의 체크 → granted(explicit_opt_in) → isEmailable=true
//   - 미체크 → 승격 없음(unknown) → isEmailable=false
//   - ★순서 무관: saveConsent 가 auth onCreate 보다 먼저여도/나중이어도 granted 수렴
//   - 철회(true→false) → revoked → isEmailable=false
//   - ★철회 우선: 수신거부한 컨택트는 재동의해도 발송 불가
//   - 에이전트 custom-token 계정 제외
//   - waitlist 경로 무영향(pending 유지)
//   - consent_events 감사 기록 + 멱등(같은 write 반복해도 중복 이벤트 없음)

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.GCLOUD_PROJECT ||= "marblo-test";
// 컨택트 암호화/수신거부 토큰이 운영과 같은 코드경로를 타도록 테스트 전용 값 주입.
process.env.MARKETING_EMAIL_ENC_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.MARKETING_UNSUB_SECRET ||= "test-unsub-secret";
// ★실발송 방지 — 발송 함수가 존재해도 키 없이는 스킵된다.
delete process.env.RESEND_API_KEY;

const admin = (await import("firebase-admin")).default;
const { createHash } = await import("node:crypto");
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

const contactIdOf = (email) =>
  createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");

const contactOf = async (email) => {
  const snap = await db
    .collection("marketing_contacts")
    .doc(contactIdOf(email))
    .get();
  return snap.exists ? snap.data() : null;
};

const consentEventsOf = async (email) => {
  const snap = await db
    .collection("marketing_contacts")
    .doc(contactIdOf(email))
    .collection("consent_events")
    .get();
  return snap.docs.map((d) => d.data());
};

async function wipe() {
  for (const col of ["marketing_contacts", "users", "betatester50_waitlist"]) {
    const snap = await db.collection(col).get();
    await Promise.all(
      snap.docs.map(async (d) => {
        const sub = await d.ref.collection("consent_events").get();
        await Promise.all(sub.docs.map((s) => s.ref.delete()));
        await d.ref.delete();
      }),
    );
  }
  const users = await admin.auth().listUsers();
  if (users.users.length) {
    await admin.auth().deleteUsers(users.users.map((u) => u.uid));
  }
}

// ─── 훅 구동 헬퍼 ──────────────────────────────────────────────────
// v1 CloudFunction 은 .run(data, context) 으로 핸들러를 직접 실행할 수 있다.
// Firestore 트리거의 data 는 Change — before/after 스냅샷은 손으로 만들지 않고
// 에뮬레이터에서 실제로 읽어온 admin DocumentSnapshot 을 쓴다.
const authCreate = (user) => mod.syncMarketingContactOnAuthCreate.run(user);

async function writeUserConsent(uid, consentPatch) {
  const ref = db.collection("users").doc(uid);
  const before = await ref.get();
  await ref.set({ webPrivacyConsent: consentPatch }, { merge: true });
  const after = await ref.get();
  return mod.syncMarketingConsentOnUserWrite.run(
    { before, after },
    { params: { uid } },
  );
}

const consentDoc = (marketing, version = "2026-07-14") => ({
  collectionUse: true,
  overseasTransfer: true,
  marketing,
  version,
  locale: "ko",
  acceptedAt: admin.firestore.Timestamp.now(),
});

// 실가입 계정(providerData 에 password) 을 에뮬레이터에 실제로 만든다.
async function createSignupUser(email) {
  const user = await admin
    .auth()
    .createUser({ email, password: "test-pw-1234" });
  return admin.auth().getUser(user.uid); // providerData 채워진 레코드
}

// ─── 시나리오 1: 동의 체크 → granted → 발송 가능 ─────────────────────
console.log(
  "\n[1] 가입 시 마케팅 동의 체크 (auth onCreate → saveConsent 순서)",
);
await wipe();
{
  const email = "opted.in@example.com";
  const user = await createSignupUser(email);
  await authCreate(user); // 훅이 먼저 — 동의 정보 없이 컨택트 생성

  const beforeConsent = await contactOf(email);
  check(
    beforeConsent?.emailMarketingConsent?.status === "unknown",
    "auth onCreate 단독으로는 unknown (동의 증거 없음)",
  );

  await writeUserConsent(user.uid, consentDoc(true));

  const c = await contactOf(email);
  check(
    c?.emailMarketingConsent?.status === "granted",
    "동의 체크 → granted 승격",
  );
  check(
    c?.emailMarketingConsent?.legalBasis === "explicit_opt_in",
    "legalBasis=explicit_opt_in (근거 날조 없음)",
  );
  check(
    c?.emailMarketingConsent?.version === "2026-07-14",
    "동의 문안 버전 기록",
  );
  check(c?.uid === user.uid, "uid 연결");
  check(
    c?.unsubscribe?.status === "subscribed" &&
      c?.emailMarketingConsent?.status === "granted",
    "★isEmailable 조건 충족(granted && !unsubscribed) → 발송 가능",
  );

  const events = await consentEventsOf(email);
  check(
    events.some(
      (e) => e.type === "granted" && e.actor === "system:userConsent_onWrite",
    ),
    "consent_events 에 granted 감사 기록",
  );

  // 멱등 — 같은 동의를 다시 써도 이벤트가 늘지 않아야 한다
  await writeUserConsent(user.uid, consentDoc(true));
  const after = await consentEventsOf(email);
  check(
    after.filter((e) => e.type === "granted").length === 1,
    "멱등: 동일 동의 재기록 시 granted 이벤트 중복 없음",
  );
}

// ─── 시나리오 2: 미체크 → 승격 없음 → 발송 불가 ──────────────────────
console.log("\n[2] 가입 시 마케팅 미체크");
await wipe();
{
  const email = "opted.out@example.com";
  const user = await createSignupUser(email);
  await authCreate(user);
  await writeUserConsent(user.uid, consentDoc(false));

  const c = await contactOf(email);
  check(
    c?.emailMarketingConsent?.status === "unknown",
    "★미체크는 granted 로 올라가지 않는다 → 발송 불가",
  );
  check(
    c?.emailMarketingConsent?.legalBasis === "none",
    "근거 없음(legalBasis=none) 유지",
  );
  const events = await consentEventsOf(email);
  check(events.length === 0, "미체크는 consent_events 도 남기지 않음");
}

// ─── 시나리오 3: ★순서 무관 — saveConsent 가 auth onCreate 보다 먼저 ──
console.log("\n[3] ★순서 무관: saveConsent → auth onCreate (역순)");
await wipe();
{
  const email = "race.first@example.com";
  const user = await createSignupUser(email);

  // 동의 저장이 먼저 도착 — 이 시점에 컨택트는 존재하지 않는다
  await writeUserConsent(user.uid, consentDoc(true));
  const mid = await contactOf(email);
  check(
    mid?.emailMarketingConsent?.status === "granted",
    "컨택트가 없어도 동의 write 가 granted 로 생성",
  );

  // 뒤늦게 auth onCreate 가 도착 — granted 를 덮어쓰면 안 된다
  await authCreate(user);
  const c = await contactOf(email);
  check(
    c?.emailMarketingConsent?.status === "granted",
    "★뒤늦은 auth onCreate 가 granted 를 unknown 으로 되돌리지 않음",
  );
  check(
    c?.emailMarketingConsent?.legalBasis === "explicit_opt_in",
    "동의 근거도 보존",
  );
  check(c?.signupAt != null, "auth onCreate 의 signupAt 은 정상 병합");
}

// ─── 시나리오 4: 철회 (true → false) ────────────────────────────────
console.log("\n[4] 설정에서 마케팅 동의 철회");
await wipe();
{
  const email = "revoker@example.com";
  const user = await createSignupUser(email);
  await authCreate(user);
  await writeUserConsent(user.uid, consentDoc(true));
  check(
    (await contactOf(email))?.emailMarketingConsent?.status === "granted",
    "선행 조건: granted",
  );

  await writeUserConsent(user.uid, consentDoc(false));
  const c = await contactOf(email);
  check(c?.emailMarketingConsent?.status === "revoked", "true→false → revoked");
  check(c?.emailMarketingConsent?.revokedAt != null, "revokedAt 기록");
  check(
    c?.emailMarketingConsent?.consentedAt != null,
    "동의 시점은 감사용으로 보존",
  );
  const events = await consentEventsOf(email);
  check(
    events.some((e) => e.type === "revoked"),
    "consent_events 에 revoked 기록",
  );

  // ★철회 후 재동의 시도는 되살아나지 않아야 한다(재동의는 명시 경로에서만)
  await writeUserConsent(user.uid, consentDoc(true));
  check(
    (await contactOf(email))?.emailMarketingConsent?.status === "revoked",
    "★revoked 는 훅으로 되살아나지 않는다",
  );
}

// ─── 시나리오 5: ★철회 우선 — 수신거부가 동의를 이긴다 ────────────────
console.log("\n[5] ★수신거부(unsubscribe) 후 재동의");
await wipe();
{
  const email = "unsubbed@example.com";
  const user = await createSignupUser(email);
  await authCreate(user);

  // 발송 메일의 수신거부 링크를 누른 상태를 재현
  await db
    .collection("marketing_contacts")
    .doc(contactIdOf(email))
    .set(
      {
        unsubscribe: {
          status: "unsubscribed",
          tokenHash: "h",
          unsubscribedAt: admin.firestore.Timestamp.now(),
        },
      },
      { merge: true },
    );

  await writeUserConsent(user.uid, consentDoc(true));
  const c = await contactOf(email);
  check(
    c?.unsubscribe?.status === "unsubscribed",
    "★동의 write 가 수신거부 상태를 지우지 않는다",
  );
  check(
    !(
      c?.emailMarketingConsent?.status === "granted" &&
      c?.unsubscribe?.status !== "unsubscribed"
    ),
    "★isEmailable=false 유지 — 철회가 동의를 이긴다",
  );
}

// ─── 시나리오 6: 에이전트 custom-token 계정 제외 ─────────────────────
console.log("\n[6] 에이전트 custom-token 계정");
await wipe();
{
  // providerData 가 비는 계정 = 에이전트. 이메일이 있어도 컨택트로 만들지 않는다.
  const agent = await admin
    .auth()
    .createUser({ uid: "agent-uid", email: "agent@marblo.app" });
  await writeUserConsent(agent.uid, consentDoc(true));
  check(
    (await contactOf("agent@marblo.app")) === null,
    "★에이전트 계정은 동의 write 가 있어도 컨택트를 만들지 않음",
  );
}

// ─── 시나리오 7: waitlist 경로 무영향 ───────────────────────────────
console.log("\n[7] waitlist 경로는 그대로 pending");
await wipe();
{
  const email = "waiter@example.com";
  await db
    .collection("betatester50_waitlist")
    .doc("w1")
    .set({ email, agreed: true, locale: "ko" });
  const snap = await db.collection("betatester50_waitlist").doc("w1").get();
  await mod.syncMarketingContactOnWaitlistCreate.run(snap, {
    params: { docId: "w1" },
  });

  const c = await contactOf(email);
  check(
    c?.emailMarketingConsent?.status === "pending",
    "★waitlist agreed=true 는 여전히 pending (마케팅 동의 아님)",
  );
  check(
    c?.emailMarketingConsent?.legalBasis === "none",
    "waitlist 는 legalBasis 를 날조하지 않음",
  );

  // waitlist 로 pending 인 사람이 나중에 가입하며 마케팅 동의하면 승격돼야 한다
  const user = await createSignupUser(email);
  await writeUserConsent(user.uid, consentDoc(true));
  const after = await contactOf(email);
  check(
    after?.emailMarketingConsent?.status === "granted",
    "pending → 명시 동의 시 granted 승격",
  );
  check(after?.segments?.includes("waitlist"), "기존 waitlist 세그먼트 보존");
}

console.log(`\n결과: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
