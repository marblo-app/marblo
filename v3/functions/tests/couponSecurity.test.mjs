// Plain-Node smoke test for coupon security invariants. Run:
//   node v3/functions/tests/couponSecurity.test.mjs
//
// This avoids loading Cloud Functions and external clients while still
// guarding the audit requirements:
//   - createCouponBatch calls the shared ADMIN_UID-backed requireAdmin guard.
//   - coupons/couponRedemptions are explicitly denied to Firestore clients.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const functionsSource = readFileSync(resolve(__dirname, "../src/index.ts"), "utf8");
const rulesSource = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");
const firebaseConfig = JSON.parse(
  readFileSync(resolve(__dirname, "../../firebase.json"), "utf8"),
);

const cases = [
  [
    "createCouponBatch uses requireAdmin guard before coupon writes",
    () => {
      const exportStart = functionsSource.indexOf("export const createCouponBatch");
      const nextExport = functionsSource.indexOf("export const issueLectureCoupon", exportStart);
      if (exportStart < 0 || nextExport < 0) return false;

      const body = functionsSource.slice(exportStart, nextExport);
      const guardIndex = body.indexOf("requireAdmin(context);");
      const batchIndex = body.indexOf("const batch = db.batch();");
      const collectionWriteIndex = body.indexOf('db.collection("coupons")');

      return (
        guardIndex >= 0 &&
        batchIndex > guardIndex &&
        collectionWriteIndex > guardIndex &&
        !body.includes("Login required")
      );
    },
  ],
  [
    "requireAdmin distinguishes missing ADMIN_UID from uid mismatch",
    () => {
      const guardStart = functionsSource.indexOf("function requireAdmin");
      const guardEnd = functionsSource.indexOf("// 구독 doc", guardStart);
      if (guardStart < 0 || guardEnd < 0) return false;

      const body = functionsSource.slice(guardStart, guardEnd);
      return (
        body.includes("process.env.ADMIN_UID") &&
        body.includes('"failed-precondition"') &&
        body.includes("Admin configuration is missing.") &&
        body.includes("context.auth?.uid !== adminUid") &&
        body.includes('"permission-denied"') &&
        body.indexOf('"failed-precondition"') < body.indexOf('"permission-denied"')
      );
    },
  ],
  [
    "functions predeploy checks env before build",
    () => {
      const functionsConfig = firebaseConfig.functions?.find?.(
        (entry) => entry.source === "functions",
      );
      const predeploy = functionsConfig?.predeploy;
      if (!Array.isArray(predeploy)) return false;
      const envGateIndex = predeploy.findIndex((cmd) =>
        String(cmd).includes("run check:deploy-env"),
      );
      const buildIndex = predeploy.findIndex((cmd) =>
        String(cmd).includes("run build"),
      );
      return envGateIndex >= 0 && buildIndex > envGateIndex;
    },
  ],
  [
    "Firestore rules explicitly deny coupons client access",
    () =>
      /match\s+\/coupons\/\{couponCode\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/m.test(
        rulesSource,
      ),
  ],
  [
    "Firestore rules explicitly deny couponRedemptions client access",
    () =>
      /match\s+\/couponRedemptions\/\{redemptionId\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/m.test(
        rulesSource,
      ),
  ],
];

let pass = 0;
let fail = 0;
for (const [name, fn] of cases) {
  try {
    if (fn()) pass++;
    else {
      console.log("FAIL:", name);
      fail++;
    }
  } catch (err) {
    console.log("THROW:", name, err.message);
    fail++;
  }
}

console.log(
  `\ncouponSecurity: ${pass}/${cases.length} passed${
    fail ? `, ${fail} failed` : ""
  }`,
);
process.exit(fail ? 1 : 0);
