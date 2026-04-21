'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { httpsCallable } from 'firebase/functions';
import { getFunctions } from 'firebase/functions';
import app from '@/lib/firebase';

interface CouponResult {
  valid: boolean;
  discountPercent?: number;
  freeDays?: number;
  type?: string;
  reason?: string;
}

interface CouponInputProps {
  onApply: (result: CouponResult & { code: string }) => void;
  userId: string;
}

export default function CouponInput({ onApply, userId }: CouponInputProps) {
  const t = useTranslations('checkout');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleApply = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const functions = getFunctions(app, 'us-central1');
      const validateCoupon = httpsCallable(functions, 'validateCoupon');
      const result = await validateCoupon({ code: code.trim(), userId });
      const data = result.data as CouponResult;
      if (data.valid) {
        setMessage({ text: t('couponApplied'), type: 'success' });
        onApply({ ...data, code: code.trim() });
      } else {
        setMessage({ text: data.reason || t('couponInvalid'), type: 'error' });
      }
    } catch {
      setMessage({ text: t('couponInvalid'), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={t('coupon')}
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={handleApply}
          disabled={loading || !code.trim()}
          className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition"
        >
          {loading ? '...' : t('applyCoupon')}
        </button>
      </div>
      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
