/**
 * 처리방침 1회성 명확화 고지 — 노출 판정 + 로컬 억제 (ticket woXp2c70oR0tliGB8Vs6).
 *
 * ★이 배너의 핵심 성질은 "동의를 받지 않는다" 다. 그래서 여기서 지키는 것은
 * 노출/억제 규칙과, 배너가 어떤 동의 write 경로도 갖지 않는다는 구조적 사실이다.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  PRIVACY_CLARIFICATION_VERSION,
  hasSeenPrivacyClarification,
  privacyClarificationKeyFor,
  rememberPrivacyClarificationSeen,
  shouldShowPrivacyClarification,
} from "../../src/services/privacyClarification";

/** vitest 환경(node)에는 localStorage 가 없다 (trainingConsent.test.ts 와 동일). */
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null;
  }
}

const base = {
  uid: "u1",
  consentLoaded: true,
  needsPolicyPrompt: false,
  dismissedLocally: false,
};

describe("shouldShowPrivacyClarification", () => {
  it("로그인·동의로드 완료 + 미열람이면 뜬다", () => {
    expect(shouldShowPrivacyClarification(base)).toBe(true);
  });

  it("uid 가 없으면 뜨지 않는다 (로그인 전·에이전트 신원)", () => {
    expect(shouldShowPrivacyClarification({ ...base, uid: null })).toBe(false);
  });

  it("동의 레코드를 아직 못 읽었으면 뜨지 않는다 (모름 ≠ 안 봤음)", () => {
    expect(
      shouldShowPrivacyClarification({ ...base, consentLoaded: false }),
    ).toBe(false);
  });

  it("★PIPA 동의 모달이 떠야 하는 사람에겐 뜨지 않는다", () => {
    // 그 사람은 지금 최신 전문을 통째로 읽고 동의하는 중이라 알릴 '변경' 이 없다.
    expect(
      shouldShowPrivacyClarification({ ...base, needsPolicyPrompt: true }),
    ).toBe(false);
  });

  it("이 기기에서 닫았으면 다시 뜨지 않는다", () => {
    expect(
      shouldShowPrivacyClarification({ ...base, dismissedLocally: true }),
    ).toBe(false);
  });
});

