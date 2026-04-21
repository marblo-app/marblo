'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

interface PurchasedLecture {
  slug: string;
  title_ko: string;
  title_en: string;
  thumbnail: string;
  purchasedAt: any;
}

export default function MyLecturesPage() {
  const t = useTranslations('lectures');
  const locale = useLocale();
  const router = useRouter();
  const [lectures, setLectures] = useState<PurchasedLecture[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push(`/${locale}/auth/login`); return; }
      try {
        const q = query(collection(db, 'lecturePurchases'), where('userId', '==', user.uid));
        const snap = await getDocs(q);
        const purchasedLectures: PurchasedLecture[] = [];
        for (const purchase of snap.docs) {
          const data = purchase.data();
          const lectureDoc = await getDoc(doc(db, 'lectures', data.lectureSlug));
          if (lectureDoc.exists()) {
            const ld = lectureDoc.data();
            purchasedLectures.push({
              slug: data.lectureSlug,
              title_ko: ld.title_ko,
              title_en: ld.title_en,
              thumbnail: ld.thumbnail,
              purchasedAt: data.purchasedAt,
            });
          }
        }
        setLectures(purchasedLectures);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [locale, router]);

  if (loading) return <div className="py-24 text-center text-zinc-400">Loading...</div>;

  return (
    <div className="py-24 px-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold mb-12">{t('myLectures')}</h1>
        {lectures.length === 0 ? (
          <p className="text-zinc-400 text-center">{t('noLectures')}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {lectures.map((lecture) => (
              <Link key={lecture.slug} href={`/${locale}/my/lectures/${lecture.slug}`} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-indigo-500 transition">
                {lecture.thumbnail && <img src={lecture.thumbnail} alt="" className="aspect-video w-full object-cover" />}
                <div className="p-6">
                  <h3 className="text-lg font-semibold">{locale === 'ko' ? lecture.title_ko : lecture.title_en}</h3>
                  <p className="text-indigo-400 text-sm mt-2">{t('watch')} →</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
