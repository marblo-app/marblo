/**
 * 워크체인 **자동 포착** (티켓 lW9iiLGWlO0lVoy4khSM).
 *
 * 여기서 못 박는 것은 두 가지고, 둘 다 실패하면 기능 전체가 죽는다.
 *
 *   ① **잡아야 할 것을 잡는다** — 2026-08-22 의 실제 실패 문장이 걸려야 한다.
 *      그 문장은 이미 도구 인자로 들어왔었고 우리가 안 읽었을 뿐이다.
 *   ② ★**안 잡아야 할 것을 안 잡는다** — 오탐이 쌓이면 체인이 쓰레기로 덮이고,
 *      그 순간 오케가 푸터를 무시한다. 그래서 아래 `NEGATIVE_CORPUS` 는 이 저장소의
 *      **실제 커밋 제목·티켓 지시문·워커 보고문**이다(지어낸 문장이 아니다).
 *      마지막 describe 블록이 그 코퍼스에 대한 발화율을 숫자로 못 박는다 —
 *      "전 호출에 걸리면 실패" 라는 완료 기준을 회귀 테스트로 만든 것이다.
 */
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_SIMILARITY,
  SURFACE_POLICY,
  buildOwnerMissions,
  dedupeAgainstChain,
  detectFollowUpPromises,
  evaluateUnit,
  formatCaptureNote,
  formatOwnerMissionNote,
  formatNoisePrunePlan,
  isDuplicateWhat,
  normalizeForCompare,
  ownerMissionVeto,
  planAutoNoisePrune,
  redactQuotedSpans,
  splitUnits,
  type CaptureSurface,
} from "../../electron/mcp-server/work-chain-capture";
import type { WorkChainItem } from "../../electron/mcp-server/work-chain-core";

function chainItem(what: string, closed = false): WorkChainItem {
  return {
    id: `i_${normalizeForCompare(what).slice(0, 6)}`,
    what,
    why: "because",
    afterTaskIds: [],
    afterItemIds: [],
    taskIds: [],
    doneWhen: "done",
    createdAt: 1,
    updatedAt: 1,
    createdBy: "orchestrator-p1",
    ...(closed
      ? { closed: { kind: "dropped" as const, reason: "n/a", at: 2, by: "x" } }
      : {}),
  };
}

// ── ① 실패 사례 재현 ─────────────────────────────────────────────────────

describe("2026-08-22 실패 문장 — 이게 안 걸리면 이 티켓은 실패다", () => {
  const REAL_FAILURE =
    "워크체인이 보안규칙 파일을 건드려서, 규칙을 한 번 더 배포해야 합니다. " +
    "안 하면 이 기능이 조용히 안 됩니다. 지금 그건 제 머릿속에만 있는 다음 할 일입니다.";

  it("사장님 보고(escalate_to_owner/send_telegram_message) 에서 잡힌다", () => {
    const hits = detectFollowUpPromises(REAL_FAILURE, "owner_report");
    expect(hits.length).toBeGreaterThan(0);
    // 항목은 절대 비어 있지 않다 — 오케가 실제로 쓴 문장이 그대로 what 이 된다.
    expect(hits[0].what).toContain("배포해야 합니다");
    expect(hits[0].tier).toBe("commitment");
  });

  it("why 에 원문이 남아서 나중에 유효성을 판단할 수 있다", () => {
    const [hit] = detectFollowUpPromises(REAL_FAILURE, "owner_report");
    expect(hit.why).toContain("자동 포착");
    expect(hit.why).toContain("배포해야 합니다");
    // 되돌리는 법이 항목 안에 들어 있어야 소음이 되지 않는다.
    expect(hit.why).toContain("dropped");
  });

  it("'다음 할 일' 문장은 queue 층으로도 독립적으로 걸린다", () => {
    const hits = detectFollowUpPromises(
      "지금 그건 제 머릿속에만 있는 다음 할 일입니다.",
      "owner_report",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].tier).toBe("queue");
  });
});

describe("재현 시나리오 — 'A 를 dispatch 하고, A 가 끝나면 B 를 해야 한다'", () => {
  const A = "aaaaaaaaaaaaaaaaaaaa"; // Firestore 자동 id 는 20자 영숫자
  const instruction =
    `백엔드 규칙 배포 티켓이다. 배포 스크립트를 돌려라.\n` +
    `이 티켓(${A})이 끝나면 프론트 Up Next 패널 검증을 해야 한다.`;

  it("dispatch 지시문에서 걸리고, 선행 힌트와 티켓 id 를 함께 들고 나온다", () => {
    const hits = detectFollowUpPromises(instruction, "dispatch_instruction");
    expect(hits).toHaveLength(1);
    expect(hits[0].what).toContain("Up Next 패널 검증");
    expect(hits[0].hasDependencyHint).toBe(true);
    expect(hits[0].taskIdHints).toContain(A);
  });

  it("★지시문의 명령형 문장('돌려라')은 잡지 않는다 — 그건 워커의 할 일이다", () => {
    const hits = detectFollowUpPromises(instruction, "dispatch_instruction");
    expect(hits.every((h) => !h.what.includes("돌려라"))).toBe(true);
  });

  it("선행 힌트가 없는 약속은 지시문 표면에서 통과하지 못한다(정책 차이)", () => {
    const noHint = "이 작업 뒤로 문서를 갱신해야 합니다.";
    expect(detectFollowUpPromises(noHint, "dispatch_instruction")).toHaveLength(
      0,
    );
    // 같은 문장이 사장님 보고 표면에서는 걸린다 — 표면마다 오탐 위험이 다르다.
    expect(detectFollowUpPromises(noHint, "owner_report")).toHaveLength(1);
  });
});

// ── 2026-08-24 오포착 (티켓 tPNWTYM9k5BGMqfjQHZm) ────────────────────────
//
// 오늘 send_telegram_message / answer_question 본문에서 한 문장이 잘려 체인
// 항목이 됐다. 공통점: 오케가 사람·에이전트에게 하는 말(보고·제안·메일 초안)이지
// 자기 큐에 적는 메모가 아니다. 자동 포착을 끄지 않고, 이 문장들만 거절한다.

const FALSE_POSITIVES_2026_08_24 = [
  "그런데 (ㄱ)은 사장님 요구를 반만 만족한다 — 데모를 보려면 매번 Cmd 를 눌러야 한다.",
  "다시 배정하겠습니다.",
  "끝나면 diff 와 함께 바로 보고드리겠습니다.",
  "아시면 알려주시고, 모르시면 제가 확인하겠습니다.",
  "답장 주시면 지금 남아 있는 기간에 이어서 Pro 3개월을 무료로 얹어 드리겠습니다.",
  '"좋다"고 하시면 grant 앵커 수정하고 발송하겠습니다.',
  '오늘 gen1 env 를 빈 문자열로 읽고 "키 없음" 이라고 한 것과 똑같은 실수다 — …',
] as const;

/** 오포착이 난 두 표면. 끄지 않고 휴리스틱만 좁힌다. */
const SPEECH_SURFACES = ["owner_report", "answer"] as const;

describe("2026-08-24 오포착 7문장 — 보고·제안·메일초안은 항목이 아니다", () => {
  for (const sentence of FALSE_POSITIVES_2026_08_24) {
    it(`잡지 않는다: ${sentence.slice(0, 28)}…`, () => {
      for (const surface of SPEECH_SURFACES) {
        expect(detectFollowUpPromises(sentence, surface)).toEqual([]);
      }
    });
  }
});

describe("★진짜 약속은 여전히 잡힌다 — 오포착을 줄이려 재현율을 죽이지 않는다", () => {
  const REAL_PROMISES = [
    "마지막에 X 티켓을 열겠다",
    "배포 끝나면 디자인 3/8 을 재개하겠다",
    "규칙을 한 번 더 배포해야 합니다.",
  ];

  it("사장님 보고·답변 표면에서 진짜 약속 3건을 놓치지 않는다", () => {
    for (const surface of SPEECH_SURFACES) {
      for (const sentence of REAL_PROMISES) {
        expect(
          detectFollowUpPromises(sentence, surface),
          `${surface}: ${sentence}`,
        ).not.toHaveLength(0);
      }
    }
  });

  it("★조사를 띄어 쓴 목적어도 목적어다 — '3/8 을' 이 놓치던 형태였다", () => {
    // 옛 OBJECT_MARKER_RE 는 앞말이 한글일 것을 요구해 "8 을" 을 못 봤다.
    // 어미 층의 유일한 실질 게이트가 이 축이 된 지금(티켓 GvgBoZ5ajEKTT7G5rWME)
    // 여기서 놓치면 그대로 재현율 손실이라 넓혔다.
    expect(
      detectFollowUpPromises("배포 끝나면 디자인 3/8 을 재개하겠다", "owner_report"),
    ).toHaveLength(1);
    expect(
      detectFollowUpPromises("머지되면 PR을 다시 올리겠습니다.", "owner_report"),
    ).toHaveLength(1);
  });

  it("목적어 있는 '확인하겠다' 는 보고 행위가 아니라 다음 일이다", () => {
    expect(
      detectFollowUpPromises("배포 후 로그를 확인하겠다", "owner_report"),
    ).toHaveLength(1);
  });
});

