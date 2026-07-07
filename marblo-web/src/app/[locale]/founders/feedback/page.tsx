"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// V2 개편: 성실 설문은 /[locale]/beta-survey 로 이전되었다. 기존 안내 이메일/북마크가
// /founders/feedback 을 가리킬 수 있으므로 이 라우트는 새 설문으로 리다이렉트만 한다.
export default function FounderFeedbackRedirect() {
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/${locale}/beta-survey`);
  }, [locale, router]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-indigo-300" />
    </div>
  );
}
