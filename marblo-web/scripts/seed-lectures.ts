/**
 * Firestore 강의 시드 데이터 업로드
 * 실행: npx tsx scripts/seed-lectures.ts
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { lectures } from '../src/data/lectures';

// Firebase Admin SDK init
// Use GOOGLE_APPLICATION_CREDENTIALS env var or provide service account path
const projectId = process.env.FIREBASE_PROJECT_ID || 'marblo-2253d';

initializeApp({ projectId });
const db = getFirestore();

async function seed() {
  console.log(`Seeding ${lectures.length} lecture(s) to Firestore...`);

  for (const lecture of lectures) {
    const { slug, ...data } = lecture;
    await db.collection('lectures').doc(slug).set({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }, { merge: true });
    console.log(`  [OK] ${slug} — ${lecture.title_ko}`);
  }

  console.log('\nDone! Seeded lectures to Firestore.');
}

seed().catch(console.error);