// ══ 2026-08-24 오포착 (티켓 wx9c4NeVtZ1SGcbEISpg) ═══════════════════════════
//
// 같은 날 오케 자기 문장에서 **16건**이 더 걸렸다. 아래는 그중 오케가 원문을
// 복원해 준 **11건**이고 — 나머지 5건은 세션 컨텍스트에서 밀려나 원문이 없다.
// ★지어내지 않았다. 11건으로 못 박고 "16건 중 11건 확보" 라고 적어 둔다.
// 유형은 셋 다 덮인다(오히려 티켓에 없던 유형 d 가 하나 더 나왔다).
//
// ★실측 하나: **11건 전부 owner_report(send_telegram_message) 한 표면에서 났다.**
// 오포착은 표면마다 고르게 나는 게 아니라 사장님 보고 표면에 몰린다 —
// 오케가 가장 길고 자유롭게 쓰는 자리이기 때문이다.

/** ★2026-08-24 오포착 원문. 전부 owner_report 표면. */
const FALSE_POSITIVES_16 = {
  /** (a) 입장표명 — 태도를 말한 것이지 할 일이 아니다. */
  stance: [
    "결정으로 받고 잘 돌게 만드는 쪽으로 붙겠습니다.",
    "더 말리지 않겠습니다.",
    "(오늘 세 번 틀렸으니 단정은 피하겠습니다 — 에이전트가 코드로 확정합니다.",
  ],
  /** (b) ★따옴표 안 제품 문구 — 오케가 사장님께 인용한 UI 카피. */
  quoted: [
    // ★닫는 따옴표가 없다(오케가 붙여넣다 빠뜨렸다). 짝만 지우면 이게 샌다.
    '"터미널 열고 git init 을 진행하겠습니다.',
    // ★대표 케이스 — **인용부 제외가 필요하다고 설명한 문장이, 그 안에 든
    //   인용문 때문에 잡혔다.** 버그를 설명하는 문장이 그 버그에 걸렸다.
    "따옴표 안 제외 — 오포착 16건 중 상당수가 제가 사장님께 인용한 제품 문구였습니다" +
      '("터미널 열고 git init 을 진행하겠습니다" 같은 UI 카피).',
  ],
  /** (c) 이미 티켓으로 넣은 지시를 사장님께 **설명한** 문장. */
  boardFact: [
    "그 문서에 경고 하나를 꼭 넣으라고 했습니다 — 광고는 marblo.app 으로 보내고 utm 을 실어야 합니다.",
    '"설치 수" 를 그냥 세면 안 됩니다 — 브라우저·사람당 설치 수를 옆에 봬야 합니다',
  ],
  /** (d) ★티켓에 없던 유형 — 그 턴에 **지금 하고 있는** 일. */
  immediate: [
    "이어서 보고 머지하겠습니다.",
    "UTM 규약(#1197)은 사장님이 바로 쓰실 거라 먼저 보겠습니다.",
  ],
} as const;

/**
 * ★같은 날 **유지된** 두 건 — 음성 코퍼스가 아니라 **양성 대조군**이다.
 * 둘 다 실제로 나중에 할 일이고 티켓이 없다. 오포착을 줄이는 규칙이 이 둘을
 * 같이 죽이면 그건 좁힌 게 아니라 기능을 끈 것이다.
 */
const TRUE_POSITIVES_2026_08_24 = [
  // ★따옴표를 품고도 양성이다 — "따옴표가 있으면 버린다" 로 만들면 안 되는 근거.
  '앞서 "3.1% 라 규모 실으면 돈이 샙니다" 라고 드린 조언은 보류하겠습니다. 근거가 흔들립니다.',
  "이건 지표 수리와는 별개 문제라, 계기판이 고쳐진 뒤에 따로 여쭙겠습니다 — " +
    "익명 신호를 어디까지 남길지는 프라이버시 방침과 걸려 있어서 사장님 판단이 필요합니다.",
] as const;

describe("★2026-08-24 오포착 원문 9건 — 전부 잡히지 않는다", () => {
  const all = [
    ...FALSE_POSITIVES_16.stance,
    ...FALSE_POSITIVES_16.quoted,
    ...FALSE_POSITIVES_16.boardFact,
    ...FALSE_POSITIVES_16.immediate,
  ];
  for (const sentence of all) {
    it(`잡지 않는다: ${sentence.slice(0, 30)}…`, () => {
      // 원문이 난 표면(owner_report)이 본선이고, 이웃 표면도 같이 막는다.
      for (const surface of SPEECH_SURFACES) {
        expect(detectFollowUpPromises(sentence, surface)).toEqual([]);
      }
    });
  }

  it("★발화율 0% — 9건 중 0건", () => {
    const fired = all.filter(
      (t) => detectFollowUpPromises(t, "owner_report").length > 0,
    );
    expect(fired).toEqual([]);
  });
});

/**
 * ★2026-09-04 (티켓 GvgBoZ5ajEKTT7G5rWME) — 위 2건을 **의도적으로 놓기로** 했다.
 *
 * 근거는 새 실측이다. 2026-08-24 에는 이 둘이 "좁히면 안 되는 양성 대조군"
 * 이었다. 2026-09-04 워크체인 실측은 정반대를 말한다 — 열린 82개의 대부분이
 * 바로 이 모양의 항목이었고(티켓 없음 · 닫을 보드 사실 없음 · 영원히 열림),
 * 큐가 차서 **사장님 지시가 기록되지 못하는** 지점까지 갔다. 소음이 기능을
 * 죽인다는 이 모듈의 전제가 실현된 것이다.
 *
 * 그래서 어미 층 전체에 목적어를 요구하고(§hasCaptureSubstance), 이 둘은
 * 그 대가로 놓는다. **숨기지 않고 여기에 손실로 못 박아 둔다** — 놓친 약속은
 * `add_work_chain_item` 이 여전히 받고, 목적어만 붙으면("그 조언을 보류하겠습니다")
 * 그대로 다시 잡힌다.
 */
describe("★알려진 재현율 손실 — 목적어 없는 약속은 이제 안 잡는다", () => {
  it("놓친다(의도): 앞서 … 드린 조언은 보류하겠습니다", () => {
    // 목적어가 "조언**은**"(주제 조사)이라 이제 안 걸린다.
    expect(
      detectFollowUpPromises(TRUE_POSITIVES_2026_08_24[0], "owner_report"),
    ).toEqual([]);
  });

  it("★둘 중 하나는 그대로 잡힌다 — 좁힘이 유형을 통째로 끄지 않았다", () => {
    // "익명 신호**를** 어디까지 남길지는 …" 에 목적어가 있어서 통과한다.
    // 손실이 "이런 문장은 다 죽는다" 가 아니라는 실측 대조군이다.
    expect(
      detectFollowUpPromises(TRUE_POSITIVES_2026_08_24[1], "owner_report"),
    ).toHaveLength(1);
  });

  it("조사 없는 목적어도 놓친다 — '티켓 열겠다' vs '티켓을 열겠다'", () => {
    expect(
      detectFollowUpPromises("마지막에 X 티켓 열겠다", "owner_report"),
    ).toEqual([]);
    expect(
      detectFollowUpPromises("마지막에 X 티켓을 열겠다", "owner_report"),
    ).toHaveLength(1);
  });

  it("★인용 삭제 자체는 안 바뀌었다 — 바깥 문장은 여전히 남는다", () => {
    // 손실의 원인이 "따옴표를 품어서" 가 아니라 "목적어가 없어서" 라는 사실을
    // 못 박는다. 같은 문장에 목적어를 넣으면 인용을 품은 채로 다시 잡힌다.
    expect(
      detectFollowUpPromises(
        '앞서 "3.1% 라 규모 실으면 돈이 샙니다" 라고 드린 그 조언을 보류하겠습니다.',
        "owner_report",
      ),
    ).toHaveLength(1);
  });
});

