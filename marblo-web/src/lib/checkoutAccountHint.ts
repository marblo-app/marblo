/**
 * 데스크톱 앱 → 웹 체크아웃 **계정 핸드오프 힌트** 검증 (티켓 3Notu54M).
 *
 * 데스크톱 앱은 결제를 하지 않고 기본 브라우저의 이 /checkout 으로 데려다준다.
 * 그런데 앱의 Firebase 세션과 브라우저의 세션은 별개다 — 앱은 계정 A,
 * 브라우저는 비로그인이거나 계정 B. 사용자가 B 로 결제하면 서버는
 * subscriptions/B 에 쓰고, 앱은 subscriptions/A 를 듣고 있어 **앱은 영원히
 * Free 다.** 돈은 사라지지 않지만(B 에 정상 부여) 사람이 그걸 모른다.
 *
 * 그래서 앱은 링크에 `acct=1.<nonce>.<digest>` 를 실어 보낸다:
 *   digest = sha256("marblo-checkout-account:<nonce>:<uid>") 앞 32 hex
 * ★원시 uid·이메일이 아니다(브라우저 이력·리퍼러에 남는다). 되돌릴 수 없고,
 * nonce 가 링크마다 달라 이력 상 서로 이어지지도 않는다. 웹은 로그인된 uid 로
 * 같은 값을 재계산해 대조만 한다 — 서버 호출도, 발급 토큰도, 만료도 없다.
 *
 * ★v3/src/lib/checkoutAccountHint.ts 가 **같은 알고리즘**의 생성측이다. 두
 * 저장소는 패키지를 공유하지 않으므로 같은 테스트 벡터를 양쪽 테스트에 박아
 * 어긋남을 잡는다(checkoutAccountHint.test.ts).
 */

/** 쿼리 파라미터 이름. 데스크톱과의 계약 — 바꾸면 양쪽을 같이. */
export const ACCOUNT_HINT_PARAM = "acct";

const VERSION = "1";
const DOMAIN_PREFIX = "marblo-checkout-account";
const NONCE_HEX_LEN = 16;
const DIGEST_HEX_LEN = 32;

const HINT_RE = new RegExp(
  `^${VERSION}\\.([0-9a-f]{${NONCE_HEX_LEN}})\\.([0-9a-f]{${DIGEST_HEX_LEN}})$`
);

/**
 *   - none:     힌트 없음(웹에 직접 들어온 방문). 검사 대상이 아니다.
 *   - invalid:  형식이 깨짐. mismatch 로 오판해 막지도, match 로 통과시키지도 않는다.
 *   - match:    앱 계정 = 브라우저 계정.
 *   - mismatch: 다르다. ★결제 전에 사람에게 보여준다.
 */
export type AccountHintVerdict = "none" | "invalid" | "match" | "mismatch";

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const b of view) out += b.toString(16).padStart(2, "0");
  return out;
}

async function digestFor(nonce: string, uid: string): Promise<string> {
  const data = new TextEncoder().encode(`${DOMAIN_PREFIX}:${nonce}:${uid}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return toHex(hash).slice(0, DIGEST_HEX_LEN);
}

function randomNonce(): string {
  const bytes = new Uint8Array(NONCE_HEX_LEN / 2);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** 생성측(데스크톱)과 같은 함수 — 웹에서는 테스트 벡터 대조에만 쓴다. */
export async function createAccountHint(
  uid: string,
  nonce: string = randomNonce()
): Promise<string> {
  return `${VERSION}.${nonce}.${await digestFor(nonce, uid)}`;
}

/** 절대 throw 하지 않는다 — 결제 진입에서 예외로 죽는 것보다 invalid 가 낫다. */
export async function verifyAccountHint(
  hint: string | null | undefined,
  uid: string
): Promise<AccountHintVerdict> {
  if (hint == null) return "none";
  const m = HINT_RE.exec(hint);
  if (!m) return "invalid";
  const [, nonce, digest] = m;
  try {
    return (await digestFor(nonce, uid)) === digest ? "match" : "mismatch";
  } catch {
    return "invalid";
  }
}

/**
 * 결제 폼을 가리고 "어느 계정으로 결제할지" 부터 묻는가.
 * mismatch 이고 사용자가 아직 고르지 않았을 때만 true — 힌트 없음/깨짐/일치는
 * 기존 흐름 그대로다(회귀 0).
 */
export function shouldBlockCheckout(
  verdict: AccountHintVerdict,
  acknowledged: boolean
): boolean {
  return verdict === "mismatch" && !acknowledged;
}
