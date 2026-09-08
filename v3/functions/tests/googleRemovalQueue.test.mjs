// 구글 Customer Match 제거 대기열 배선 테스트 (티켓 7THv6vmkSxUSMkKM5Ybe).
//
// #1521(docs/marketing-hashed-email-ads-targeting-2026-09-07.md §8-6)이 읽기로
// 확인한 갭: 동의를 철회해도 구글 리스트에서 사람을 빼는 요청이 어디에도 없다.
// 이 테스트는 그 요청을 "잃어버리지 않는 대기열"로 만드는 배선을, 손 fixture가
// 아니라 COMPILED 모듈(lib/index.js)의 실제 훅을 Firestore+Auth 에뮬레이터에
// 붙여 검증한다(marketingConsentSync.test.mjs 와 같은 규약 — 손 fake는 거짓 초록).
//
// ★이 테스트는 구글에 아무것도 보내지 않는다 — 대기열 컬렉션에 문서가
// 생기는지만 본다. 실제 전송 코드는 이 티켓 범위 밖이라 존재하지 않는다.
//
// 실행:
//   cd v3/functions && npm run test:google-removal-queue
// ★ 에뮬레이터는 JDK 21+ 필요. export JAVA_HOME=/opt/homebrew/opt/openjdk@21.
//
// 커버:
//   - 수신거부 링크가 만드는 문서 모양(직접 write) → 큐에 오른다
//   - 설정 화면 토글 OFF(upsertMarketingContact 경유) → 큐에 오른다
//   - ★계정 삭제 → marketing_contacts 문서가 아예 없어도 큐에 오른다
//   - ★계정 삭제 → marketing_contacts 문서가 있다가 지워져도 큐 항목은 살아남는다
//   - 이미 큐에 오른 항목에 같은 사유가 다시 와도 문서가 하나만 유지된다(멱등)
//   - grant/pending 같은 철회가 아닌 전이는 큐에 안 오른다(오탐 방지)
//   - ★★resolvedAt 을 채운(처리 완료로 표시한) 뒤 같은 컨택트가 재동의 후 다시
//     철회하면(= 새 철회 사건) resolvedAt 이 null 로 리셋된다(#1523 리뷰 지적,
//     PR 리뷰어가 "이건 초록이 안 나는 축이다"라고 짚은 부분을 직접 씀)

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.GCLOUD_PROJECT ||= "marblo-test";
process.env.MARKETING_EMAIL_ENC_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.MARKETING_UNSUB_SECRET ||= "test-unsub-secret";
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

const queueEntryOf = async (email) => {
  const snap = await db
    .collection("marketing_google_removal_queue")
    .doc(contactIdOf(email))
    .get();
  return snap.exists ? snap.data() : null;
};

async function wipe() {
  for (const col of [
    "marketing_contacts",
    "marketing_google_removal_queue",
    "users",
  ]) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  const users = await admin.auth().listUsers();
  if (users.users.length) {
    await admin.auth().deleteUsers(users.users.map((u) => u.uid));
  }
}

// ─── 훅 구동 헬퍼 ──────────────────────────────────────────────────
async function runContactWriteHook(contactId, mutate) {
  const ref = db.collection("marketing_contacts").doc(contactId);
  const before = await ref.get();
  await mutate(ref);
  const after = await ref.get();
  return mod.syncGoogleRemovalQueueOnContactWrite.run(
    { before, after },
    { params: { contactId } },
  );
}

async function runAuthDeleteHook(user) {
  return mod.syncGoogleRemovalQueueOnAuthDelete.run(user);
}

const baseConsent = (status) => ({
  status,
  source: "test",
  version: "",
  consentedAt: null,
  revokedAt: null,
  legalBasis: status === "granted" ? "explicit_opt_in" : "none",
});

