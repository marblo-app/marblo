/**
 * 데스크톱 → 웹 체크아웃 **계정 핸드오프 힌트** (티켓 3Notu54M).
 *
 * ─── 왜 필요한가 ────────────────────────────────────────────────────────
 *
 * 앱은 결제를 하지 않고 기본 브라우저의 웹 체크아웃으로 데려다준다
 * (lib/checkoutLink.ts). 그런데 데스크톱의 Firebase 세션과 OS 브라우저의
 * 세션은 완전히 별개다. 앱은 계정 A, 브라우저는 비로그인이거나 계정 B →
 * 사용자가 B 로 결제 → 서버는 `subscriptions/B` 에 쓴다 → 앱은
 * `subscribeToSubscription(A)` 를 듣고 있다 → **앱은 영원히 Free 다.**
 * 폴링·재조회로도 안 풀린다. 다른 문서를 보고 있으니까.
 *
 * 돈은 사라지지 않는다(B 에 권한이 정상 부여된다). 문제는 사람이 그걸 모른다는
 * 것이고, 링크에 "앱은 누구인가" 가 실려 있지 않으면 웹은 그걸 알 길이 없다.
 *
 * ─── 왜 원시 uid·이메일이 아니라 이 형태인가 ────────────────────────────
 *
 * URL 은 브라우저 이력·리퍼러·어깨너머로 남는다. 그래서 링크에는
 * **검증은 되지만 되돌릴 수는 없는** 값만 싣는다:
 *
 *   acct = `1.<nonce 16hex>.<sha256("marblo-checkout-account:<nonce>:<uid>") 앞 32hex>`
 *
 *   - 검증 가능: 웹은 로그인된 uid 로 같은 값을 재계산해 대조한다.
 *   - 불투명: uid 는 28자 난수라 해시에서 되돌릴 수 없다. 이메일은 아예 안 쓴다.
 *   - 비연결: nonce 가 링크마다 달라, 이력에 남은 두 링크가 같은 사람인지
 *     알 수 없다(안정된 가명 식별자가 되지 않는다).
 *   - 서버 없음: 토큰 발급 콜러블·만료 관리·새 컬렉션·보안 규칙이 필요 없다.
 *     이 값은 자격 증명이 아니라 "대조용 약속" 이라 만료가 보안에 영향을 주지
 *     않는다 — 오래된 링크라도 대조는 여전히 옳다.
 *
 * ★marblo-web/src/lib/checkoutAccountHint.ts 가 **같은 알고리즘**을 구현한다.
 * 두 저장소는 패키지를 공유하지 않으므로 같은 테스트 벡터를 양쪽 테스트에
 * 박아 어긋남을 잡는다(tests/lib/checkoutAccountHint.test.ts).
 *
 * 순수 계산만(의존성 0). WebCrypto 는 Electron 렌더러·브라우저·Node 18+ 에
 * 모두 있다.
 */

/** 웹 체크아웃 URL 의 쿼리 파라미터 이름. 웹과의 계약 — 바꾸면 양쪽을 같이. */
export const ACCOUNT_HINT_PARAM = "acct";

const VERSION = "1";
const DOMAIN_PREFIX = "marblo-checkout-account";
const NONCE_HEX_LEN = 16; // 8 bytes
const DIGEST_HEX_LEN = 32; // sha256 앞 128bit — 대조용으로 충분하고 URL 이 짧다

const HINT_RE = new RegExp(
  `^${VERSION}\\.([0-9a-f]{${NONCE_HEX_LEN}})\\.([0-9a-f]{${DIGEST_HEX_LEN}})$`,
);

/**
 * 웹이 힌트를 대조한 결과.
 *   - none:     힌트가 없다(웹에 직접 들어온 방문). 검사 대상이 아니다.
 *   - invalid:  형식이 깨졌다. mismatch 로 오판해 결제를 막지도, match 로
 *               통과시키지도 않는다 — 호출부가 none 처럼 다루되 로그를 남길 수 있다.
 *   - match:    앱 계정 = 브라우저 계정. 그대로 진행.
 *   - mismatch: 다르다. ★결제 전에 사람에게 보여줘야 한다.
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

/**
 * 앱 계정(uid)에 대한 핸드오프 힌트를 만든다.
 *
 * @param nonce 테스트용 고정값(16 hex). 프로덕션에서는 넘기지 않는다 —
 *              링크마다 새로 뽑아야 이력이 이어지지 않는다.
 */
export async function createAccountHint(
  uid: string,
  nonce: string = randomNonce(),
): Promise<string> {
  return `${VERSION}.${nonce}.${await digestFor(nonce, uid)}`;
}

/**
 * 힌트를 현재 로그인된 uid 와 대조한다. 절대 throw 하지 않는다 — 결제 진입에서
 * 예외로 화면이 죽는 것보다 invalid 한 글자가 낫다.
 */
export async function verifyAccountHint(
  hint: string | null | undefined,
  uid: string,
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
