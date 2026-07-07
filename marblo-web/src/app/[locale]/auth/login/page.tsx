'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { sanitizeRedirect } from '@/lib/sanitizeRedirect';

export default function LoginPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = sanitizeRedirect(searchParams.get('redirect'), `/${locale}`);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push(redirect);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGoogle = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      router.push(redirect);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="py-24 px-4">
      <div className="max-w-md mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <h1 className="text-2xl font-bold text-center mb-8">{t('login')}</h1>
        <div className="space-y-3 mb-6">
          <button onClick={handleGoogle} className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 py-3 rounded-lg font-medium hover:bg-gray-100 transition">
            {t('loginWithGoogle')}
          </button>
        </div>
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-700" /></div>
          <div className="relative flex justify-center text-sm"><span className="px-2 bg-zinc-900 text-zinc-500">{t('or')}</span></div>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('email')} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('password')} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500" />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg font-medium transition">{t('login')}</button>
        </form>
        <p className="text-center text-zinc-400 text-sm mt-6">
          {t('noAccount')} <Link href={`/${locale}/auth/signup`} className="text-indigo-400 hover:underline">{t('signupLink')}</Link>
        </p>
      </div>
    </div>
  );
}
