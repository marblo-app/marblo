/**
 * 마케팅 수신동의 — Firestore/Functions IO.
 *
 * ★새 훅을 만들지 않는다. 동의 기록은 오직
 *   `users/{uid}.webPrivacyConsent.marketing = true` 한 곳에 쓰고, 나머지는
 *   기존 배선이 처리한다:
 *
 *     users/{uid} write
 *        → functions 훅 1b `syncMarketingConsentOnUserWrite`
 *        → `decideMarketingConsentSync` = grant
 *        → `upsertMarketingContact({grantConsent: legalBasis=explicit_opt_in})`
 *        → marketing_contacts/{sha256(email)}.emailMarketingConsent = granted
 *        → 발송 게이트 `isEmailable` = ok
 *
 *   (marblo-web 가입 폼/설정 화면이 쓰는 필드와 동일. 앱의
 *   `users/{uid}.privacyConsent` 는 텔레메트리 스키마라 marketing 필드가 없다 —
 *   섞지 않는다.)
 *
 * ★읽기(재동의 배너 게이트)는 클라이언트가 직접 못 한다:
 *   `marketing_contacts` 는 Firestore 룰에서 전면 차단(Admin SDK 전용)이다.
 *   그래서 상태 플래그만 돌려주는 onCall `getMyMarketingConsentStatus` 를 쓴다 —
 *   이메일(평문·암호문·해시)은 응답에 없다.
 */
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import {
  MARKETING_CONSENT_VERSION,
  type MarketingConsentStatusView,
  type MarketingContactStatus,
} from "./marketingConsent";

/**
 * 명시적 opt-in 을 기록한다. **사용자가 체크박스를 켠 경우에만** 호출할 것.
 *
 * ★`marketing: false` 를 쓰는 경로는 여기 없다. 미체크는 "동의 안 함" 이고,
 *   훅은 그것을 never_opted_in 으로 접는다 — 굳이 write 해서 users 문서를
 *   건드리고 훅을 깨울 이유가 없다. (웹 설정 화면의 동의 해제 = true→false
 *   전이는 marblo-web 소관으로 그대로 남는다.)
 */
export async function saveMarketingOptIn(
  uid: string,
  locale: string = "ko",
): Promise<void> {
  await setDoc(
    doc(db, "users", uid),
    {
      webPrivacyConsent: {
        marketing: true,
        version: MARKETING_CONSENT_VERSION,
        // ★앱 문안은 구글 광고 제공을 담지 않는다. 마케팅 문안 버전을
        //   명시적으로 실어 둔다 — 허용목록(marketingContacts.ts
        //   ADS_PROVISION_CONSENT_VERSIONS)에 없는 값이라 광고 제공
        //   대상에서 정확히 제외된다.
        marketingVersion: MARKETING_CONSENT_VERSION,
        locale,
        acceptedAt: serverTimestamp(),
      },
    },
    { merge: true },
  );
}

interface RawStatusResponse {
  status?: string;
  unsubscribed?: boolean;
  isFounder?: boolean;
}

const VALID_STATUSES: MarketingContactStatus[] = [
  "granted",
  "pending",
  "revoked",
  "unknown",
  "no_contact",
];

function toView(raw: RawStatusResponse | null): MarketingConsentStatusView {
  const status = VALID_STATUSES.find((s) => s === raw?.status);
  return {
    // 모르는 값이 오면 "결정 안 함(unknown)" 으로 낙관하지 않는다 —
    // no_contact 로 접어 배너를 띄우지 않는 쪽이 안전하다.
    status: status ?? "no_contact",
    unsubscribed: raw?.unsubscribed === true,
    isFounder: raw?.isFounder === true,
  };
}

const getMyMarketingConsentStatusFn = httpsCallable<
  void,
  RawStatusResponse | null
>(functions, "getMyMarketingConsentStatus");

/**
 * 내 마케팅 컨택트 상태를 읽는다. 실패하면 null — 호출부는 이것을
 * "동의 안 했음" 으로 해석하면 안 된다(그냥 모르는 상태 → 배너 미노출).
 */
export async function fetchMarketingConsentStatus(): Promise<MarketingConsentStatusView | null> {
  try {
    const res = await getMyMarketingConsentStatusFn();
    return toView((res.data ?? null) as RawStatusResponse | null);
  } catch (err) {
    console.warn("[MarketingConsent] status fetch failed:", err);
    return null;
  }
}
