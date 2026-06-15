"use client";

import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import LanguageToggle from "./LanguageToggle";

export default function Header() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);

  return (
    <header className="border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link
            href={`/${locale}`}
            className="text-xl font-bold text-white tracking-tight"
          >
            Marblo
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link
              href={`/${locale}/pricing`}
              className="text-zinc-400 hover:text-white transition"
            >
              {t("pricing")}
            </Link>
            <Link
              href={`/${locale}/download`}
              className="text-zinc-400 hover:text-white transition"
            >
              {t("download")}
            </Link>
            <Link
              href={`/${locale}/lectures`}
              className="text-zinc-400 hover:text-white transition"
            >
              {t("lectures")}
            </Link>
            <Link
              href={`/${locale}/founders`}
              className="text-indigo-300 hover:text-indigo-200 transition font-medium"
            >
              {t("foundation50")}
            </Link>
            <LanguageToggle />
            {user ? (
              <Link
                href={`/${locale}/my/lectures`}
                className="text-zinc-400 hover:text-white transition"
              >
                {t("myLectures")}
              </Link>
            ) : (
              <Link
                href={`/${locale}/auth/login`}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition"
              >
                {t("login")}
              </Link>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
