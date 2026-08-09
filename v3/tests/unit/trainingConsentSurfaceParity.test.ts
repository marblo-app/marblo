/**
 * 심플 ↔ 어드밴스드 동의 표면 PARITY 가드 (ticket QFNrT4Z4dG9nGoRYmTlr).
 *
 * 지키는 성질: 학습데이터 기여 동의를 **양쪽 모드에서 똑같이** 물어본다.
 *   - 어드밴스드: App → Layout / WorkspaceShell → <GlobalOverlays/>
 *   - 심플:       App → BeginnerShell (GlobalOverlays 를 마운트하지 않는다)
 *
 * 심플 셸이 GlobalOverlays 를 안 태우는 것은 의도된 설계라(자체 셸 구성),
 * "GlobalOverlays 에만 넣으면 양쪽에 간다" 는 shell-global-overlays-parity 의
 * 보장이 여기서는 성립하지 않는다 — 그래서 별도 가드가 필요하다. 한쪽에만
 * 배선되면 "심플로 시작한 사용자는 기여 의사를 표명할 창구가 아예 없다" 가
 * 되고, 그건 동의 설계의 결함이지 UI 취향 문제가 아니다.
 *
 * 정적 소스 가드인 이유는 shell-global-overlays-parity 와 같다: 두 셸 모두
 * 앱 라이프사이클 훅 수십 개를 끌고 와서 실제 렌더에는 무거운 목킹이 필요하다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "../../src");

const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf-8");

const GLOBAL_OVERLAYS = read("components/GlobalOverlays.tsx");
const BEGINNER_SHELL = read("components/beginner/BeginnerShell.tsx");
const CARD = read("components/legal/TrainingConsentCard.tsx");

describe("학습데이터 기여 동의 표면 — 심플/어드밴스드 배선", () => {
  it("어드밴스드 셸 경로(GlobalOverlays)가 카드를 마운트한다", () => {
    expect(GLOBAL_OVERLAYS).toMatch(/<TrainingConsentCard\b/);
    expect(GLOBAL_OVERLAYS).toMatch(
      /import\s*\{\s*TrainingConsentCard\s*\}\s*from\s*["']\.\/legal\/TrainingConsentCard["']/,
    );
  });

  it("심플 셸(BeginnerShell)도 같은 카드를 마운트한다", () => {
    expect(BEGINNER_SHELL).toMatch(/<TrainingConsentCard\b/);
    expect(BEGINNER_SHELL).toMatch(
      /import\s*\{\s*TrainingConsentCard\s*\}\s*from\s*["']\.\.\/legal\/TrainingConsentCard["']/,
    );
  });

  it("두 표면은 같은 컴포넌트를 쓴다 (복제본 금지)", () => {
    // 파일이 하나뿐이라는 사실 자체가 문구·판정 드리프트를 막는다.
    expect(CARD).toMatch(/export function TrainingConsentCard/);
    for (const source of [GLOBAL_OVERLAYS, BEGINNER_SHELL]) {
      expect(source.match(/<TrainingConsentCard\b/g)?.length ?? 0).toBe(1);
    }
  });

  it("★심플 셸도 동의 게이트를 마운트한다 (카드의 전제조건)", () => {
    // PrivacyConsentGate 가 없으면 동의 레코드를 읽지도, 가입 전에 park 된 답을
    // flush 하지도 않는다 — 그러면 카드는 심플 모드에서 영원히 뜨지 않고(판정이
    // consentLoaded 에 걸려 있다), 그보다 먼저 동의 자체가 서버에 남지 않는다.
    expect(BEGINNER_SHELL).toMatch(/<PrivacyConsentGate\b/);
    expect(GLOBAL_OVERLAYS).toMatch(/<PrivacyConsentGate\b/);
  });

  it("노출 판정은 순수 함수 하나로만 내린다 (컴포넌트에 조건이 흩어지지 않는다)", () => {
    expect(CARD).toMatch(/shouldShowTrainingConsentCard\(/);
  });

  it("★기본값은 옵트인이 아니다 — 사용자가 누른 값만 저장한다", () => {
    // answer(true) / answer(false) 두 버튼이 같은 경로를 타고, 저장되는 값은
    // 인자 하나로 갈린다. `trainingDataCapture: true` 하드코딩이 생기면
    // "닫기 = 동의" 로 뒤집힐 수 있으므로 그 모양을 금지한다.
    expect(CARD).toMatch(/trainingDataCapture:\s*optIn/);
    expect(CARD).not.toMatch(/trainingDataCapture:\s*true/);
  });
});
