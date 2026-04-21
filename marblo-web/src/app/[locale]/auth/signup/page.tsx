'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export default function SignupPage() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      router.push(`/${locale}`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="py-24 px-4">
      <div className="max-w-md mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <h1 className="text-2xl font-bold text-center mb-8">{t('signup')}</h1>
        <form onSubmit={handleSignup} className="space-y-4">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('email')} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('password')} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500" />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={t('confirmPassword')} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500" />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg font-medium transition">{t('signup')}</button>
        </form>
        <p className="text-center text-zinc-400 text-sm mt-6">
          {t('hasAccount')} <Link href={`/${locale}/auth/login`} className="text-indigo-400 hover:underline">{t('loginLink')}</Link>
        </p>
      </div>
    </div>
  );
}
