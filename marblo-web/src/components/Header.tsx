"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { Menu, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import LanguageToggle from "./LanguageToggle";

export default function Header() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    setMobileOpen(false);
    router.push(`/${locale}`);
  };

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link
            href={`/${locale}`}
            className="flex items-center gap-2 text-xl font-bold text-white tracking-tight"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/marblo-mark.svg"
              alt=""
              width={28}
              height={28}
              className="rounded-md"
            />
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
              href={`/${locale}/blog`}
              className="text-zinc-400 hover:text-white transition"
            >
              {t("blog")}
            </Link>
            <Link
              href={`/${locale}/founders`}
              className="text-indigo-300 hover:text-indigo-200 transition font-medium"
            >
              {t("foundation50")}
            </Link>
            <LanguageToggle />
            {user ? (
              <>
                <Link
                  href={`/${locale}/my/lectures`}
                  className="text-zinc-400 hover:text-white transition"
                >
                  {t("myLectures")}
                </Link>
                <Link
                  href={`/${locale}/my/privacy`}
                  className="text-zinc-400 hover:text-white transition"
                >
                  {t("privacy")}
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 px-4 py-2 rounded-lg transition"
                >
                  {t("logout")}
                </button>
              </>
            ) : (
              <Link
                href={`/${locale}/auth/login`}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition"
              >
                {t("login")}
              </Link>
            )}
          </nav>
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            className="md:hidden text-zinc-300 hover:text-white transition p-2 -mr-2"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="md:hidden border-t border-zinc-800/50 bg-zinc-950/95 backdrop-blur-xl">
          <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-4">
            <Link
              href={`/${locale}/pricing`}
              onClick={closeMobile}
              className="text-zinc-400 hover:text-white transition"
            >
              {t("pricing")}
            </Link>
            <Link
              href={`/${locale}/download`}
              onClick={closeMobile}
              className="text-zinc-400 hover:text-white transition"
            >
              {t("download")}
            </Link>
            <Link
              href={`/${locale}/lectures`}
              onClick={closeMobile}
              className="text-zinc-400 hover:text-white transition"
            >
              {t("lectures")}
            </Link>
            <Link
              href={`/${locale}/blog`}
              onClick={closeMobile}
              className="text-zinc-400 hover:text-white transition"
            >
              {t("blog")}
            </Link>
            <Link
              href={`/${locale}/founders`}
              onClick={closeMobile}
              className="text-indigo-300 hover:text-indigo-200 transition font-medium"
            >
              {t("foundation50")}
            </Link>
            <div className="pt-1">
              <LanguageToggle />
            </div>
            {user ? (
              <>
                <Link
                  href={`/${locale}/my/lectures`}
                  onClick={closeMobile}
                  className="text-zinc-400 hover:text-white transition"
                >
                  {t("myLectures")}
                </Link>
                <Link
                  href={`/${locale}/my/privacy`}
                  onClick={closeMobile}
                  className="text-zinc-400 hover:text-white transition"
                >
                  {t("privacy")}
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 px-4 py-2 rounded-lg transition text-center"
                >
                  {t("logout")}
                </button>
              </>
            ) : (
              <Link
                href={`/${locale}/auth/login`}
                onClick={closeMobile}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition text-center"
              >
                {t("login")}
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
