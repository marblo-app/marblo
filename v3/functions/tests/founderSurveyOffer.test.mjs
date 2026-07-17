// 설문 회신 오퍼 이메일 캠페인 테스트 (티켓 AuSzaCwl4oAoegj0oqkN).
//
// 이 코드는 실사용자에게 메일을 보내는 경로다 — 오발송하면 outward-facing 사고.
// 그래서 로직 재구현이 아니라 COMPILED 모듈(lib/index.js)을 Firestore+Auth
// 에뮬레이터에 붙여 실제 doc 전이를 검증한다(손 fixture 는 거짓 초록).
//
// 실행:
//   cd v3/functions && npm run test:survey-offer
// ★ 에뮬레이터는 JDK 21+ 필요. 먼저 export JAVA_HOME=/opt/homebrew/opt/openjdk@21.
//
// 커버:
//   - buildFounderSurveyOfferEmail: ko/en/ja 설문 링크 = /{locale}/beta-survey(기존
//     marblo-web 폼, 새 URL 아님), 푸터 문의처 = team@marblo.app.
//   - previewFounderSurveyOffer dryRun(기본): audience = 선정·미반려·계정연결·미회신.
//     rejected/미선정/회신완료/계정미연결 제외. localeBreakdown·domainBreakdown 집계.
//     ★dryRun 은 surveyOfferEmailSent 흔적을 절대 남기지 않음.
//   - 쿨다운: 최근 발송자(surveyOfferEmailSentAt) 제외, ignoreCooldown 으로 해제.
//   - 실발송 게이트: env FOUNDER_SURVEY_EMAIL_SEND_ENABLED 미설정 시 confirmSend 여도
//     dryRun 유지·sent 0(오발송 이중게이트).
//   - requireAdmin: 무인증 차단.

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
process.env.GCLOUD_PROJECT ||= "marblo-test";
process.env.ADMIN_UID = "admin-uid-test";
// ★ RESEND_API_KEY 는 반드시 미설정 — 실발송 방지(발송 함수가 스킵 반환).
delete process.env.RESEND_API_KEY;
// ★ 실발송 env 게이트도 반드시 미설정 — dryRun 강제.
delete process.env.FOUNDER_SURVEY_EMAIL_SEND_ENABLED;

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
const preview = (data, ctx = ADMIN_CTX) =>
  mod.previewFounderSurveyOffer.run(data ?? {}, ctx);

// ─── 시나리오 0: 이메일 본문(순수) — 링크/오퍼/푸터 ─────────────────
{
  for (const loc of ["ko", "en", "ja"]) {
    const c = mod.buildFounderSurveyOfferEmail(loc);
    check(
      c.html.includes(`https://marblo.app/${loc}/beta-survey`) &&
        c.text.includes(`https://marblo.app/${loc}/beta-survey`),
      `설문 링크 = 기존 marblo-web /${loc}/beta-survey (새 URL 아님)`,
    );
    check(
      c.html.includes("team@marblo.app"),
      `[${loc}] 푸터 문의처 = team@marblo.app`,
    );
    check(!!c.subject, `[${loc}] subject 존재`);
  }
}

// ─── 공통 시드 ──────────────────────────────────────────────────────
async function seed() {
  await wipe();
  const grantAt = ts(new Date(Date.now() - 3 * DAY));
  // A: audience (선정·계정연결·미회신, ko, example.com)
  await db.collection("founders").doc("a@example.com").set({
    email: "a@example.com",
    status: "selected",
    accessGrantedAt: grantAt,
    proSubscriptionUid: "uidA",
    locale: "ko",
  });
  // B: audience (en, marblo.app 도메인)
  await db.collection("founders").doc("b@marblo.app").set({
    email: "b@marblo.app",
    status: "selected",
    accessGrantedAt: grantAt,
    proSubscriptionUid: "uidB",
    locale: "en",
  });
  // C: 이미 설문 회신 → alreadySubmitted (제외)
  await db.collection("founders").doc("c@example.com").set({
    email: "c@example.com",
    status: "selected",
    accessGrantedAt: grantAt,
    proSubscriptionUid: "uidC",
    locale: "ko",
    feedbackSubmittedAt: grantAt,
  });
  // D: 계정 미연결(proSubscriptionUid 없음) → noAccountNotSubmitted (미활성 팔로업 담당)
  await db.collection("founders").doc("d@example.com").set({
    email: "d@example.com",
    status: "selected",
    accessGrantedAt: grantAt,
    locale: "ko",
  });
  // E: rejected → 제외
  await db.collection("founders").doc("e@example.com").set({
    email: "e@example.com",
    status: "rejected",
    accessGrantedAt: grantAt,
    proSubscriptionUid: "uidE",
  });
  // F: accessGrantedAt 없음(미선정) → 제외
  await db.collection("founders").doc("f@example.com").set({
    email: "f@example.com",
    status: "selected",
    proSubscriptionUid: "uidF",
  });
}