describe("(a) 입장표명 — 왜 마커 창으로는 못 잡았나", () => {
  it("부정이 어미 **앞**에 붙어서 뒤쪽 부정 창에 안 걸린다", () => {
    // NEGATIONS 는 마커 뒤 20자만 본다(앞 창은 살아 있는 약속을 죽여서 뺐다).
    // "말리**지 않**겠습니다" 는 부정이 어미 앞이라 그 창에 안 걸린다. 그래서
    // 창이 아니라 **어미의 형태**로 가른다.
    expect(
      detectFollowUpPromises("더 말리지 않겠습니다.", "owner_report"),
    ).toEqual([]);
    // 같은 어미의 긍정형은 그대로 약속이다 — 재현율을 죽이지 않았다.
    expect(
      detectFollowUpPromises("제가 규칙을 다시 올리겠습니다.", "owner_report"),
    ).toHaveLength(1);
  });

  it("★긍정형 태도 동사 — 이제 목적어 게이트가 유형을 통째로 먹는다", () => {
    // 2026-08-24 에는 "붙겠/피하겠"(오포착) 과 "보류하겠/여쭙겠"(양성)이 어미도
    // 목적어 유무도 안 갈려서 태도 동사 **닫힌 목록**이 유일한 도구였다.
    // 2026-09-04(티켓 GvgBoZ5ajEKTT7G5rWME)부터 어미 층 전체가 목적어를
    // 요구하므로 둘 다 여기서 걸린다 — 닫힌 목록은 이제 이중 안전장치다.
    expect(detectFollowUpPromises("쪽으로 붙겠습니다.", "owner_report")).toEqual(
      [],
    );
    expect(
      detectFollowUpPromises("조언은 보류하겠습니다.", "owner_report"),
    ).toEqual([]);
    // 같은 태도 동사라도 목적어가 붙으면 다시 약속이다 — 어미가 아니라
    // "무엇을" 이 판정축이라는 사실이 여기서 드러난다.
    expect(
      detectFollowUpPromises("그 조언을 보류하겠습니다.", "owner_report"),
    ).toHaveLength(1);
  });
});

describe("★(b) 따옴표 안 제품 문구 — 인용은 오케의 약속이 아니다", () => {
  it("코드블록 안의 약속 어미는 코드다 — 여러 줄 펜스", () => {
    expect(
      detectFollowUpPromises(
        "복사해서 보내드린 문구입니다.\n```\n규칙을 한 번 더 배포해야 합니다\n```",
        "owner_report",
      ),
    ).toEqual([]);
  });

  it("인라인 코드도 같다", () => {
    expect(
      detectFollowUpPromises(
        "버튼 라벨은 `설정을 저장하겠습니다` 입니다.",
        "owner_report",
      ),
    ).toEqual([]);
  });

  it("한국어 인용부호(「」)도 인용이다", () => {
    expect(
      detectFollowUpPromises(
        "안내문에 「규칙을 다시 배포해야 합니다」 라고 적혀 있습니다.",
        "owner_report",
      ),
    ).toEqual([]);
  });

  it("★닫히지 않은 따옴표는 줄 끝까지 인용이다 — 원문 5번이 그 모양이다", () => {
    expect(redactQuotedSpans('앞 문장. "여는 따옴표만 있다 배포하겠습니다')).toBe(
      "앞 문장.  ",
    );
  });

  it("★인용을 품은 문장의 **나머지**는 살아 있다 — 통째로 버리지 않는다", () => {
    const hits = detectFollowUpPromises(
      '사장님이 "지금 하자" 고 하셔서, 제가 규칙을 한 번 더 배포해야 합니다.',
      "owner_report",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].what).toContain("배포해야 합니다");
  });

  it("★#1176 이 살린 판정 근거를 인용 제거가 지우지 않는다", () => {
    // 이 문장의 거절 근거는 청자 조건 "고 하시면" 이고, 그건 따옴표 **밖**에
    // 있다. 인용만 지우므로 근거가 그대로 남아 계속 거절된다.
    expect(
      detectFollowUpPromises(
        '"좋다"고 하시면 grant 앵커 수정하고 발송하겠습니다.',
        "owner_report",
      ),
    ).toEqual([]);
  });

  it("영어 아포스트로피는 인용으로 보지 않는다 — 한글을 담은 작은따옴표만", () => {
    // "don't … it's" 가 짝을 이뤄 문장 중간을 삼키면 판정 근거가 사라진다.
    expect(redactQuotedSpans("don't worry, it's fine")).toBe(
      "don't worry, it's fine",
    );
    expect(redactQuotedSpans("'적재 전' 에서 가른다")).toBe("  에서 가른다");
  });
});

describe("(c)(d) 이미 보드에 있는 일 / 지금 하고 있는 일", () => {
  it("'…라고 했습니다' 는 이미 지시한 일을 사장님께 설명한 문장이다", () => {
    expect(
      detectFollowUpPromises(FALSE_POSITIVES_16.boardFact[0], "owner_report"),
    ).toEqual([]);
    // 같은 당위 어미라도 보고 표지가 없으면 그대로 약속이다.
    expect(
      detectFollowUpPromises("광고에 utm 규약을 실어야 합니다.", "owner_report"),
    ).toHaveLength(1);
  });

  it("금지 + 당위가 한 문장에 있으면 규범 서술이지 약속이 아니다", () => {
    expect(
      detectFollowUpPromises(FALSE_POSITIVES_16.boardFact[1], "owner_report"),
    ).toEqual([]);
  });

  it("★'이어서/먼저/바로' 는 지금 하는 일 — 다음 할 일이 아니다", () => {
    for (const s of FALSE_POSITIVES_16.immediate) {
      expect(detectFollowUpPromises(s, "owner_report")).toEqual([]);
    }
  });

  it("★단, 선행 힌트가 있으면 '바로' 는 사건 뒤의 즉시라 살린다", () => {
    expect(
      detectFollowUpPromises("머지되면 바로 티켓을 열겠습니다.", "owner_report"),
    ).toHaveLength(1);
  });
});

// ── ② 안 잡아야 할 것 ────────────────────────────────────────────────────

describe("명령형 게이트 — 수신자의 할 일은 오케의 다음 할 일이 아니다", () => {
  const directives = [
    "강제 방식 4개를 비교하고 하나를 골라라.",
    "★최소로 걸어라. 어느 자리에 왜 거는지 근거를 대라.",
    "시크릿·토큰·.env 원문 출력 금지. 개발·테스트는 에뮬레이터로 진행해라.",
    "커밋 전에 반드시 타입체크를 돌리세요.",
    "남의 에이전트 터미널을 '세션 만료' 라고 말하지 마라.",
  ];
  for (const d of directives) {
    it(`잡지 않는다: ${d.slice(0, 24)}…`, () => {
      expect(detectFollowUpPromises(d, "owner_report")).toHaveLength(0);
    });
  }

  it("단, 1인칭 주어가 있으면 명령형 어미가 있어도 오케의 항목으로 본다", () => {
    const hits = detectFollowUpPromises(
      "제가 배포 후에 규칙을 다시 올리겠습니다 — 그때까지 손대지 마세요.",
      "owner_report",
    );
    expect(hits).toHaveLength(1);
  });
});

describe("현재형 서술은 약속이 아니다 — PR 이 '한 일' 과 '할 일' 을 가른다", () => {
  const statements = [
    "idle 이면 스트립을 통째로 안 그리는 게이트를 연다",
    "GitHub 토큰이 .git/config·화면·Firestore 로 새던 경로를 전부 막는다",
    "매핑 불가를 '적재 전' 에서 가르고, 128.6% 를 계산 지점에서 막는다",
    "오케가 다음에 할 일을 잊는다 — 워크체인을 보드 옆에 남기고 이어서 집도록",
  ];
  for (const st of statements) {
    it(`잡지 않는다: ${st.slice(0, 24)}…`, () => {
      expect(detectFollowUpPromises(st, "owner_report")).toHaveLength(0);
    });
  }
});

