'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { httpsCallable } from 'firebase/functions';
import { getFunctions } from 'firebase/functions';
import app from '@/lib/firebase';
import { couponDiscountAmount, isFullyComped } from '@/lib/coupon';

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
  /** 할인 대상 금액 — 적용 결과를 금액으로 되돌려주는 데 쓴다. */
  baseAmount?: number;
}

export default function CouponInput({
  onApply,
  userId,
  baseAmount = 0,
}: CouponInputProps) {
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
        // 쿠폰 타입별로 다른 말을 해야 한다. free_trial / plan_upgrade 는
        // discountPercent 가 없어서, 예전엔 "적용되었습니다" 만 뜨고 총액은
        // 정가 그대로 남아 있었다(실제 첫 청구는 0원).
        const discount = couponDiscountAmount(baseAmount, data);
        setMessage({
          text: isFullyComped(baseAmount, data)
            ? t('couponAppliedFree')
            : discount > 0
              ? t('couponAppliedDiscount', {
                  amount: `\u20A9${discount.toLocaleString()}`,
                })
              : t('couponApplied'),
          type: 'success',
        });
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
