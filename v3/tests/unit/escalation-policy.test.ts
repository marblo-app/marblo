// P5-3 에스컬레이션 판정 기준 — 설계문서 §6-2 를 실행 가능한 규칙으로 고정한다.
//
// 이 파일이 곧 "판정 기준" 의 정본이다(티켓 완료기준 "판정기준 유닛"). 문장으로만
// 적힌 기준은 사람마다 다르게 읽히지만, 아래 표는 어긋나면 깨진다.
//
// 특히 두 방향의 오검출을 같은 무게로 본다:
//   - **과소 승격**: 사장님만 답할 수 있는 것(비용·비가역·제품판단)을 오케가
//     추측으로 때우는 것. 가장 비싼 실패.
//   - **과잉 승격**: 코드베이스에서 답이 나오는 질문을 사장님께 올려 알림 피로를
//     만드는 것. §6-2-3 이 기본값을 오케로 둔 이유.
import { describe, it, expect } from "vitest";
import {
  classifyQuestionAudience,
  clampForTelegram,
  formatAudienceHint,
  formatOwnerEscalation,
  TELEGRAM_MAX_CHARS,
} from "../../electron/mcp-server/escalation-policy";

describe("classifyQuestionAudience — 사장님 필요(§6-2)", () => {
  it("비용/과금 결정", () => {
    const v = classifyQuestionAudience(
      "gpt-5.6-sol@max 를 쓰면 비용이 크게 늘어납니다. 진행해도 될까요?",
    );
    expect(v.audience).toBe("owner");
    expect(v.rule).toBe("cost-decision");
    expect(v.matched).toContain("비용");
  });

  it("비가역·외부영향 행위 승인(배포·머지·발송)", () => {
    for (const q of [
      "이 PR 을 지금 머지해도 됩니까?",
      "프로덕션에 배포할까요?",
      "파운더 40명에게 메일 보내도 될까요",
    ]) {
      const v = classifyQuestionAudience(q);
      expect(v.audience, q).toBe("owner");
      expect(v.rule, q).toBe("irreversible-action");
    }
  });

  it("제품 판단(무엇을 만들지)", () => {
    const v = classifyQuestionAudience(
      "이 기능의 UX 를 A 안으로 갈까요, B 안으로 갈까요? 어느 쪽이 좋을지 결정 부탁드립니다.",
    );
    expect(v.audience).toBe("owner");
    expect(v.rule).toBe("product-judgment");
  });

  it("오케가 관측 불가능한 것(스크린샷·라이브 화면) — 결정단서가 없어도 승격", () => {
    for (const q of [
      "앱을 켰을 때 로그인 팝업이 화면에 보이나요?",
      "스크린샷 한 장 부탁드립니다.",
      "터미널이 실제로 어떻게 보이는지 알려주세요",
    ]) {
      const v = classifyQuestionAudience(q);
      expect(v.audience, q).toBe("owner");
      expect(v.rule, q).toBe("unobservable");
    }
  });

  it("모순되는 지시의 중재", () => {
    const v = classifyQuestionAudience(
      "티켓 본문과 앞서 말씀과 다른 지시가 있습니다. 어느 지시를 따라야 합니까?",
    );
    expect(v.audience).toBe("owner");
    expect(v.rule).toBe("contradiction");
  });

  it("사용자를 직접 지목하면 그대로 승격", () => {
    const v = classifyQuestionAudience(
      "이건 사장님 확인이 필요해 보입니다. 전달 부탁드립니다.",
    );
    expect(v.audience).toBe("owner");
    expect(v.rule).toBe("explicit-owner");
  });
});

