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

describe("★2·3·4차 고지 — 버전을 안 올린 대신 배너가 뜬다 (vilkbSrnzbAv4ezbZMRT / O9iJMtgGy5glQ2oESvRN / cn8T9fSM4N0tte3ko8Df)", () => {
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

  it("ko·en 배너 문구가 같은 사실을 말한다 — 누가·무엇을·무엇은 아닌지·언제부터 + 1회 노출", () => {
    const ko = read("locales/ko/legal.ts");
    const en = read("locales/en/legal.ts");
    const koBody = /"legal\.clarification\.body":\s*\n?\s*"([^"]+)"/.exec(
      ko,
    )?.[1];
    const enBody = /"legal\.clarification\.body":\s*\n?\s*"([^"]+)"/.exec(
      en,
    )?.[1];
    expect(koBody).toBeTruthy();
    expect(enBody).toBeTruthy();

    // ★4차(cn8T9fSM4N0tte3ko8Df)로 문구가 교체됐다. 3차까지의 축(약속 철회 —
    // "거둡니다"/"taking that back")은 이 배너가 그 고지를 이미 마쳤으므로 더
    // 이상 고정하지 않는다. 대신 이번 고지가 반드시 담아야 하는 넷을 고정한다.
    // (완료 기준: 누가 · 무엇을 · 무엇은 아닌지 · 언제부터)

    // (1) 누가 보는가 — 관리자다. "회사가 본다" 가 아니라는 게 요점이다.
    expect(koBody).toMatch(/관리자/);
    expect(enBody).toMatch(/administrator/);
    // (2) 무엇을 보는가 — 사용량(토큰·비용·작업 수).
    expect(koBody).toMatch(/사용량/);
    expect(koBody).toMatch(/토큰/);
    expect(enBody).toMatch(/usage/);
    expect(enBody).toMatch(/tokens/);
    // (3) ★무엇은 아닌지 — 코드·프롬프트·응답 원문 제외. 이 한 줄이 빠지면
    //     사용자는 관리자가 자기 코드를 본다고 읽는다. 과소고지의 반대쪽 사고다.
    expect(koBody).toMatch(/코드·프롬프트·응답 원문은 포함되지 않/);
    expect(enBody).toMatch(/does not include code, prompts, or raw responses/);
    // (4) ★언제부터 — 발효일이 문구에 있어야 한다. 사전 통지의 핵심이 날짜다
    //     (고지 배포일 2026-08-31 + 7일, 사장님 결정 "1번 승인 7일로").
    expect(koBody).toMatch(/2026년 9월 7일/);
    expect(enBody).toMatch(/2026-09-07/);
    // (5) 과장 금지 — 새로 받는 정보는 없다는 한 줄도 양쪽에 있다.
    expect(koBody).toMatch(/새로 받는 정보는 없/);
    expect(enBody).toMatch(/collect nothing new/);
    // (6) ★1회만 뜨고 다시 안 뜬다는 것이 문구에서 분명해야 한다.
    expect(koBody).toMatch(/한 번만 보여드리고 다시 뜨지 않습니다/);
    expect(enBody).toMatch(/once and it will not come back/);
  });

  it("★발효일이 세 자리에서 같다 — 배너·앱 방침·웹 방침 (갈리면 어느 쪽이 약속인지 모른다)", () => {
    // 고지 문구가 말하는 날짜와 방침 본문이 말하는 날짜가 갈리면, 사전 통지가
    // 통지한 날이 언제인지 다투게 된다. 배포 env(TEAM_USAGE_EFFECTIVE_FROM)는
    // 여기서 볼 수 없으므로(런타임 값), 문서 셋만 여기서 묶는다.
    const koLegal = read("locales/ko/legal.ts");
    const enLegal = read("locales/en/legal.ts");
    const content = read("components/legal/privacyContent.tsx");
    const web = readFileSync(
      path.resolve(
        __dirname,
        "../../../marblo-web/src/app/[locale]/legal/privacy/page.tsx",
      ),
      "utf-8",
    );
    expect(koLegal).toContain("2026년 9월 7일");
    expect(enLegal).toContain("2026-09-07");
    expect(content).toContain("2026년 9월 7일");
    expect(content).toContain("2026-09-07");
    expect(web).toContain('TEAM_USAGE_EFFECTIVE_FROM = "2026-09-07"');
  });

  it("★앱 방침 문면이 넷을 다 담는다 — 누가·무엇을·무엇은 아닌지·언제부터 (ko/en)", () => {
    // 배너는 1회성이고 끄면 사라진다. 남아 있는 문서는 방침 본문이므로, 넷은
    // 배너가 아니라 여기서 항구적으로 고정한다.
    const content = read("components/legal/privacyContent.tsx");
    // ko
    expect(content).toMatch(/팀 요금제를 쓰신다면, 2026년 9월 7일부터/);
    expect(content).toMatch(/프로젝트의 관리자와 그 프로젝트가 결합된 조직의 관리자/);
    expect(content).toMatch(/모델별 토큰 수·사용량 환산 비용\(추정\)·완료·실패한 작업 수/);
    expect(content).toMatch(/이때도 코드·프롬프트·응답 원문은 포함되지 않습니다/);
    // en
    expect(content).toMatch(/starting 2026-09-07 the administrator of the/);
    expect(content).toMatch(/tokens per model, estimated usage-based cost/);
    expect(content).toMatch(
      /never includes code, prompts, or raw\s+responses/,
    );
  });

  it("문구가 개발 용어로 새지 않는다 (이용자 언어 — #1080 ③안 규약)", () => {
    const bodies = [
      read("locales/ko/legal.ts"),
      read("locales/en/legal.ts"),
    ].map(
      (f) =>
        /"legal\.clarification\.body":\s*\n?\s*"([^"]+)"/.exec(f)?.[1] ?? "",
    );
    for (const body of bodies) {
      expect(body).not.toMatch(/HMAC|솔트|\bsalt\b|조인 키|join key|user_key/i);
    }
  });

  it("첫 절이 잘리지 않는다 — truncate 로는 약속 철회가 화면에 안 남는다", () => {
    // 본문 첫 절이 이번 고지의 전부다. 한 줄 truncate 로 돌리면 배너는 떠도
    // 알리는 일은 실패한다.
    const notice = read("components/legal/PrivacyClarificationNotice.tsx");
    const bodySpan =
      /<span className="([^"]*)">\s*\{t\("legal\.clarification\.body"\)\}/.exec(
        notice,
      )?.[1];
    expect(bodySpan).toBeTruthy();
    expect(bodySpan).toMatch(/line-clamp-2/);
    expect(bodySpan).not.toMatch(/truncate/);
  });
});
