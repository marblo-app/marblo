/**
 * 학습데이터 기여 동의 — 노출 판정과 로컬 억제 규약 (ticket QFNrT4Z4dG9nGoRYmTlr).
 *
 * 여기서 지키는 성질은 "언제 물어보는가" 하나다. 컴포넌트 렌더가 아니라 순수
 * 함수를 검사하는 이유는 MarketingReconsentBanner 와 같다 — 판정이 UI 상태에
 * 흩어지면 "거부했는데 또 뜬다" 같은 회귀를 테스트로 못 잡는다.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  shouldShowTrainingConsentCard,
  rememberTrainingPromptDismissed,
  hasDismissedTrainingPrompt,
  trainingDismissKeyFor,
  TRAINING_CONSENT_VERSION,
  type TrainingConsentCardInput,
} from "../../src/services/trainingConsent";

/** vitest 환경(node)에는 localStorage 가 없다. */
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

const UID = "user-1";

/** 카드가 떠야 하는 기준 상태 — 각 테스트는 여기서 한 가지만 어긋뜨린다. */
const SHOWABLE: TrainingConsentCardInput = {
  uid: UID,
  consentLoaded: true,
  needsPolicyPrompt: false,
  alreadyOptedIn: false,
  alreadyPrompted: false,
  dismissedLocally: false,
  hasConnectedProject: true,
};

describe("shouldShowTrainingConsentCard", () => {
  it("PIPA 동의를 마치고 프로젝트를 연결한 신규 사용자에게 뜬다", () => {
    expect(shouldShowTrainingConsentCard(SHOWABLE)).toBe(true);
  });

  it("로그인 전(uid 없음)에는 뜨지 않는다", () => {
    expect(shouldShowTrainingConsentCard({ ...SHOWABLE, uid: null })).toBe(
      false,
    );
  });

  it("동의 레코드를 권위 있게 읽기 전에는 뜨지 않는다 (읽기 실패 ≠ 미동의)", () => {
    expect(
      shouldShowTrainingConsentCard({ ...SHOWABLE, consentLoaded: false }),
    ).toBe(false);
  });

  it("PIPA 필수 동의 모달이 떠야 하는 동안에는 뜨지 않는다 (겹침 금지)", () => {
    expect(
      shouldShowTrainingConsentCard({ ...SHOWABLE, needsPolicyPrompt: true }),
    ).toBe(false);
  });

  it("이미 기여를 켠 사람에게는 다시 묻지 않는다", () => {
    expect(
      shouldShowTrainingConsentCard({ ...SHOWABLE, alreadyOptedIn: true }),
    ).toBe(false);
  });

  it("★한 번 물어본 사람에게는 다시 묻지 않는다 — 거부한 경우에도", () => {
    expect(
      shouldShowTrainingConsentCard({ ...SHOWABLE, alreadyPrompted: true }),
    ).toBe(false);
  });

  it("이 기기에서 '나중에' 를 누르면 그 뒤로는 뜨지 않는다", () => {
    expect(
      shouldShowTrainingConsentCard({ ...SHOWABLE, dismissedLocally: true }),
    ).toBe(false);
  });

  it("아직 프로젝트를 연결하지 않은 빈 첫 화면에서는 뜨지 않는다", () => {
    expect(
      shouldShowTrainingConsentCard({
        ...SHOWABLE,
        hasConnectedProject: false,
      }),
    ).toBe(false);
  });
});

describe("로컬 '나중에' 기록", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage =
      new MemoryStorage() as unknown as Storage;
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("기록하면 같은 uid·같은 문안 버전에서 억제된다", () => {
    expect(hasDismissedTrainingPrompt(UID)).toBe(false);
    rememberTrainingPromptDismissed(UID);
    expect(hasDismissedTrainingPrompt(UID)).toBe(true);
  });

  it("다른 uid 의 기록은 서로 영향을 주지 않는다", () => {
    rememberTrainingPromptDismissed(UID);
    expect(hasDismissedTrainingPrompt("user-2")).toBe(false);
  });

  it("문안 버전이 올라가면 억제가 풀린다 (새 문안은 새로 물어볼 수 있어야 한다)", () => {
    rememberTrainingPromptDismissed(UID, "2020-01-01");
    expect(hasDismissedTrainingPrompt(UID, "2020-01-01")).toBe(true);
    expect(hasDismissedTrainingPrompt(UID, TRAINING_CONSENT_VERSION)).toBe(
      false,
    );
  });

  it("키는 uid 와 버전 양쪽으로 스코프된다", () => {
    expect(trainingDismissKeyFor(UID, "v1")).toBe(
      "marblo:trainingConsentDismissed:user-1:v1",
    );
  });

  it("localStorage 가 없어도 throw 하지 않는다 (best-effort)", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(() => rememberTrainingPromptDismissed(UID)).not.toThrow();
    expect(hasDismissedTrainingPrompt(UID)).toBe(false);
  });
});
