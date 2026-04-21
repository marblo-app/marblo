export const TOSS_CLIENT_KEY = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || '';

export async function loadTossPayments() {
  const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
  return loadTossPayments(TOSS_CLIENT_KEY);
}