describe("부정과 질문 — 약속의 반대는 약속이 아니다", () => {
  it("'재배포할 필요 없습니다' 는 잡지 않는다", () => {
    expect(
      detectFollowUpPromises("규칙은 재배포할 필요 없습니다.", "owner_report"),
    ).toHaveLength(0);
  });

  it("'후속 작업 없음' 은 잡지 않는다", () => {
    expect(
      detectFollowUpPromises(
        "PR 머지 확인했습니다. 후속 작업 없음.",
        "owner_report",
      ),
    ).toHaveLength(0);
  });

  it("질문은 아직 결정이 아니다", () => {
    expect(
      detectFollowUpPromises(
        "규칙을 한 번 더 배포해야 할까요?",
        "owner_report",
      ),
    ).toHaveLength(0);
  });

  it("마커 뒤 20자 안의 부정은 그 약속을 죽인다(after-window)", () => {
    expect(
      detectFollowUpPromises(
        "인덱스를 다시 만들어야 합니다 — 아니다, 취소.",
        "owner_report",
      ),
    ).toHaveLength(0);
  });

  it("★앞쪽 부정은 약속을 죽이지 않는다 — 앞 창을 뺀 근거가 이 케이스다", () => {
    // "재배포는 필요 없다" 는 *다른 일*에 대한 부정이고, 뒤에 오는 "돌려야 한다"
    // 는 살아 있는 약속이다. 앞 창이 있으면 이게 통째로 죽었다.
    const hits = detectFollowUpPromises(
      "재배포는 필요 없다고 하니 인덱스를 다시 돌려야 한다",
      "owner_report",
    );
    expect(hits).toHaveLength(1);
  });

  it("★부정이 하나라도 안 걸린 출현이 있으면 살아 있는 약속이다", () => {
    const hits = detectFollowUpPromises(
      "재배포는 필요 없습니다. 다만 인덱스를 다시 만들어야 합니다.",
      "owner_report",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].what).toContain("인덱스");
  });
});

// ── 명시 마커 ────────────────────────────────────────────────────────────

describe("★당위 어미의 중의성 — '해야 한다' 는 약속일 수도, 설계 규범일 수도 있다", () => {
  // 이 저장소 커밋 400건 실측에서 오탐의 대부분이 설계 규범문이었다. 두 축으로
  // 가른다: ①종결 위치 ②목적어(을/를) 동반.
  it("종속절 속 당위는 주장이 아니라 인용된 규범이다", () => {
    expect(
      detectFollowUpPromises(
        "승격은 정리를 해야 한다는 근거로 색을 줄였다.",
        "owner_report",
      ),
    ).toHaveLength(0);
  });

  it("목적어 없는 상태 서술은 오케의 할 일이 아니다", () => {
    for (const norm of [
      "규칙만 알고 다시 새는 걸 막으려면 검사가 있어야 한다.",
      "줄도 같이 바뀌어야 한다.",
      "대신 시끄럽게 멈춰야 한다.",
      "고칠 방법이 없고 기다려야 한다.",
    ]) {
      expect(detectFollowUpPromises(norm, "owner_report")).toEqual([]);
    }
  });

  it("목적어가 있으면 같은 어미라도 약속이다", () => {
    expect(
      detectFollowUpPromises(
        "규칙을 한 번 더 배포해야 합니다.",
        "owner_report",
      ),
    ).toHaveLength(1);
  });

  it("★알려진 재현율 한계 — 목적어가 은/는/만 으로 표시되면 놓친다", () => {
    // 정밀도를 위해 의도적으로 감수한 손실이다("인덱스**는** 다시 만들어야 한다").
    // 을/를 까지 열면 "줄**도** 같이 바뀌어야 한다" 같은 규범문이 되살아난다.
    // 놓친 약속은 기존 수동 경로(add_work_chain_item)로 여전히 적을 수 있다.
    expect(
      detectFollowUpPromises("인덱스는 다시 만들어야 한다.", "owner_report"),
    ).toEqual([]);
  });

  it("의지 어미는 위치를 안 따진다 — 다만 인용 꼬리('열겠다던')는 뺀다", () => {
    expect(
      detectFollowUpPromises("머지되면 티켓을 열겠습니다.", "owner_report"),
    ).toHaveLength(1);
    expect(
      detectFollowUpPromises(
        "열겠다던 웹 티켓을 결국 안 열었다는 게 실측이다.",
        "owner_report",
      ),
    ).toEqual([]);
  });
});

describe("명시 마커 — 오케가 직접 찍으면 조건 없이 통과", () => {
  it("[다음] 뒤가 항목이 된다", () => {
    const hits = detectFollowUpPromises(
      "배포 끝났습니다.\n[다음] firestore.rules 를 프로덕션에 배포",
      "owner_report",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].tier).toBe("explicit");
    expect(hits[0].what).toBe("firestore.rules 를 프로덕션에 배포");
  });

  it("명령형 어미가 섞여 있어도 명시 마커는 이긴다", () => {
    const hits = detectFollowUpPromises(
      "후속: 배포 후 Up Next 패널을 직접 확인해라",
      "owner_report",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].tier).toBe("explicit");
  });
});

// ── 중복 제거 ────────────────────────────────────────────────────────────

describe("중복 제거 — 같은 약속을 두 번 적지 않는다", () => {
  it("이미 열려 있는 항목과 겹치면 다시 적지 않는다", () => {
    const [hit] = detectFollowUpPromises(
      "규칙을 한 번 더 배포해야 합니다.",
      "owner_report",
    );
    const existing = [chainItem("규칙을 한 번 더 배포해야 합니다.")];
    expect(dedupeAgainstChain([hit], existing)).toHaveLength(0);
  });

  it("★닫힌 항목과 겹치는 건 다시 적는다 — 오케가 다시 말했다는 뜻이다", () => {
    const [hit] = detectFollowUpPromises(
      "규칙을 한 번 더 배포해야 합니다.",
      "owner_report",
    );
    const existing = [chainItem("규칙을 한 번 더 배포해야 합니다.", true)];
    expect(dedupeAgainstChain([hit], existing)).toHaveLength(1);
  });

  it("같은 호출 안의 유사 문장도 한 번만 남는다", () => {
    const hits = detectFollowUpPromises(
      "규칙을 한 번 더 배포해야 합니다.\n규칙을 한 번 더 배포해야 합니다!",
      "owner_report",
    );
    expect(dedupeAgainstChain(hits, [])).toHaveLength(1);
  });

  it("서로 다른 약속은 둘 다 남는다", () => {
    const hits = detectFollowUpPromises(
      "규칙을 배포해야 합니다.\n인덱스를 새로 만들어야 합니다.",
      "owner_report",
    );
    expect(dedupeAgainstChain(hits, [])).toHaveLength(2);
  });

  it("유사도 임계는 0.6 — 부분 문자열은 항상 중복", () => {
    expect(DUPLICATE_SIMILARITY).toBe(0.6);
  });
});

// ── 상한·형태 ────────────────────────────────────────────────────────────

describe("상한과 형태 — 문단 하나가 체인을 덮지 못한다", () => {
  it("호출당 항목 수는 표면 정책 상한을 넘지 않는다", () => {
    const many = Array.from(
      { length: 10 },
      (_, i) => `${i} 번 항목을 반드시 처리해야 합니다.`,
    ).join("\n");
    const hits = detectFollowUpPromises(many, "owner_report");
    expect(hits.length).toBeLessThanOrEqual(
      SURFACE_POLICY.owner_report.maxPerCall,
    );
  });

  it("목록 기호·굵게 표시는 벗겨진다 — 항목 제목이 '- ★**' 로 시작하지 않는다", () => {
    const [hit] = detectFollowUpPromises(
      "- ★**규칙을 배포해야 합니다**",
      "owner_report",
    );
    expect(hit.what.startsWith("규칙")).toBe(true);
  });

  it("400자를 넘는 문단은 문장이 아니라 문단이므로 잡지 않는다", () => {
    const long = `${"가".repeat(420)} 배포해야 합니다.`;
    expect(evaluateUnit(long, SURFACE_POLICY.owner_report)).toBeNull();
  });

  it("splitUnits 는 줄과 문장 종결부호 양쪽으로 쪼갠다", () => {
    expect(splitUnits("첫 줄.\n둘째 줄. 셋째 문장.")).toEqual([
      "첫 줄.",
      "둘째 줄.",
      "셋째 문장.",
    ]);
  });

  it("포착 알림은 항목과 되돌리는 법을 같이 준다", () => {
    const note = formatCaptureNote([{ id: "wc_a1", what: "규칙 배포" }]);
    expect(note).toContain("wc_a1");
    expect(note).toContain("dropped");
    expect(formatCaptureNote([])).toBe("");
  });
});

