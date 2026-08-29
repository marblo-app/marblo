/**
 * "왜 멈췄나" 문항의 판정부 (티켓 CkVKKGI8wZZPGfyVvH6c · #1310 처방 3).
 *
 * 여기서 지키는 성질은 넷이다:
 *  ① 7일 미만 공백에는 **묻지 않는다** — 주말+며칠로 한 번뿐인 질문을 태우지 않는다.
 *  ② 설치당 1회 — 문면이 "다시 나오지 않습니다" 라고 약속했고 코드가 지킨다.
 *  ③ 텔레메트리 동의가 꺼져 있으면 아예 묻지 않는다 — 답을 못 받는 질문은 연극이다.
 *  ④ 한 실행에서 두 번 계산해도 같은 공백이 나온다 — 재마운트가 공백을 0 으로
 *    뭉개면 질문은 영원히 안 뜬다(이 가드가 없으면 조용히 죽는 종류의 버그다).
 */
import { describe, expect, it } from "vitest";
import {
  PAUSE_REASON_CODES,
  PAUSE_REASON_GAP_DAYS,
  PAUSE_REASON_NOTE_MAX,
  PAUSE_REASON_OPTIONS,
  PAUSE_REASON_STORAGE_KEYS,
  gapDaysSince,
  hasAskedPauseReason,
  isPauseReasonCode,
  markPauseReasonAsked,
  resolveOpenGapDays,
  sanitizePauseNote,
  shouldAskPauseReason,
  type PauseReasonStorage,
} from "../../src/lib/pauseReasonPrompt";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 29, 3, 0, 0);

function memoryStorage(seed: Record<string, string> = {}): PauseReasonStorage {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("공백 계산", () => {
  it("마지막 실행 이후 경과일을 내림으로 센다", () => {
    expect(gapDaysSince(NOW - 7 * DAY, NOW)).toBe(7);
    expect(gapDaysSince(NOW - (7 * DAY - 1), NOW)).toBe(6);
    expect(gapDaysSince(NOW - 9 * DAY - 5 * 60 * 1000, NOW)).toBe(9);
  });

  it("기록이 없으면 null — 첫 실행은 멈춘 적이 없다", () => {
    expect(gapDaysSince(null, NOW)).toBeNull();
  });

  it("시계가 거꾸로 갔으면 null — 거짓 값 위에서 묻지 않는다", () => {
    expect(gapDaysSince(NOW + 3 * DAY, NOW)).toBeNull();
  });

  it("첫 실행은 공백을 만들지 않고 시각만 남긴다", () => {
    const local = memoryStorage();
    expect(resolveOpenGapDays(local, memoryStorage(), NOW)).toBeNull();
    expect(local.getItem(PAUSE_REASON_STORAGE_KEYS.lastOpenedAt)).toBe(
      String(NOW),
    );
  });

  it("★한 실행에서 두 번 불려도 같은 공백을 준다 (재마운트 방어)", () => {
    const local = memoryStorage({
      [PAUSE_REASON_STORAGE_KEYS.lastOpenedAt]: String(NOW - 12 * DAY),
    });
    const session = memoryStorage();

    expect(resolveOpenGapDays(local, session, NOW)).toBe(12);
    // 두 번째 호출은 방금 자기가 쓴 lastOpenedAt(=NOW)을 읽어 0 이 될 자리다.
    expect(resolveOpenGapDays(local, session, NOW)).toBe(12);
  });

  it("다음 실행(새 세션)에서는 갱신된 시각으로 다시 센다", () => {
    const local = memoryStorage({
      [PAUSE_REASON_STORAGE_KEYS.lastOpenedAt]: String(NOW - 12 * DAY),
    });
    resolveOpenGapDays(local, memoryStorage(), NOW);
    expect(resolveOpenGapDays(local, memoryStorage(), NOW + 2 * DAY)).toBe(2);
  });

  it("null 공백도 세션에 캐시된다 (첫 실행 뒤 재마운트가 0 을 만들지 않는다)", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    expect(resolveOpenGapDays(local, session, NOW)).toBeNull();
    expect(resolveOpenGapDays(local, session, NOW)).toBeNull();
  });
});

