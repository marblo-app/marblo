'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import VideoPlayer from '@/components/VideoPlayer';

interface LectureSection {
  title: string;
  youtubeId: string;
  duration: number;
}

interface LectureModule {
  title: string;
  sections: LectureSection[];
}

interface Lecture {
  title_ko: string;
  title_en: string;
  modules: LectureModule[];
}

export default function WatchLecturePage() {
  const locale = useLocale();
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [currentSection, setCurrentSection] = useState<LectureSection | null>(null);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push(`/${locale}/auth/login`); return; }
      const q = query(collection(db, 'lecturePurchases'), where('userId', '==', user.uid), where('lectureSlug', '==', slug));
      const snap = await getDocs(q);
      if (snap.empty) { router.push(`/${locale}/lectures/${slug}`); return; }
      setAuthorized(true);
      const lectureDoc = await getDoc(doc(db, 'lectures', slug));
      if (lectureDoc.exists()) {
        const data = lectureDoc.data() as Lecture;
        setLecture(data);
        if (data.modules?.[0]?.sections?.[0]) setCurrentSection(data.modules[0].sections[0]);
      }
    });
    return () => unsub();
  }, [locale, router, slug]);

  if (!authorized || !lecture) return <div className="py-24 text-center text-zinc-400">Loading...</div>;

  const title = locale === 'ko' ? lecture.title_ko : lecture.title_en;

  return (
    <div className="py-12 px-4">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {currentSection && <VideoPlayer youtubeId={currentSection.youtubeId} title={currentSection.title} />}
          <h2 className="text-xl font-semibold mt-6">{currentSection?.title}</h2>
        </div>
        <div className="space-y-4">
          <h2 className="text-lg font-bold">{title}</h2>
          {lecture.modules?.map((mod, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <h3 className="font-semibold mb-3 text-sm text-zinc-300">{mod.title}</h3>
              <ul className="space-y-2">
                {mod.sections.map((sec, j) => (
                  <li key={j}>
                    <button
                      onClick={() => setCurrentSection(sec)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                        currentSection?.youtubeId === sec.youtubeId ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-400 hover:bg-zinc-800'
                      }`}
                    >
                      {sec.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