// ══ ★사장님 미션 포착 (티켓 wx9c4NeVtZ1SGcbEISpg) ═══════════════════════════
//
// 여기서 못 박는 것은 이 티켓의 완료 기준 그대로다:
//   ① 사장님이 새 미션을 주면 체인에 남는다 (2026-08-24 미션 5건 원문 재현)
//   ② 질문은 안 잡힌다 (같은 날 질문 5건 원문)
//   ③ 한 메시지에 미션이 여럿이면 갈라진다
//   ④ ★사장님 한 줄을 그대로 밭지 않는다 — 항목 제목의 **출처**를 못 박는다
//
// ★코퍼스는 전부 **인바운드 원문**이다(오케가 세션에서 복원해 줬다).
//
// ★★티켓 본문 정정 둘 — 여기 남긴다:
//   (1) 티켓은 "광고 돌리자 + 봇 거르자 + 어드민 재설계가 한 통에 왔다" 고
//       적었지만 **사실이 아니다.** 실제로는 별개 메시지였다(M1 → 봇 질문 → M3).
//       한 통에 여러 가닥인 진짜 사례는 **M4(기업 AX)와 M5(마블로비서)** 다.
//   (2) 티켓은 미션이 "create_task + dispatch 로 이어졌다" 고만 적었는데,
//       실측은 **5건 중 2건(M4·M5)이 mission_label 없이 티켓만** 생겼다.
//       → ★판정축은 `create_task` 여야 하고 `mission_label` 은 **있으면 묶는
//         보조**다. 라벨을 판정축으로 잡았으면 오늘 가장 큰 미션(기업 AX)을
//         놓쳤다. 아래 M4·M5 테스트가 그 회귀를 못 박는다.
//
// ★설계 제약 하나 더: 사장님 원문은 모바일 음성입력이라 오타·비문이 많다
// ("짐행/규성/븜석/늨김"). **어휘 매칭에 기대는 규칙은 여기서 깨진다** —
// 그게 (B) 행동=증거 훅이 유리한 또 하나의 실측 근거다.

const OWNER = { channel: "telegram", from: "사장님", at: 1_700_000_000_000 };

/** ★2026-08-24 사장님 인바운드 원문 5건 + 실제로 이어진 행동. */
const OWNER_MISSIONS_2026_08_24 = [
  {
    name: "M1 광고 집행",
    text:
      "1일만쓰고 끝이 이미 결론이야. 우린 개선을 했으니 이제 광고로 모수를 늘려보자는거야. " +
      "어쨌든 활성사용자가 3명정도 있다는건 제품의 가치를 보는 사람들이 있는거니까",
    tasks: [
      {
        id: "LngjrQAiCL8YlWCW8TWi",
        title: "광고비 배포·어드민 입력",
        missionLabel: "ads-launch",
      },
      {
        id: "P8jS1Ot3d6m6yjLeHUNR",
        title: "UTM 규약",
        missionLabel: "ads-launch",
      },
    ],
    expectWhat: "사장님 미션: ads-launch",
  },
  {
    name: "M2 통합뷰",
    text:
      "응 조인키 맞추고 ga4랑 텔레메트리 결합 통합빅쿼리 텐이블 만들어달라고 했는데 " +
      "누락됐나보다 계획짝ㅎ 제대로 짐행해줘 스키마랑 계획대로 정의해서",
    tasks: [
      {
        id: "L8RvsReu6Vch5eNYYCJR",
        title: "GA4×텔레메트리 통합 뷰",
        missionLabel: "ads-readiness",
      },
    ],
    expectWhat: "사장님 미션: ads-readiness",
  },
  {
    name: "M3 어드민 재설계",
    text:
      "응 그리고 지금 어드민 븜석페이지도 개편했는대도 좀 지자분해 데이터도 안맞는게 많았고 " +
      "이제 통핮테이블 뷰로 다시 좀 지금의 4개에 탲은 좋은데 각 차크랑 테이블 필요한 규성으로 " +
      "좀 먼저 계획 짜고 다시 수정가볼래? 계획문서부터 짜지",
    tasks: [
      {
        id: "X2piUBsQT6yPV4BHeBRP",
        title: "어드민 통합 테이블 뷰 계획",
        missionLabel: "ads-launch",
      },
    ],
    expectWhat: "사장님 미션: ads-launch",
  },
  {
    // ★라벨 없음 — 오늘 가장 큰 미션인데 mission_label 이 안 붙었다.
    name: "M4 기업 AX (mission_label 없음)",
    text:
      "별개로 기업 ax시장도 빠르게 나가야될거같아 우리 마블로와 함께 감사로그 + 어제 해자로 " +
      "말해준 코스트 결과로그까지 마블로웹 아래에 클라이언트별 하위 대시보드 페이지를 만들어 " +
      "시용자와 로그 코스트 다양한데이터를 보여주는 대시보드를 만들까바 어때? " +
      "진짜 기업용 b2b 사스 늨김으로 조직관리자 있고 데이터들 볼수있게",
    tasks: [
      { id: "12S93hQxd4LhBmzsh36n", title: "기업 AX 클라이언트 대시보드" },
    ],
    expectWhat: "사장님 지시: 기업 AX 클라이언트 대시보드",
  },
  {
    // ★라벨 없음.
    name: "M5 마블로비서 (mission_label 없음)",
    text:
      "B로 가려고해 왜냐면 헤르메스에이전트나 그록봇처럼 개발자가 아니더라도 마블로를 " +
      "비서형 에이전트로 쓸 수 있게 만들려는 것도 하나의 계획이거든. 그래서 나는 탭하나를 " +
      "뒀으면 하는게 거기에 위키 (개인의 지식이나 회사의지식 프로젝트 지식 보관하는 방법 " +
      "가이드가 필요) 그리고 슬랙이나 텔레그램 연결 별도 가이드 또 한번 더, 그리고 이후 " +
      "오케를 비서로 두고 다양한 서브 에이전트를 역할별로 생성해서 (마케터 등등) 작업을 " +
      "요청하면 오케비서가 진행하면서 보고하는 방식까지가려고해. 이걸 마블로봇 혹은 " +
      "마블로비서 같은 개념의 탭으로 가고싶거든",
    tasks: [{ id: "Xxqyj8TSLA4OFFlS0A0S", title: "마블로비서 탭" }],
    expectWhat: "사장님 지시: 마블로비서 탭",
  },
] as const;

/** ★같은 날 사장님이 준 **질문** 원문. 미션이 아니다. */
const OWNER_QUESTIONS_2026_08_24 = [
  "봇은 거를수있나?",
  "이거 잘하면 사용자 더 많은거 아냐?",
  "위키는 기본 가이드가 가이드탭에 들어가는거야?",
  "3명한테 보내는건가?",
  // ★어려운 케이스 — 의문형이지만 실질은 제안에 가깝다. 아래 별도 테스트에서
  //   "지금은 일부러 질문으로 본다" 는 판단과 그 근거를 못 박는다.
  "감사로그는 프러젝트 구현한 범위에서 보여주면 안더ㅣ나?",
] as const;

describe("① ★사장님이 준 미션 5건 — 원문 그대로 전부 체인에 남는다", () => {
  for (const m of OWNER_MISSIONS_2026_08_24) {
    it(`잡힌다: ${m.name}`, () => {
      const missions = buildOwnerMissions({ ...OWNER, text: m.text }, m.tasks);
      expect(missions).toHaveLength(1);
      expect(missions[0].what).toBe(m.expectWhat);
      expect(missions[0].taskIds).toEqual(m.tasks.map((t) => t.id));
    });
  }

  it("★5건 전부 — 포착률 100%", () => {
    const missed = OWNER_MISSIONS_2026_08_24.filter(
      (m) => buildOwnerMissions({ ...OWNER, text: m.text }, m.tasks).length === 0,
    ).map((m) => m.name);
    expect(missed).toEqual([]);
  });

  it("★mission_label 이 없어도 잡힌다 — 라벨을 판정축으로 잡았으면 2/5 를 놓쳤다", () => {
    // M4(기업 AX)·M5(마블로비서)는 라벨 없이 티켓만 생겼다. 라벨은 오케가
    // "묶을 만하다" 고 느낄 때만 붙었고, 그 느낌은 미션의 크기와 무관했다.
    const unlabeled = OWNER_MISSIONS_2026_08_24.filter((m) =>
      m.tasks.every((t) => !("missionLabel" in t)),
    );
    expect(unlabeled).toHaveLength(2);
    for (const m of unlabeled) {
      const [mission] = buildOwnerMissions({ ...OWNER, text: m.text }, m.tasks);
      expect(mission).toBeDefined();
      expect(mission.missionLabel).toBeUndefined();
      expect(mission.groupKey).toBe("");
    }
  });

  it("★오타·비문에 견딘다 — 어휘 매칭이 아니라 행동을 보기 때문이다", () => {
    // "짐행/규성/븜석/늨김" 같은 모바일 음성입력 오타가 판정에 전혀 안 쓰인다.
    for (const m of OWNER_MISSIONS_2026_08_24) {
      expect(ownerMissionVeto(m.text), m.name).toBeNull();
    }
  });

  it("★티켓이 근거로 붙는다 — 완료 판정이 보드 몫으로 남는다", () => {
    const [mission] = buildOwnerMissions(
      { ...OWNER, text: OWNER_MISSIONS_2026_08_24[0].text },
      OWNER_MISSIONS_2026_08_24[0].tasks,
    );
    // 자동 포착(오케 약속)은 일부러 티켓을 안 붙인다. 사장님 미션은 반대다 —
    // 티켓이 곧 그 미션의 실체이고, 붙어 있어야 rejectSelfReportReason 이
    // 자기보고 종료를 막는다.
    expect(mission.taskIds).toEqual([
      "LngjrQAiCL8YlWCW8TWi",
      "P8jS1Ot3d6m6yjLeHUNR",
    ]);
  });

  it("행동이 없으면(티켓 0건) 아무것도 안 잡는다 — 문장만으로는 후보도 안 만든다", () => {
    expect(
      buildOwnerMissions(
        { ...OWNER, text: OWNER_MISSIONS_2026_08_24[3].text },
        [],
      ),
    ).toEqual([]);
  });
});