// ─── 시나리오 1: 수신거부 링크가 만드는 문서 모양 → 큐에 오른다 ─────────────
console.log("\n[1] 수신거부 링크(직접 write) → 큐에 오른다");
await wipe();
{
  const email = "unsub.direct@example.com";
  const contactId = contactIdOf(email);
  // unsubscribeMarketingEmail 이 실제로 만드는 모양(index.ts): consent도 함께 revoked.
  await runContactWriteHook(contactId, (ref) =>
    ref.set({
      normalizedEmailHash: contactId,
      emailMarketingConsent: baseConsent("granted"),
      unsubscribe: {
        status: "subscribed",
        tokenHash: null,
        unsubscribedAt: null,
      },
    }),
  );
  await runContactWriteHook(contactId, (ref) =>
    ref.set(
      {
        emailMarketingConsent: {
          ...baseConsent("revoked"),
          revokedAt: admin.firestore.Timestamp.now(),
        },
        unsubscribe: {
          status: "unsubscribed",
          tokenHash: "x",
          unsubscribedAt: admin.firestore.Timestamp.now(),
        },
      },
      { merge: true },
    ),
  );
  const entry = await queueEntryOf(email);
  check(!!entry, "수신거부 후 큐 항목이 생긴다");
  check(
    entry?.reason === "unsubscribed",
    `사유는 unsubscribed(실제: ${entry?.reason})`,
  );
  check(entry?.resolvedAt === null, "resolvedAt 은 null(전송 미연결)");
}

// ─── 시나리오 2: 설정 화면 토글 OFF(upsertMarketingContact 경유) ────────────
console.log("\n[2] 설정 화면 토글 OFF → 큐에 오른다");
await wipe();
{
  const email = "toggle.off@example.com";
  const user = await admin
    .auth()
    .createUser({ email, password: "test-pw-1234" });
  const uid = user.uid;
  await mod.syncMarketingContactOnAuthCreate.run(
    await admin.auth().getUser(uid),
  );

  async function writeUserConsent(consentPatch) {
    const ref = db.collection("users").doc(uid);
    const before = await ref.get();
    await ref.set({ webPrivacyConsent: consentPatch }, { merge: true });
    const after = await ref.get();
    return mod.syncMarketingConsentOnUserWrite.run(
      { before, after },
      { params: { uid } },
    );
  }
  const consentDoc = (marketing) => ({
    collectionUse: true,
    overseasTransfer: true,
    marketing,
    version: "2026-09-08",
    locale: "ko",
    acceptedAt: admin.firestore.Timestamp.now(),
  });

  // 동의 → granted 로 승격(마케팅 컨택트 onWrite 는 이 전이도 관측하지만 grant 는 큐 대상이 아니다).
  const contactId = contactIdOf(email);
  await runContactWriteHook(contactId, () =>
    writeUserConsent(consentDoc(true)),
  );
  check((await queueEntryOf(email)) === null, "동의(grant)는 큐에 안 오른다");

  // 설정에서 끄기(true→false) → upsertMarketingContact 가 revokeConsent 를 흘려보낸다.
  await runContactWriteHook(contactId, () =>
    writeUserConsent(consentDoc(false)),
  );
  const entry = await queueEntryOf(email);
  check(!!entry, "토글 OFF 후 큐 항목이 생긴다");
  check(
    entry?.reason === "consent_revoked",
    `사유는 consent_revoked(실제: ${entry?.reason})`,
  );
}

// ─── 시나리오 3: ★계정 삭제 — marketing_contacts 문서가 없어도 큐에 오른다 ──
console.log("\n[3] ★계정 삭제 — marketing_contacts 문서가 없어도 큐에 오른다");
await wipe();
{
  const email = "deleted.no.contact@example.com";
  const user = await admin
    .auth()
    .createUser({ email, password: "test-pw-1234" });
  const fullUser = await admin.auth().getUser(user.uid);

  check((await queueEntryOf(email)) === null, "선행 조건: 큐가 비어 있다");
  // marketing_contacts 문서를 한 번도 만들지 않은 채로 계정을 지운다.
  await admin.auth().deleteUser(user.uid);
  await runAuthDeleteHook(fullUser);

  const entry = await queueEntryOf(email);
  check(!!entry, "★컨택트 문서가 없었는데도 큐 항목이 생긴다");
  check(
    entry?.reason === "account_deleted",
    `사유는 account_deleted(실제: ${entry?.reason})`,
  );
  check(
    entry?.source === "system:auth_onDelete",
    "출처가 auth_onDelete 로 기록된다",
  );
}

