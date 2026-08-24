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
  dedupeAgainstChain,
  detectFollowUpPromises,
  evaluateUnit,
  formatCaptureNote,
  normalizeForCompare,
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
    "마지막에 X 티켓 열겠다",
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

  it("목적어 있는 '확인하겠다' 는 보고 행위가 아니라 다음 일이다", () => {
    expect(
      detectFollowUpPromises("배포 후 로그를 확인하겠다", "owner_report"),
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
      detectFollowUpPromises("규칙을 한 번 더 배포해야 합니다.", "owner_report"),
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