describe("② ★질문은 미션이 아니다 — 같은 날 질문 5건 원문", () => {
  for (const q of OWNER_QUESTIONS_2026_08_24) {
    it(`거부권이 걸린다: ${q.slice(0, 26)}…`, () => {
      expect(ownerMissionVeto(q)).toBe("all_questions");
      // ★행동(티켓)이 있어도 안 잡는다 — 질문 뒤에 우연히 생긴 티켓은 오케 일이다.
      expect(
        buildOwnerMissions({ ...OWNER, text: q }, [
          { id: "t1", title: "무관한 티켓" },
        ]),
      ).toEqual([]);
    });
  }

  it("★알려진 경계 — 수사의문(제안)도 지금은 질문으로 본다", () => {
    // "…아냐?" 는 제안일 수도 질문일 수도 있다. 실측이 양쪽 다 준다:
    //   · "이거 잘하면 사용자 더 많은거 아냐?"                → 질문(미션 아님)
    //   · "…보여주면 안되나? 조직은 …넣어야하는 작업 아냐?"   → 실질은 제안
    // 어미로는 안 갈린다. 그래서 **물음표를 기준으로 삼고 둘 다 질문으로 본다.**
    // 근거: 이 티켓이 못 박은 우선순위 — "질문을 미션으로 쌓으면 체인이 다시
    // 쓰레기가 된다." 놓친 제안은 add_work_chain_item 이 여전히 받는다.
    expect(ownerMissionVeto("이거 잘하면 사용자 더 많은거 아냐?")).toBe(
      "all_questions",
    );
    expect(
      ownerMissionVeto("조직은 결국 언젠가는 넣어야하는 작업 아냐?"),
    ).toBe("all_questions");
  });

  it("질문이 섞였어도 지시가 하나라도 있으면 잡는다 — 거부권은 전칭일 때만", () => {
    // 거부권은 "확실히 미션이 아닌 것" 만 거른다. 한 문장이라도 서술/지시면
    // 행동 증거가 이긴다(놓치는 쪽이 아니라 잡는 쪽으로 기운다).
    // ★M3·M4 가 실제로 이 모양이다 — 중간에 "?" 가 있는데 미션이다.
    expect(ownerMissionVeto("봇은 거를수있나? 그리고 광고 돌리자.")).toBeNull();
    expect(ownerMissionVeto(OWNER_MISSIONS_2026_08_24[2].text)).toBeNull();
  });

  it("공손 의문 어미는 물음표가 없어도 질문이다", () => {
    expect(ownerMissionVeto("이거 지금 되나요")).toBe("all_questions");
    expect(ownerMissionVeto("언제쯤 끝날까요")).toBe("all_questions");
  });

  it("순수 수긍·인사는 미션이 아니다 — 뒤에 생긴 티켓은 오케 자기 일이다", () => {
    for (const ack of ["ㅇㅋ", "고마워", "수고했습니다", "네"]) {
      expect(ownerMissionVeto(ack)).toBe("acknowledgement");
    }
    // ★부분 일치가 아니다 — 수긍 뒤에 지시가 붙으면 미션이다.
    expect(ownerMissionVeto("고마워, 그리고 광고 돌리자.")).toBeNull();
  });

  it("슬래시 명령은 봇 조작이지 지시가 아니다", () => {
    expect(ownerMissionVeto("/start")).toBe("command");
  });
});

describe("③ ★한 통에 미션이 여럿이면 갈라진다 — 우리가 아니라 오케가 쪼갠다", () => {
  // ★티켓 본문의 "광고+봇+어드민 한 통" 은 사실이 아니었다(위 정정 (1)).
  // 진짜 다가닥 사례는 M4(감사로그 대시보드 + 코스트 대시보드 + 조직관리자)와
  // M5(위키 가이드 + 채널 연결 가이드 + 역할별 서브에이전트 + 탭)다.
  const M5 = OWNER_MISSIONS_2026_08_24[4];

  it("mission_label 단위로 갈린다 — 라벨당 항목 하나", () => {
    const missions = buildOwnerMissions({ ...OWNER, text: M5.text }, [
      { id: "t1", title: "위키 탭", missionLabel: "marblo-secretary" },
      { id: "t2", title: "채널 연결 가이드", missionLabel: "marblo-secretary" },
      { id: "t3", title: "역할별 서브에이전트", missionLabel: "sub-agents" },
    ]);
    expect(missions).toHaveLength(2);
    expect(missions.map((m) => m.missionLabel)).toEqual([
      "marblo-secretary",
      "sub-agents",
    ]);
    // 같은 라벨의 티켓 둘은 한 항목의 근거로 모인다 — 체인이 보드의 사본이
    // 되면 안 된다(§7).
    expect(missions[0].taskIds).toEqual(["t1", "t2"]);
  });

  it("★라벨이 없으면 그 메시지의 무라벨 묶음 하나가 된다 — M4·M5 의 실제 모양", () => {
    const missions = buildOwnerMissions({ ...OWNER, text: M5.text }, [
      { id: "t1", title: "마블로비서 탭" },
      { id: "t2", title: "위키 가이드" },
    ]);
    expect(missions).toHaveLength(1);
    expect(missions[0].groupKey).toBe("");
    expect(missions[0].what).toBe("사장님 지시: 마블로비서 탭 외 1건");
    expect(missions[0].taskIds).toEqual(["t1", "t2"]);
  });
});

describe("④ ★사장님 한 줄을 그대로 밭지 않는다 — 제목의 출처를 못 박는다", () => {
  const M1 = OWNER_MISSIONS_2026_08_24[0];

  it("항목 제목은 사장님 문장이 아니라 mission_label 에서 온다", () => {
    const [mission] = buildOwnerMissions({ ...OWNER, text: M1.text }, M1.tasks);
    expect(mission.what).toBe("사장님 미션: ads-launch");
    // 사장님 구어체가 제목으로 새 나가지 않는다.
    expect(mission.what).not.toContain("1일만쓰고");
    expect(mission.what).not.toContain("어쨌든");
  });

  it("라벨이 없으면 오케가 쓴 **티켓 제목**에서 온다 — 여전히 사장님 문장이 아니다", () => {
    const M4 = OWNER_MISSIONS_2026_08_24[3];
    const [mission] = buildOwnerMissions({ ...OWNER, text: M4.text }, M4.tasks);
    expect(mission.what).toBe("사장님 지시: 기업 AX 클라이언트 대시보드");
    expect(mission.what).not.toContain("만들까바");
    expect(mission.what).not.toContain("늨김");
  });

  it("원문은 why 에 근거로만 남는다 — 판정에는 안 쓴다", () => {
    const [mission] = buildOwnerMissions({ ...OWNER, text: M1.text }, M1.tasks);
    expect(mission.why).toContain("1일만쓰고");
    expect(mission.why).toContain("행동");
    // 닫는 규칙이 항목 안에 들어 있어야 나중에 오케가 되짚지 않는다.
    expect(mission.why).toContain("자기보고로 닫을 수 없다");
  });

  it("포착 알림은 근거 티켓과 닫는 규칙을 같이 준다", () => {
    const note = formatOwnerMissionNote([
      { id: "wc_1", what: "사장님 미션: ads-launch", taskIds: ["t1"] },
    ]);
    expect(note).toContain("wc_1");
    expect(note).toContain("t1");
    expect(note).toContain("자기보고로 닫히지 않는다");
    expect(formatOwnerMissionNote([], [])).toBe("");
  });
});