describe("로컬 억제 기록", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage =
      new MemoryStorage() as unknown as Storage;
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("닫으면 같은 uid·같은 버전에서 다시 뜨지 않는다", () => {
    expect(hasSeenPrivacyClarification("u1")).toBe(false);
    rememberPrivacyClarificationSeen("u1");
    expect(hasSeenPrivacyClarification("u1")).toBe(true);
  });

  it("uid 별로 분리된다 (기기를 공유해도 남의 열람이 내 고지를 삼키지 않는다)", () => {
    rememberPrivacyClarificationSeen("u1");
    expect(hasSeenPrivacyClarification("u2")).toBe(false);
  });

  it("★고지 버전이 오르면 다시 뜬다 (억제 키에 버전이 들어간다)", () => {
    rememberPrivacyClarificationSeen("u1", "2026-08-10");
    expect(hasSeenPrivacyClarification("u1", "2026-08-10")).toBe(true);
    expect(hasSeenPrivacyClarification("u1", "2026-09-01")).toBe(false);
  });

  it("빈 uid/버전은 아무것도 쓰지 않고 false 를 돌려준다", () => {
    rememberPrivacyClarificationSeen("", "v");
    rememberPrivacyClarificationSeen("u1", "");
    expect(hasSeenPrivacyClarification("", "v")).toBe(false);
    expect(hasSeenPrivacyClarification("u1", "")).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("키는 uid·버전으로 네임스페이스된다", () => {
    expect(privacyClarificationKeyFor("u1", "2026-08-10")).toBe(
      "marblo:privacyClarificationSeen:u1:2026-08-10",
    );
    expect(PRIVACY_CLARIFICATION_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("localStorage 가 없어도 throw 하지 않는다 (best-effort)", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(() => rememberPrivacyClarificationSeen("u1")).not.toThrow();
    expect(hasSeenPrivacyClarification("u1")).toBe(false);
  });
});

describe("★고지 배너는 동의를 받지 않는다 (구조 가드)", () => {
  const SRC = path.resolve(__dirname, "../../src");
  const NOTICE = readFileSync(
    path.join(SRC, "components/legal/PrivacyClarificationNotice.tsx"),
    "utf-8",
  );

  it("동의 저장 경로(save/consent write)를 갖지 않는다", () => {
    // 동의 write 가 생기는 순간 "닫기 = 동의" 로 오독될 수 있는 배너가 된다.
    // 그 축은 PrivacyConsentModal / TrainingConsentCard 의 몫이다.
    expect(NOTICE).not.toMatch(/\bsave\s*\(/);
    expect(NOTICE).not.toMatch(/ConsentFlags/);
    expect(NOTICE).not.toMatch(/<input\b/);
  });

  it("노출 판정은 순수 함수 하나로만 내린다", () => {
    expect(NOTICE).toMatch(/shouldShowPrivacyClarification\(/);
  });

  it("정책 버전(CURRENT_POLICY_VERSION)을 import 하지 않는다", () => {
    // 이 배너의 존재 이유가 "버전을 올리지 않고 알린다" 이므로, 정책 버전을
    // 코드로 끌어다 쓰기 시작하면 설계가 뒤집힌 것이다(주석 언급은 무방).
    expect(NOTICE).not.toMatch(/^\s*import[\s\S]*CURRENT_POLICY_VERSION/m);
    expect(NOTICE).not.toMatch(/privacyConsentService/);
  });
});

describe("★2차 고지 — 버전을 안 올린 대신 배너가 뜬다 (ticket vilkbSrnzbAv4ezbZMRT)", () => {
  const SRC = path.resolve(__dirname, "../../src");
  const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf-8");

  it("고지 버전이 1차(2026-08-10)보다 뒤다 — 이미 닫은 사람에게도 한 번 더 뜬다", () => {
    // 사장님 결정(2026-08-21): CURRENT_POLICY_VERSION 은 올리지 않는다. 그러면
    // 이 배너가 **유일한 고지 경로**가 된다. 버전을 되돌리면 "약속을 거뒀는데
    // 아무도 모르는" 상태가 되므로 여기서 막는다. ISO 날짜라 사전순 비교가 곧
    // 시간순 비교다.
    expect(PRIVACY_CLARIFICATION_VERSION > "2026-08-10").toBe(true);
  });

  it("CURRENT_POLICY_VERSION 은 올리지 않았다 — 전 사용자 재동의 모달을 띄우지 않는다", () => {
    // 이 두 축이 같이 움직이면 "고지하려다 전 사용자 재동의" 가 된다.
    expect(read("services/privacyConsentService.ts")).toMatch(
      /CURRENT_POLICY_VERSION = "2026-06-01"/,
    );
  });

  it("ko·en 배너 문구가 같은 사실을 말한다 — 약속 철회 + 가명 구분값", () => {
    const ko = read("locales/ko/legal.ts");
    const en = read("locales/en/legal.ts");
    const koBody = /"legal\.clarification\.body":\s*\n?\s*"([^"]+)"/.exec(ko)?.[1];
    const enBody = /"legal\.clarification\.body":\s*\n?\s*"([^"]+)"/.exec(en)?.[1];
    expect(koBody).toBeTruthy();
    expect(enBody).toBeTruthy();

    // (1) 약속을 거둔다는 사실이 양쪽에 있다.
    expect(koBody).toMatch(/거둡니다/);
    expect(enBody).toMatch(/taking that back/);
    // (2) 무엇이 새로 적히는지가 양쪽에 있다.
    expect(koBody).toMatch(/가명 구분값/);
    expect(enBody).toMatch(/pseudonymous key/);
    // (3) 과장 금지 — 계정 식별자 자체는 저장하지 않는다는 한 줄도 양쪽에 있다.
    expect(koBody).toMatch(/계정 식별자 자체는 여전히 저장하지 않/);
    expect(enBody).toMatch(/account identifier itself is still never stored/);
  });

  it("문구가 개발 용어로 새지 않는다 (이용자 언어 — #1080 ③안 규약)", () => {
    const bodies = [read("locales/ko/legal.ts"), read("locales/en/legal.ts")].map(
      (f) => /"legal\.clarification\.body":\s*\n?\s*"([^"]+)"/.exec(f)?.[1] ?? "",
    );
    for (const body of bodies) {
      expect(body).not.toMatch(/HMAC|솔트|\bsalt\b|조인 키|join key|user_key/i);
    }
  });

  it("첫 절이 잘리지 않는다 — truncate 로는 약속 철회가 화면에 안 남는다", () => {
    // 본문 첫 절이 이번 고지의 전부다. 한 줄 truncate 로 돌리면 배너는 떠도
    // 알리는 일은 실패한다.
    const notice = read("components/legal/PrivacyClarificationNotice.tsx");
    const bodySpan = /<span className="([^"]*)">\s*\{t\("legal\.clarification\.body"\)\}/
      .exec(notice)?.[1];
    expect(bodySpan).toBeTruthy();
    expect(bodySpan).toMatch(/line-clamp-2/);
    expect(bodySpan).not.toMatch(/truncate/);
  });
});
