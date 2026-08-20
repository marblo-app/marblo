/**
 * Firestore 강의 문서 백업 (읽기 전용)
 * 실행: FIREBASE_PROJECT_ID=marblo-2253d npx tsx scripts/backup-lecture-doc.ts <slug> <outFile>
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { writeFileSync } from "fs";

const projectId = process.env.FIREBASE_PROJECT_ID || "marblo-2253d";
const slug = process.argv[2];
const outFile = process.argv[3];

if (!slug || !outFile) {
  console.error("Usage: tsx scripts/backup-lecture-doc.ts <slug> <outFile>");
  process.exit(1);
}

initializeApp({ projectId });
const db = getFirestore();

async function backup() {
  const snap = await db.collection("lectures").doc(slug).get();
  if (!snap.exists) {
    console.error(`Document lectures/${slug} does not exist.`);
    process.exit(1);
  }
  writeFileSync(outFile, JSON.stringify(snap.data(), null, 2));
  console.log(`Backed up lectures/${slug} -> ${outFile}`);
}

backup().catch((err) => {
  console.error(err);
  process.exit(1);
});