// ── ★소음 실측 ──────────────────────────────────────────────────────────
//
// 완료 기준: "강제가 걸리는 호출 비율을 숫자로. 전 호출에 걸리면 실패다."
// 아래 코퍼스는 이 저장소의 **실제** 텍스트다 — git log 제목(오케/에이전트가 쓴
// 커밋 메시지), 실제 티켓 지시문 조각, 워커가 오케에 올린 보고문. 자동 포착이
// 이런 평범한 문장에 반응하기 시작하면 체인은 쓰레기로 덮이고 기능이 죽는다.

/** 실제 커밋 제목 (git log --format=%s). */
const REAL_COMMIT_SUBJECTS = [
  "fix(beginner): render empty board before setup",
  "[비기너·P0] 첫 화면에 보드가 아예 없다 — idle 이면 스트립을 통째로 안 그리는 게이트를 연다",
  "[오케·안정성] 멈춘 에이전트 신호(W8) — 보드 무활동 워치독 신호 + dispatch 정지 담당 우회",
  "[오케·기억] 오케가 다음에 할 일을 잊는다 — 워크체인을 보드 옆에 남기고 이어서 집도록",
  "[홍보·에셋] 온보딩 프리뷰를 격리 클린룸에서 녹화하는 하네스 + 데모 라벨 테스트 정합",
  "[보드·UX] 완료 티켓을 최근 완료순으로 + 보드 가로 드래그 이동",
  "[결제·계정] 결제는 됐는데 앱은 영구히 Free — 체크아웃 링크에 검증 가능한 계정 힌트를 싣는다",
  "[오케·권한] claim 을 넘는 길을 열되, 넘은 사실이 반드시 남게 한다",
  "[분석·표현] 매핑 불가를 '적재 전' 에서 가르고, 128.6% 를 계산 지점에서 막는다",
  "docs(보안·가명화): 소급 미적용 실측 보고 — 다리는 1개가 아니라 5개",
  "[에이전트탭·표시] env-swap 벤더를 하네스 이름 뒤에서 꺼낸다",
  "[어드민·리텐션] window 를 기본으로, 코호트 셀을 아래 사용자별 표로 잇는다",
  "fix(빌드): app.asar 이 electron-builder 출력물을 삼키던 결함 — 설치본 234MB→140MB",
  "[협업·깃허브·구현] GitHub App v2 — contents:write + 마블로 역할 게이트",
  "fix(보안·결제): plan 게이팅의 요금제를 서버측 Firestore 구독 레코드에서 유래시킨다",
  "[SEO·P0] 루트를 한국어 실제 페이지로 — localePrefix as-needed + /ko/* 301 전수",
  "fix(rules): missions 쓰기 축 크로스테넌트 격리 — 읽기만 닫혀 있었고 삭제는 뚫려 있었다",
  "feat(팀): 팀 오버뷰 v1 백엔드 — 오너가 멤버별 사용량을 보는 봉투",
  "[CI·비용] PR 에서 설치파일 매트릭스를 끊는다 — mac 2레그가 비용의 96%",
  "[분석·수익·P1] 내부·테스트 결제를 매출에서 갈라낸다 — 첫 숫자가 사장님 테스트 건이었다",
];

/** 실제 티켓 지시문 조각 (dispatch_task instruction 에 실려 나가는 문장들). */
const REAL_DISPATCH_INSTRUCTIONS = [
  "초크포인트 특정 — 후속이 생기면서 동시에 잊히는 자리를 먼저 찾아라.",
  "강제 방식 4개를 비교하고 하나를 골라라. 각각의 오탐 비용과 소음 비용을 적어라.",
  "★최소로 걸어라. 매 호출마다 강제 질문이 뜨면 오케가 형식적으로 빈 항목을 적기 시작한다.",
  "기존 수동 경로(add_work_chain_item 직접 호출)는 그대로 살려둔다.",
  "SQLAlchemy 관계 조회 시 반드시 selectinload() 를 사용한다.",
  "보드 파생 완료 판정(§7)에 회귀 없을 것 — 이 설계는 옳다. 건드리지 마라.",
  "개발·테스트는 에뮬레이터로 진행하고, 라이브 검증은 배포 후에 해라.",
  "시크릿·토큰·.env 원문 출력 금지.",
  "TypeScript strict mode 를 따른다. any 를 도입하지 않는다.",
  "Firestore 컬렉션/문서 경로는 상수로 유지한다.",
  "렌더러 프로세스에서 받은 데이터를 검증한다.",
  "첫 화면에서 보드가 비어 보이는 원인을 실측으로 규명하고 렌더 경계를 고친다.",
  "리뷰 결과를 add_activity 로 남기고 submit_for_review 를 호출한다.",
  "타입체크와 유닛 테스트를 돌려 회귀가 없음을 확인한다.",
  "PR 본문에 근거를 남긴다.",
];

/** 실제 워커 보고문 / 오케 진행 메모 형태. */
const REAL_REPORTS = [
  "구현 완료: 렌더러 경계에서 부트 출력을 가르는 필터를 추가했습니다.",
  "검증 완료: npm run typecheck 통과, vitest 331건 통과.",
  "PR #1142 를 올렸습니다. 리뷰 부탁드립니다.",
  "작업 시작 — 코드 실측 완료. work-chain-core.ts 568줄을 읽었습니다.",
  "테스트가 3건 실패해서 원인을 파고 있습니다.",
  "보드에서 티켓 상태를 REVIEW 로 옮겼습니다.",
  "에이전트가 30분째 무활동이라 워치독이 정지 의심으로 표시했습니다.",
  "머지 확인했고 워크트리를 정리했습니다.",
  "타입 오류 2건은 strict 모드 누락 때문이었습니다.",
  "질문에 대한 답을 받아 반영했습니다.",
];

function fireRate(corpus: readonly string[], surface: CaptureSurface): number {
  const fired = corpus.filter(
    (t) => detectFollowUpPromises(t, surface).length > 0,
  ).length;
  return fired / corpus.length;
}

describe("★소음 실측 — 발화율은 숫자로 못 박는다", () => {
  it("실제 커밋 제목 20건: 사장님 보고 표면에서 0% 발화", () => {
    const fired = REAL_COMMIT_SUBJECTS.filter(
      (t) => detectFollowUpPromises(t, "owner_report").length > 0,
    );
    // 실패했을 때 어느 문장이 걸렸는지 바로 보이게 한다.
    expect(fired).toEqual([]);
  });

  it("실제 지시문 15건: dispatch 표면에서 0% 발화", () => {
    const fired = REAL_DISPATCH_INSTRUCTIONS.filter(
      (t) => detectFollowUpPromises(t, "dispatch_instruction").length > 0,
    );
    expect(fired).toEqual([]);
  });

  it("실제 보고문 10건: activity 표면에서 0% 발화", () => {
    const fired = REAL_REPORTS.filter(
      (t) => detectFollowUpPromises(t, "activity").length > 0,
    );
    expect(fired).toEqual([]);
  });

  it("코퍼스 45건 전체 발화율은 5% 미만이어야 한다(회귀 가드)", () => {
    // ★넓은 실측 기준선 — 이 저장소의 실제 커밋 메시지 **400건 전문**(제목+본문,
    // 638KB)에 감지기를 그대로 돌린 결과:
    //     owner_report / activity / answer : 400건 중 5건 발화 = **1.3%**
    //     dispatch_instruction             : 400건 중 0건 발화 = **0.0%**
    // 커밋 본문은 여기 인용한 짧은 문장보다 훨씬 길고 설계 근거문이 가득한,
    // 감지기에 **가장 불리한** 텍스트다. 그런데도 1.3% 다 — "전 호출에 걸리면
    // 실패" 라는 완료 기준과는 두 자릿수 배수의 여유가 있다.
    // 재현: git log --format='%B%x00' -400 > corpus.txt 후 감지기를 각 메시지에 적용.
    const all = [
      ...REAL_COMMIT_SUBJECTS,
      ...REAL_DISPATCH_INSTRUCTIONS,
      ...REAL_REPORTS,
    ];
    expect(fireRate(all, "owner_report")).toBeLessThan(0.05);
  });

  it("그러면서도 진짜 약속 코퍼스는 100% 잡는다 — 정밀도만 높고 못 잡으면 무용지물", () => {
    const promises = [
      "규칙을 한 번 더 배포해야 합니다.",
      "이 티켓이 끝나면 프론트 검증을 해야 한다.",
      "머지되면 후속 티켓 두 개를 열겠습니다.",
      "[다음] firestore.rules 프로덕션 배포",
      "지금 그건 제 머릿속에만 있는 다음 할 일입니다.",
    ];
    expect(fireRate(promises, "owner_report")).toBe(1);
  });
});