describe("classifyQuestionAudience — 오케 자체해결(§6-2)", () => {
  it("코드베이스·git 이력에서 답이 나오는 것", () => {
    for (const q of [
      "dispatch_task 의 모델 인자를 처리하는 코드가 어느 파일에 있나요?",
      "이 게이트를 도입한 커밋이 무엇인지 알려주세요",
      "graphBias 구현이 어디 있습니까",
    ]) {
      const v = classifyQuestionAudience(q);
      expect(v.audience, q).toBe("orchestrator");
      expect(v.rule, q).toBe("codebase-answerable");
    }
  });

  it("스코프·우선순위·이미 결정된 사안의 재확인", () => {
    const v = classifyQuestionAudience(
      "이 티켓에 프론트엔드 변경도 스코프에 포함됩니까?",
    );
    expect(v.audience).toBe("orchestrator");
    expect(v.rule).toBe("scope-recheck");
  });

  it("★판정 불명은 오케 우선 — 기본값을 '사장님께 묻기' 로 두지 않는다", () => {
    const v = classifyQuestionAudience(
      "테스트를 하나 더 추가하는 편이 나을까 고민됩니다.",
    );
    expect(v.audience).toBe("orchestrator");
    expect(v.rule).toBe("default-orchestrator-first");
    expect(v.matched).toEqual([]);
  });

  it("빈 문자열도 안전하게 오케로 떨어진다", () => {
    expect(classifyQuestionAudience("").audience).toBe("orchestrator");
  });
});

describe("★과잉 승격 방지 — 주제어만으로는 올리지 않는다", () => {
  it("'배포' 가 낱말로 들어간 코드 질문은 오케가 답한다", () => {
    const v = classifyQuestionAudience(
      "배포 스크립트가 어느 파일에 있는지 알려주세요",
    );
    expect(v.audience).toBe("orchestrator");
  });

  it("'비용' 을 언급한 사실 확인 질문도 오케가 답한다", () => {
    const v = classifyQuestionAudience(
      "gpt-5.5 의 비용 단가가 레지스트리 어디에 적혀 있나요",
    );
    expect(v.audience).toBe("orchestrator");
  });

  it("'화면' 이 들어간 프론트엔드 코드 질문은 오케가 답한다(관측 요청이 아님)", () => {
    const v = classifyQuestionAudience("이 화면 컴포넌트 구현이 어디 있습니까");
    expect(v.audience).toBe("orchestrator");
  });

  it("반대로, 같은 주제어 + 승인 요청이면 승격된다(대칭 확인)", () => {
    expect(
      classifyQuestionAudience("배포 스크립트를 지금 돌려도 될까요?").audience,
    ).toBe("owner");
  });
});

describe("판정 힌트·사장님 본문 포맷", () => {
  it("owner 판정 힌트는 승격 방법을 그대로 실어 준다", () => {
    const v = classifyQuestionAudience("지금 머지해도 될까요?");
    const hint = formatAudienceHint(v, "task-1#qab");
    expect(hint).toContain("★판정: 사장님 필요");
    expect(hint).toContain('escalate_to_owner(question_id="task-1#qab")');
    // ★판정이 권위가 아니라는 사실을 알림에 남긴다.
    expect(hint).toContain("판정은 힌트다");
  });

  it("orchestrator 판정 힌트도 승격 경로를 알려준다(막히면 올릴 수 있게)", () => {
    const v = classifyQuestionAudience("이 함수가 어디 있나요");
    const hint = formatAudienceHint(v, "task-1#qab");
    expect(hint).toContain("판정: 오케 자체해결");
    expect(hint).toContain("escalate_to_owner");
  });

  it("사장님 본문에 질문 전문과 티켓 좌표가 들어간다", () => {
    const body = formatOwnerEscalation({
      questionId: "task-1#qab",
      taskId: "task-1",
      taskTitle: "라우팅 티켓",
      askedBy: "agent-1",
      question: "머지해도 될까요?",
      verdict: classifyQuestionAudience("머지해도 될까요?"),
      note: "CI 는 통과했습니다",
    });
    expect(body).toContain("[사장님 확인 요청] 라우팅 티켓");
    expect(body).toContain("task-1#qab");
    expect(body).toContain("머지해도 될까요?");
    expect(body).toContain("CI 는 통과했습니다");
    expect(body).toContain("답장");
  });

  it("텔레그램 한도 초과는 잘렸다는 사실을 본문에 남긴다(조용한 절단 금지)", () => {
    const short = clampForTelegram("짧다");
    expect(short.truncated).toBe(false);
    const long = clampForTelegram("가".repeat(TELEGRAM_MAX_CHARS + 500));
    expect(long.truncated).toBe(true);
    expect(long.value.length).toBeLessThanOrEqual(TELEGRAM_MAX_CHARS);
    expect(long.value).toContain("잘렸습니다");
  });
});