// ─── 시나리오 1: 기본 dryRun audience 산출 + 집계 ───────────────────
{
  await seed();
  const r = await preview({});
  check(r.dryRun === true, "dryRun 기본값 true");
  check(r.counts.scanned === 6, `scanned=6 (got ${r.counts.scanned})`);
  check(
    r.counts.selectedNotRejected === 4,
    `selectedNotRejected=4 (got ${r.counts.selectedNotRejected})`,
  );
  check(
    r.counts.alreadySubmitted === 1,
    `alreadySubmitted=1 (got ${r.counts.alreadySubmitted})`,
  );
  check(
    r.counts.noAccountNotSubmitted === 1,
    `noAccountNotSubmitted=1 (got ${r.counts.noAccountNotSubmitted})`,
  );
  check(r.counts.audience === 2, `audience=2 (A,B) (got ${r.counts.audience})`);
  check(
    r.localeBreakdown.ko === 1 && r.localeBreakdown.en === 1,
    `localeBreakdown ko=1,en=1 (got ${JSON.stringify(r.localeBreakdown)})`,
  );
  check(
    r.domainBreakdown["example.com"] === 1 &&
      r.domainBreakdown["marblo.app"] === 1,
    `domainBreakdown 도메인별 1건씩 (got ${JSON.stringify(r.domainBreakdown)})`,
  );
  check(r.sent === 0, `dryRun sent=0 (got ${r.sent})`);
  // ★ dryRun 은 surveyOfferEmailSent 발송 흔적을 절대 남기지 않아야 한다.
  const snap = await db.collection("founders").get();
  const anyStamped = snap.docs.some(
    (d) => d.data().surveyOfferEmailSentAt != null,
  );
  check(!anyStamped, "dryRun: surveyOfferEmailSentAt 미기록(발송 흔적 없음)");
}

// ─── 시나리오 2: 쿨다운 제외 + ignoreCooldown 해제 ──────────────────
{
  await seed();
  // A 를 방금 발송한 것으로 마킹 → 쿨다운(14일)에 걸려 제외.
  await db
    .collection("founders")
    .doc("a@example.com")
    .set({ surveyOfferEmailSentAt: ts(new Date()) }, { merge: true });
  const r = await preview({});
  check(
    r.counts.audience === 1,
    `쿨다운 후 audience=1(B) (got ${r.counts.audience})`,
  );
  check(r.counts.cooledDown === 1, `cooledDown=1 (got ${r.counts.cooledDown})`);
  // ignoreCooldown → 다시 2건.
  const r2 = await preview({ ignoreCooldown: true });
  check(
    r2.counts.audience === 2 && r2.counts.cooledDown === 0,
    `ignoreCooldown → audience=2, cooledDown=0 (got ${r2.counts.audience}/${r2.counts.cooledDown})`,
  );
}

// ─── 시나리오 3: 실발송 env 게이트 (confirmSend 여도 dryRun 유지) ────
{
  await seed();
  const r = await preview({ confirmSend: true });
  check(
    r.dryRun === true && r.sent === 0,
    "env FOUNDER_SURVEY_EMAIL_SEND_ENABLED 미설정 → confirmSend 여도 dryRun·sent0",
  );
  check(
    r.sendGate.sendEnabled === false && r.sendGate.confirmSend === true,
    "sendGate 노출(sendEnabled=false, confirmSend=true)",
  );
  // 게이트에 막혔으니 발송 흔적도 없어야 한다.
  const snap = await db.collection("founders").get();
  const anyStamped = snap.docs.some(
    (d) => d.data().surveyOfferEmailSentAt != null,
  );
  check(!anyStamped, "게이트 차단 시 발송 흔적 없음");
}

// ─── 시나리오 4: requireAdmin ───────────────────────────────────────
{
  let threw = false;
  try {
    await preview({}, {}); // auth 없음
  } catch (e) {
    threw =
      e?.code === "permission-denied" || e?.code === "failed-precondition";
  }
  check(threw, "previewFounderSurveyOffer: 무인증 차단");
}

console.log(`\n[founderSurveyOffer] passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