// ─── 시나리오 4: ★계정 삭제 — 있던 marketing_contacts 문서가 지워져도 큐 항목은 산다 ──
console.log(
  "\n[4] ★계정 삭제 — 컨택트 문서가 삭제돼도 큐 항목은 독립적으로 살아남는다",
);
await wipe();
{
  const email = "deleted.had.contact@example.com";
  const contactId = contactIdOf(email);
  const user = await admin
    .auth()
    .createUser({ email, password: "test-pw-1234" });
  const fullUser = await admin.auth().getUser(user.uid);

  // 마케팅 컨택트가 실제로 있었다(예: 예전에 동의했던 사람).
  await db
    .collection("marketing_contacts")
    .doc(contactId)
    .set({
      normalizedEmailHash: contactId,
      emailMarketingConsent: baseConsent("granted"),
      unsubscribe: {
        status: "subscribed",
        tokenHash: null,
        unsubscribedAt: null,
      },
    });

  // ★PIPA 삭제요청 처리로 컨택트 문서 자체를 완전히 지운 뒤 계정도 지운다
  //   (문서가 사라진 뒤에 대기열을 만들어야 하는 가장 나쁜 순서로 검증한다).
  await db.collection("marketing_contacts").doc(contactId).delete();
  check(
    !(await db.collection("marketing_contacts").doc(contactId).get()).exists,
    "선행 조건: 컨택트 문서가 실제로 지워졌다",
  );

  await admin.auth().deleteUser(user.uid);
  await runAuthDeleteHook(fullUser);

  const entry = await queueEntryOf(email);
  check(!!entry, "★컨택트 문서가 사라진 뒤에도 큐 항목은 독립적으로 생긴다");
  check(
    entry?.reason === "account_deleted",
    `사유는 account_deleted(실제: ${entry?.reason})`,
  );
}

// ─── 시나리오 5: 멱등 — 같은 컨택트가 여러 경로로 철회돼도 큐 문서는 하나 ──
console.log(
  "\n[5] 멱등 — 같은 컨택트가 두 번 철회 신호를 내도 큐 문서는 하나다",
);
await wipe();
{
  const email = "double.revoke@example.com";
  const contactId = contactIdOf(email);
  await runContactWriteHook(contactId, (ref) =>
    ref.set({
      normalizedEmailHash: contactId,
      emailMarketingConsent: baseConsent("granted"),
      unsubscribe: {
        status: "subscribed",
        tokenHash: null,
        unsubscribedAt: null,
      },
    }),
  );
  await runContactWriteHook(contactId, (ref) =>
    ref.set(
      {
        emailMarketingConsent: {
          ...baseConsent("revoked"),
          revokedAt: admin.firestore.Timestamp.now(),
        },
      },
      { merge: true },
    ),
  );
  // 나중에 수신거부 링크로도 한 번 더(같은 사람, 다른 경로).
  await runContactWriteHook(contactId, (ref) =>
    ref.set(
      {
        unsubscribe: {
          status: "unsubscribed",
          tokenHash: "x",
          unsubscribedAt: admin.firestore.Timestamp.now(),
        },
      },
      { merge: true },
    ),
  );
  const snap = await db
    .collection("marketing_google_removal_queue")
    .where(admin.firestore.FieldPath.documentId(), "==", contactId)
    .get();
  check(snap.size === 1, `큐 문서는 하나만 존재한다(실제: ${snap.size})`);
}