describe("노출 판정", () => {
  const base = {
    gapDays: 9,
    alreadyAsked: false,
    telemetryEnabled: true,
  };

  it("7일 이상 공백에서 묻는다", () => {
    expect(shouldAskPauseReason({ ...base, gapDays: 7 })).toBe(true);
    expect(shouldAskPauseReason({ ...base, gapDays: 40 })).toBe(true);
  });

  it("★7일 미만에는 묻지 않는다 — 주말 리듬에 한 번뿐인 질문을 태우지 않는다", () => {
    for (const gapDays of [0, 1, 2, 3, 4, 5, 6]) {
      expect(shouldAskPauseReason({ ...base, gapDays })).toBe(false);
    }
    expect(PAUSE_REASON_GAP_DAYS).toBe(7);
  });

  it("★설치당 1회 — 이미 물었으면 공백이 아무리 커도 다시 묻지 않는다", () => {
    expect(
      shouldAskPauseReason({ ...base, gapDays: 120, alreadyAsked: true }),
    ).toBe(false);
  });

  it("★텔레메트리 동의가 꺼져 있으면 묻지 않는다", () => {
    expect(shouldAskPauseReason({ ...base, telemetryEnabled: false })).toBe(
      false,
    );
  });

  it("다른 모달이 화면을 잡고 있으면 이번 실행에는 묻지 않는다", () => {
    expect(shouldAskPauseReason({ ...base, blocked: true })).toBe(false);
  });

  it("공백을 모르면 묻지 않는다 (첫 실행 · 시계 역주행)", () => {
    expect(shouldAskPauseReason({ ...base, gapDays: null })).toBe(false);
  });

  it("답해도 닫아도 같은 마커를 찍는다", () => {
    const storage = memoryStorage();
    expect(hasAskedPauseReason(storage)).toBe(false);
    markPauseReasonAsked(storage);
    expect(hasAskedPauseReason(storage)).toBe(true);
  });
});

describe("선택지 어휘", () => {
  it("6칸이고 코드가 중복되지 않는다 — n=5 에서도 세어지는 크기", () => {
    expect(PAUSE_REASON_OPTIONS).toHaveLength(6);
    const codes = PAUSE_REASON_OPTIONS.map((o) => o.code);
    expect(new Set(codes).size).toBe(6);
    expect(codes).toEqual([...PAUSE_REASON_CODES]);
  });

  it("★제품 탓이 아닌 선택지가 맨 앞이다 (유도 방지)", () => {
    expect(PAUSE_REASON_OPTIONS[0].code).toBe("no_need");
  });

  it("각 칸이 서로 다른 문구 키를 가리킨다", () => {
    const keys = PAUSE_REASON_OPTIONS.map((o) => o.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key.startsWith("retention.pauseReason.option.")).toBe(true);
    }
  });

  it("모르는 코드는 코드로 인정하지 않는다", () => {
    expect(isPauseReasonCode("cost")).toBe(true);
    expect(isPauseReasonCode("angry")).toBe(false);
    expect(isPauseReasonCode(null)).toBe(false);
  });
});

describe("한 줄 메모", () => {
  it("공백을 정규화하고 앞뒤를 자른다", () => {
    expect(sanitizePauseNote("  다른  도구를\n  썼다 ")).toBe(
      "다른 도구를 썼다",
    );
  });

  it("빈 입력은 빈 문자열 — 호출부가 전송을 건너뛸 수 있어야 한다", () => {
    expect(sanitizePauseNote("   \n\t ")).toBe("");
  });

  it("상한을 넘기면 자른다 (문단을 받는 칸이 아니다)", () => {
    const long = "가".repeat(PAUSE_REASON_NOTE_MAX + 50);
    expect(sanitizePauseNote(long)).toHaveLength(PAUSE_REASON_NOTE_MAX);
  });
});