// ══ ★2026-09-04 노이즈 폭발 (티켓 GvgBoZ5ajEKTT7G5rWME) ═══════════════════
//
// 실측: 워크체인 open=82 / closed=118. 열린 82개의 대부분이 이 모듈의 산물이고
// why 가 전부 "오케가 약속 어미로 말함" 이었다. 한도(당시 전체 길이 200)가 차자
// create_task · send_telegram_message 가 실패해 **사장님 지시가 기록되지 못했다.**
// 아래 원문은 그날 체인에서 그대로 가져온 것이다 — 지어내지 않았다.

/** 그날 체인에 실제로 열려 있던 자동 포착 노이즈. */
const NOISE_2026_09_04 = [
  "제대로 잡겠습니다.", // wc_uaidlrsha6
  "이의 있으시면 되돌리겠습니다", // wc_3rug2mkbom
  "머지 후 제가 돌리겠습니다.", // wc_3zktut78ax
  "을 정본으로 남기겠습니다.", // 인용 삭제가 남긴 부스러기
  "■ 하나 챙겨두겠습니다",
] as const;

describe("★어미만 있는 문장은 항목이 되지 않는다 (GvgBoZ5ajEKTT7G5rWME)", () => {
  for (const sentence of NOISE_2026_09_04) {
    it(`잡지 않는다: ${sentence}`, () => {
      for (const surface of SPEECH_SURFACES) {
        expect(
          detectFollowUpPromises(sentence, surface),
          `${surface}: ${sentence}`,
        ).toEqual([]);
      }
    });
  }

  it("★발화율 0% — 실측 노이즈 5건 중 0건", () => {
    const fired = NOISE_2026_09_04.filter(
      (t) => detectFollowUpPromises(t, "owner_report").length > 0,
    );
    expect(fired).toEqual([]);
  });

  it("무엇을 하겠다는 건지가 문장에 있으면 같은 어미라도 잡는다", () => {
    // 좁힌 축이 "어미" 가 아니라 "목적어" 라는 사실 — 노이즈와 한 글자 차이다.
    expect(
      detectFollowUpPromises("증발 지점을 제대로 잡겠습니다.", "owner_report"),
    ).toHaveLength(1);
    expect(
      detectFollowUpPromises("머지 후 제가 인덱스를 돌리겠습니다.", "owner_report"),
    ).toHaveLength(1);
  });

  it("조사만 남은 부스러기는 길이와 무관하게 항목이 아니다", () => {
    // "을 …" 로 시작하면 앞의 명사가 인용 삭제로 사라졌다는 뜻이다.
    expect(
      detectFollowUpPromises(
        "을 정본으로 남기고 나머지 문서를 전부 정리하겠습니다.",
        "owner_report",
      ),
    ).toEqual([]);
  });
});

describe("★같은 문장이 두 번 등록되지 않는다 (GvgBoZ5ajEKTT7G5rWME)", () => {
  // 실측: 완전히 같은 문장이 세 항목으로 열려 있었다
  //   wc_nk0xou6qi7 · wc_ksky6ff7kr · wc_4qbgjewiqm
  const SAME =
    "같은 깔때기에 트래픽을 다시 붓기 전에 73% 증발 지점을 고쳐야 한다.";

  it("이 문장 자체는 여전히 잡힌다 — 중복이 문제였지 포착이 문제가 아니었다", () => {
    expect(detectFollowUpPromises(SAME, "owner_report")).toHaveLength(1);
  });

  it("이미 열려 있으면 다시 적지 않는다", () => {
    const [hit] = detectFollowUpPromises(SAME, "owner_report");
    expect(dedupeAgainstChain([hit], [chainItem(SAME)])).toEqual([]);
  });

  it("한 번의 호출에서도 같은 문장은 하나만 남는다", () => {
    const hits = detectFollowUpPromises(`${SAME}\n${SAME}`, "owner_report");
    expect(hits).toHaveLength(1);
  });

  it("★쓰기 트랜잭션과 감지가 같은 판정 함수를 쓴다", () => {
    // 판정을 두 벌 두면 트랜잭션 안팎이 어긋나 중복이 다시 샌다.
    // work-chain.ts 의 findOpenDuplicate 가 부르는 함수가 이것이다.
    const key = normalizeForCompare(SAME);
    expect(isDuplicateWhat(key, key)).toBe(true);
    expect(isDuplicateWhat(key, normalizeForCompare("전혀 다른 약속입니다"))).toBe(
      false,
    );
  });
});

describe("★노이즈 일괄 정리 — 사장님 항목과 근거 있는 항목은 못 건드린다", () => {
  const auto = (what: string, over: Partial<WorkChainItem> = {}): WorkChainItem => ({
    ...chainItem(what),
    id: `wc_${normalizeForCompare(what).slice(0, 8)}`,
    source: "auto",
    sourceTool: "send_telegram_message",
    ...over,
  });

  it("오늘 규칙으로 안 잡히는 자동 포착 항목만 고른다", () => {
    const plan = planAutoNoisePrune([
      auto("제대로 잡겠습니다."),
      auto("■ 하나 챙겨두겠습니다"),
      auto("증발 지점을 제대로 잡겠습니다."), // 오늘 규칙으로도 잡힌다 → 남긴다
    ]);
    expect(plan.prune.map((e) => e.what)).toEqual([
      "제대로 잡겠습니다.",
      "■ 하나 챙겨두겠습니다",
    ]);
    expect(plan.scannedOpen).toBe(3);
    expect(plan.kept).toBe(1);
  });

  it("★사장님 지시(source=owner)는 어떤 문장이어도 대상이 아니다", () => {
    const owner: WorkChainItem = {
      ...chainItem("제대로 잡겠습니다."),
      id: "wc_owner",
      source: "owner",
      sourceTool: "create_task",
    };
    expect(planAutoNoisePrune([owner]).prune).toEqual([]);
  });

  it("★오케가 손으로 적은 항목(manual)도 대상이 아니다", () => {
    const manual: WorkChainItem = {
      ...chainItem("제대로 잡겠습니다."),
      id: "wc_manual",
      source: "manual",
    };
    expect(planAutoNoisePrune([manual]).prune).toEqual([]);
    // source 가 아예 없는 구버전 항목도 manual 취급이라 안전하다.
    expect(
      planAutoNoisePrune([{ ...chainItem("제대로 잡겠습니다."), id: "wc_old" }])
        .prune,
    ).toEqual([]);
  });

  it("★근거 티켓·미션·선행이 붙은 항목은 대상이 아니다", () => {
    const cases = [
      auto("제대로 잡겠습니다.", { taskIds: ["t1"] }),
      auto("제대로 잡겠습니다.", { missionLabel: "광고" }),
      auto("제대로 잡겠습니다.", { afterTaskIds: ["t2"] }),
    ];
    for (const c of cases) {
      expect(planAutoNoisePrune([c]).prune, c.what).toEqual([]);
    }
  });

  it("이미 닫힌 항목은 다시 닫지 않는다", () => {
    const closed: WorkChainItem = {
      ...auto("제대로 잡겠습니다."),
      closed: { kind: "dropped", reason: "이미 닫음", at: 2, by: "x" },
    };
    expect(planAutoNoisePrune([closed]).prune).toEqual([]);
  });

  it("같은 문장 중복은 가장 오래된 하나만 남긴다", () => {
    const SAME = "같은 깔때기에 트래픽을 다시 붓기 전에 73% 증발 지점을 고쳐야 한다.";
    const plan = planAutoNoisePrune([
      { ...auto(SAME), id: "wc_nk0xou6qi7", createdAt: 10 },
      { ...auto(SAME), id: "wc_ksky6ff7kr", createdAt: 20 },
      { ...auto(SAME), id: "wc_4qbgjewiqm", createdAt: 30 },
    ]);
    expect(plan.prune.map((e) => e.id)).toEqual([
      "wc_ksky6ff7kr",
      "wc_4qbgjewiqm",
    ]);
    expect(plan.prune[0].reason).toContain("wc_nk0xou6qi7");
  });

  it("무엇을 지우는지 목록으로 남긴다 — 사유까지 한 줄씩", () => {
    const plan = planAutoNoisePrune([auto("제대로 잡겠습니다.")]);
    const out = formatNoisePrunePlan(plan, false);
    expect(out).toContain("제대로 잡겠습니다.");
    expect(out).toContain("dry-run");
    expect(out).toContain("send_telegram_message");
    expect(formatNoisePrunePlan(plan, true)).toContain("정리 완료");
  });

  it("정리할 게 없으면 그렇게 말한다", () => {
    expect(formatNoisePrunePlan(planAutoNoisePrune([]), false)).toContain(
      "노이즈 없음",
    );
  });
});