// ─── 시나리오 6: grant/pending 은 큐에 안 오른다(오탐 방지) ────────────────
console.log("\n[6] 신규 동의·pending 편입은 큐에 안 오른다");
await wipe();
{
  const email = "new.grant@example.com";
  const contactId = contactIdOf(email);
  await runContactWriteHook(contactId, (ref) =>
    ref.set({
      normalizedEmailHash: contactId,
      emailMarketingConsent: baseConsent("unknown"),
      unsubscribe: {
        status: "subscribed",
        tokenHash: null,
        unsubscribedAt: null,
      },
    }),
  );
  await runContactWriteHook(contactId, (ref) =>
    ref.set({ emailMarketingConsent: baseConsent("granted") }, { merge: true }),
  );
  check((await queueEntryOf(email)) === null, "granted 승격은 큐에 안 오른다");
}

// ─── 시나리오 7: ★★resolvedAt 은 처리 후에도 "새 철회 사건"엔 null 로 리셋 ──
console.log(
  "\n[7] ★★처리 완료(resolvedAt 있음) 뒤 재동의→재철회 → resolvedAt 이 null 로 리셋된다",
);
await wipe();
{
  const email = "resolved.then.revoked.again@example.com";
  const contactId = contactIdOf(email);

  // 최초 철회 → 큐에 오른다(resolvedAt null 로 시작).
  await runContactWriteHook(contactId, (ref) =>
    ref.set({
      normalizedEmailHash: contactId,
      emailMarketingConsent: baseConsent("granted"),
      unsubscribe: {
        status: "subscribed",
        tokenHash: null,
        unsubscribedAt: null,
      },
    }),
  );
  await runContactWriteHook(contactId, (ref) =>
    ref.set(
      {
        emailMarketingConsent: {
          ...baseConsent("revoked"),
          revokedAt: admin.firestore.Timestamp.now(),
        },
      },
      { merge: true },
    ),
  );
  check(
    (await queueEntryOf(email))?.resolvedAt === null,
    "선행 조건: 최초 철회 직후 resolvedAt 은 null",
  );

  // ★Stage 2 가 실제로 구글에 보내고 처리 완료로 표시했다고 가정(수동 시뮬레이션 —
  // 이 티켓은 그 코드를 만들지 않으므로 테스트에서 직접 흉내낸다).
  await db
    .collection("marketing_google_removal_queue")
    .doc(contactId)
    .set({ resolvedAt: admin.firestore.Timestamp.now() }, { merge: true });
  check(
    (await queueEntryOf(email))?.resolvedAt !== null,
    "선행 조건: 처리 완료로 표시됐다(resolvedAt 채워짐)",
  );

  // 재동의(revoked → granted) — grant 는 큐 판정 대상이 아니므로 큐 문서를
  // 건드리지 않는다. 이 사람이 이후 재업로드됐을 수 있다는 전제.
  await runContactWriteHook(contactId, (ref) =>
    ref.set({ emailMarketingConsent: baseConsent("granted") }, { merge: true }),
  );
  check(
    (await queueEntryOf(email))?.resolvedAt !== null,
    "재동의만으로는 resolvedAt 이 안 지워진다(큐 판정 대상이 아니므로 write 자체가 없다)",
  );

  // 재철회(granted → revoked) — 이번엔 새로운 철회 "사건" 이다.
  await runContactWriteHook(contactId, (ref) =>
    ref.set(
      {
        emailMarketingConsent: {
          ...baseConsent("revoked"),
          revokedAt: admin.firestore.Timestamp.now(),
        },
      },
      { merge: true },
    ),
  );
  const reRevoked = await queueEntryOf(email);
  check(
    reRevoked?.resolvedAt === null,
    "★★재철회(새 사건) 후 resolvedAt 이 null 로 리셋된다 — 처리됨을 지우는 버그가 아니라 재처리 필요를 뜻함",
  );
  check(
    reRevoked?.reason === "consent_revoked",
    `사유도 이번 사건 기준으로 갱신된다(실제: ${reRevoked?.reason})`,
  );
}

console.log(`\n결과: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
