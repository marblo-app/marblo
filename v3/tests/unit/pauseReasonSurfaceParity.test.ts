/**
 * "왜 멈췄나" 문항의 **배선·경계** 가드 (티켓 CkVKKGI8wZZPGfyVvH6c · #1310 처방 3).
 *
 * 정적 소스 가드인 이유는 trainingConsentSurfaceParity 와 같다: 두 셸 모두 앱
 * 라이프사이클 훅 수십 개를 끌고 와서 실제 렌더에는 무거운 목킹이 필요하다.
 *
 * 지키는 성질 넷:
 *  ① 심플·어드밴스드 **양쪽**에 배선돼 있다. 한쪽만 걸면 표본이 반으로 잘린다 —
 *    #1310 이 관측한 즉시 소멸 설치 3건(E·F·G)이 정확히 심플로 시작한 모양이다.
 *  ② 새 이벤트가 **잔존 계산을 오염시키지 않는다.** 이 이벤트는 정의상 "멈췄다가
 *    돌아온 날" 에만 나므로, 빼지 않으면 이탈을 답한 행동이 잔존으로 계상된다.
 *  ③ 자유서술은 **텔레메트리로 가지 않는다**(scrub.ts USER_INPUT_KEY 규율).
 *  ④ 문면이 구걸하거나 죄책감을 주지 않는다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const V3 = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(V3, rel), "utf-8");

const GLOBAL_OVERLAYS = read("src/components/GlobalOverlays.tsx");
const BEGINNER_SHELL = read("src/components/beginner/BeginnerShell.tsx");
const PROMPT = read("src/components/retention/PauseReasonPrompt.tsx");
const TELEMETRY = read("src/services/telemetryService.ts");
const FUNCTIONS_INDEX = read("functions/src/index.ts");

describe("배선 — 심플/어드밴스드 파리티", () => {
  it("어드밴스드 셸 경로(GlobalOverlays)가 문항을 마운트한다", () => {
    expect(GLOBAL_OVERLAYS).toMatch(/<PauseReasonPrompt\b/);
    expect(GLOBAL_OVERLAYS).toMatch(
      /import\s*\{\s*PauseReasonPrompt\s*\}\s*from\s*["']\.\/retention\/PauseReasonPrompt["']/,
    );
  });

  it("★심플 셸(BeginnerShell)도 같은 문항을 마운트한다", () => {
    expect(BEGINNER_SHELL).toMatch(/<PauseReasonPrompt\b/);
    expect(BEGINNER_SHELL).toMatch(
      /import\s*\{\s*PauseReasonPrompt\s*\}\s*from\s*["']\.\.\/retention\/PauseReasonPrompt["']/,
    );
  });

  it("두 표면은 같은 컴포넌트를 쓴다 (복제본 금지)", () => {
    expect(PROMPT).toMatch(/export function PauseReasonPrompt/);
    for (const source of [GLOBAL_OVERLAYS, BEGINNER_SHELL]) {
      expect(source.match(/<PauseReasonPrompt\b/g)?.length ?? 0).toBe(1);
    }
  });

  it("노출 판정은 순수 함수 하나로만 내린다 (조건이 컴포넌트에 흩어지지 않는다)", () => {
    expect(PROMPT).toMatch(/shouldAskPauseReason\(/);
    // 판정 분기를 컴포넌트가 직접 쓰지 않는다 — 임계값·마커 비교가 여기 나오면
    // 두 셸의 노출 조건이 조용히 갈릴 수 있다.
    expect(PROMPT).not.toMatch(/PAUSE_REASON_GAP_DAYS/);
    expect(PROMPT.match(/shouldAskPauseReason\(/g)?.length ?? 0).toBe(1);
  });

  it("같은 모서리를 쓰는 경험 설문이 이번 실행에는 물러선다", () => {
    expect(GLOBAL_OVERLAYS).toMatch(
      /<FirstProjectSurvey[\s\S]*?pauseReasonVisible/,
    );
  });
});

describe("★잔존 계산 오염 방지", () => {
  it("코크핏 잔존 제외 목록에 등록돼 있다", () => {
    const block = FUNCTIONS_INDEX.match(
      /const KPI_RETENTION_EXCLUDED_EVENTS[\s\S]*?\n\];/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).toContain('"retention:pause_reason"');
  });

  it("퍼널 제외 목록에는 넣지 않는다 (그 raw 스캔은 이미 화이트리스트다)", () => {
    const block = FUNCTIONS_INDEX.match(
      /const FUNNEL_EVENTS_EXCLUDED_FROM_RETENTION[\s\S]*?\n\];/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).not.toContain("retention:pause_reason");
  });

  it("이벤트 종류를 하나만 늘렸다", () => {
    const added = TELEMETRY.match(/"retention:[a-z_]+"/g) ?? [];
    expect(new Set(added)).toEqual(new Set(['"retention:pause_reason"']));
  });
});

describe("★동의 경계 — 자유서술은 텔레메트리로 가지 않는다", () => {
  it("텔레메트리 헬퍼는 길이·전달여부만 받는다 (산문 필드가 없다)", () => {
    const helper = TELEMETRY.match(/pauseReasonPrompt\([\s\S]*?\n {2}\},/)?.[0];
    expect(helper).toBeDefined();
    expect(helper!).toContain("noteLength");
    expect(helper!).not.toMatch(/\bnote\s*:\s*string/);
  });

  it("컴포넌트는 산문을 전용 callable 로만 보낸다", () => {
    expect(PROMPT).toMatch(/submitPauseReason\(\{[\s\S]*?note: clean/);
    // 텔레메트리 호출에 실리는 것은 길이뿐이다.
    for (const call of PROMPT.match(
      /telemetry\.pauseReasonPrompt\([\s\S]*?\);/g,
    ) ?? []) {
      expect(call).not.toMatch(/note:\s*(clean|note)\b/);
    }
  });

  it("동의가 꺼져 있으면 묻지 않는다", () => {
    expect(PROMPT).toMatch(/telemetryEnabled:\s*isTelemetryEnabled\(\)/);
  });

  it("서버는 선택지 코드를 화이트리스트로 검증한다", () => {
    expect(FUNCTIONS_INDEX).toMatch(/PAUSE_REASON_CODES\.includes\(reason\)/);
    expect(FUNCTIONS_INDEX).toMatch(/redactSecrets\(\s*\n?\s*data\.note/);
  });
});

describe("★문면 — 구걸하지도, 죄책감을 주지도 않는다", () => {
  const ko = read("src/locales/ko/retention.ts");
  const en = read("src/locales/en/retention.ts");

  it("안 답할 자유와 재노출 없음을 명시한다", () => {
    expect(ko).toContain("답하지 않아도 됩니다");
    expect(ko).toContain("다시 나오지 않습니다");
    expect(en).toContain("You don't have to answer");
  });

  it("구걸·죄책감·보상 문구가 없다", () => {
    for (const source of [ko, en]) {
      // 주석까지 포함해 검사한다 — 규율을 적어 둔 헤더에도 예시로 넣지 않는다.
      const values = source
        .split("\n")
        .filter((line) => /^\s*"retention\./.test(line) || /^\s{4}"/.test(line))
        .join("\n");
      expect(values).not.toMatch(
        /부탁|도움이 됩니다|아쉽|죄송|5초|please|sorry/i,
      );
      expect(values).not.toMatch(/무료|리워드|reward|free month|coupon/i);
    }
  });

  it("한 번에 하나만 묻는다 (물음표가 하나뿐인 단일 문항)", () => {
    const title = ko.match(
      /"retention\.pauseReason\.title":\s*\n?\s*"([^"]+)"/,
    );
    expect(title).not.toBeNull();
    expect(title![1].match(/\?/g)?.length ?? 0).toBe(1);
  });
});
