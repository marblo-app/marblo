/**
 * Mission Replay — 파생 뷰 모델 타입 (Phase 1).
 *
 * 설계 단일소스: `docs/MISSION-REPLAY-DESIGN.md` §2.2.
 *
 * ★이 타입은 **Firestore 에 저장되지 않는다.** 이미 구독 중인 문서(`missions`,
 * `tasks`, `activities`, `audit_logs`, `projectAuditLog`, `merge_history`)에서
 * 클라이언트가 조립하는 파생 뷰다 — `lib/shareCard.ts` 의 `ShareStats` 와 같은
 * 성격이고, Phase 1 은 **신규 계측 0 / 신규 write 0** 이다(설계 §2.3).
 *
 * 조립 진입점은 `lib/replay/missionReplay.ts`, 비트 매핑은 `lib/replay/beats.ts`,
 * 민감도 분류·게이트는 `lib/replay/sensitivity.ts` 다. 전부 순수 함수 — 레닭션
 * (Phase 2)이 UI 경로와 발행 경로에서 **같은 함수**를 공유해야 "화면엔 가려졌는데
 * 업로드된 바이트엔 원문이 남는" 실패를 구조적으로 막을 수 있기 때문이다(설계 §1.1).
 */

/** 이 비트가 어느 층에서 일어난 일인가. UI 레인 + 레닭션 분류의 1급 축. */
export type ReplayLane = "human" | "orchestrator" | "agent" | "system";

/**
 * 비트의 소스 출처. 프로버넌스 표기 + 디버깅용.
 *
 * 이 유니온이 곧 Replay 가 읽는 소스의 전부다 — `provenance.sources` 의 키도
 * 같은 값을 쓴다(키가 갈리면 "어느 레인이 권한 때문에 비었나"를 못 맞춘다).
 */
export type ReplaySource =
  | "mission.contextLog"
  | "task"
  | "task.activity"
  | "audit_logs"
  | "projectAuditLog"
  | "merge_history";

/**
 * 공개 등급. 낮을수록 안전. **기본값은 항상 `"private"`** (설계 §5.2 P1 default-deny).
 *
 * 비트를 만들 때 분류를 명시하지 않으면 private 이다. 새 이벤트 타입이 추가돼도
 * (누가 `TimelineEventType` 에 한 줄 더 넣어도) 그것은 자동으로 비공개다.
 */
export type ReplaySensitivity =
  | "private" // 절대 밖으로 안 나감 (기본값)
  | "process" // "무엇을 했는가"만 — 단계명·상태전이·수치
  | "summary" // + 요약 문장·PR 링크·파일 수
  | "detail"; // + 코드/터미널 발췌 (사용자가 명시 동의한 경우만)

/**
 * 사용자가 고르는 공개 등급 (설계 §5.3). Phase 2 의 UI 축이지만, 게이트 골격이
 * Phase 1 에 있으므로 어휘도 여기서 못 박는다.
 *
 * - `L0` 비공개(기본) — 아무것도 나가지 않는다.
 * - `L1` 과정만 — 수치·상태전이.
 * - `L2` 일부(권장) — + 요약 문장·PR.
 * - `L3` 전체 — + 코드/터미널 발췌. ★그래도 시크릿·경로·PII 는 무조건 제거된다.
 */
export type ReplayVisibilityLevel = "L0" | "L1" | "L2" | "L3";

export interface ReplayBeat {
  /** 결정적 id — (source, sourceId) 해시. 재집계해도 같은 비트는 같은 id. */
  id: string;
  ts: Date;
  lane: ReplayLane;
  source: ReplaySource;
  /** 소스별 원 타입 (예: "step.completed", "task.status_changed"). */
  kind: string;
  taskId: string | null;
  /** 익명화된 에이전트 별칭 (예: "agent-1 · claude"). */
  agentRef: string | null;
  /** 익명화된 사람 별칭 (예: "member-1"). */
  actorRef: string | null;
  /**
   * 한 줄 서사.
   *
   * ★UI 문자열이 아니라 **데이터 파생 문자열**이다(태스크 제목·툴 이름·이벤트
   * 타입 코드). 로케일 문자열을 여기 굽지 않는 이유: 이 lib 은 렌더러 밖(발행·
   * 익스포트 경로)에서도 같은 값을 내야 하고, 화면 문구는 `kind` 로 UI 가
   * 번역해 붙이면 된다.
   */
  title: string;
  /** 확장 시 본문. 자유 텍스트가 들어올 수 있어 대개 `private` 로 분류된다. */
  detail?: string;
  /** ★분류는 집계 시점에 붙는다. 발행 시점에 뒤늦게 정하지 않는다. */
  sensitivity: ReplaySensitivity;
}

export interface ReplayCastMember {
  /** 익명 별칭 (예: "agent-1 · claude"). */
  agentRef: string;
  /** `agents.model` — 벤더/하네스 계열 (claude/gpt/grok/…). */
  vendor: string;
  /** `agents.spawnedModel` — 무엇으로 띄웠나. 없을 수 있다(모델 미핀 스폰). */
  spawnedModel: string | null;
  /** `agents.detectedModelId` — 무엇이 실제로 과금됐나(관측). */
  detectedModelId: string | null;
  role: string;
  tasksCompleted: number;
  beats: number;
}

export interface ReplayStats {
  tasks: number;
  tasksDone: number;
  agents: number;
  prs: number;
  /** `merge_history.filesChanged` 합 — 원본 diff 를 한 번도 읽지 않는다. */
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  /** `computeShareStats` 재사용 — 완료보고 키워드 heuristic 이라 근사값. */
  testsPassed: number;
  riskFlags: number;
  /**
   * `testsPassed`/`riskFlags` 의 **분모** — 완료보고를 실제로 읽어본 태스크 수.
   *
   * ★설계 문서 §2.2 의 타입에는 없는 칸이다. 그런데 두 heuristic 축은 완료보고
   * 에서만 나오고, 구독 계층은 리스너 폭발을 막으려고 최신 N건의 보고만 읽는다
   * (설계 R5, 기존 `MAX_TRACKED=50` 패턴). 분모를 안 주면 화면이 "12건 통과"라고만
   * 말하게 되고, 사용자는 그걸 12/12 로 읽는다 — 실제로는 12/207 일 수 있다.
   * `ShareStats.reportsScanned` 가 정확히 같은 이유로 이미 존재하므로, 같은
   * 사실을 Replay 에서만 버리지 않는다. 신규 계측이 아니라 **파생값**이다.
   */
  reportsScanned: number;
  /** `task.retriesCount` 합. */
  retries: number;
  durationMs: number;
  /** 비용은 기본 private. 공개 등급과 **별개의 독립 opt-in**(설계 R14). */
  costTotal: number | null;
}

/**
 * 소스별 읽기 결과.
 *
 * ★`denied`(권한 없음)와 `empty`(권한은 있는데 기록이 0건)를 **절대 같은 값으로
 * 접지 않는다**. `projectAuditLog` 는 owner/admin 전용이라(설계 C2) 일반 멤버
 * 화면에서 human 레인이 통째로 빈다 — 그걸 "아무도 안 했다"로 그리면 감사에서
 * 가장 나쁜 실패(조용한 누락)가 된다. `lib/projectAuditView.ts` 의
 * `AuditLoadState` 가 같은 이유로 이미 이 구분을 지키고 있다.
 */
export type ReplaySourceState = "ok" | "denied" | "empty";

/**
 * 개요 한 줄 — 미션이 쪼개진 태스크 하나.
 *
 * ★담기는 것은 **큐레이션된 제목 + PR 번호 + 의존 ref** 뿐이다. 본문·경로·코드·
 * 담당자는 애초에 들어오지 않는다(`lib/replay/missionOutline.ts` 헤더). 그래서
 * 이 구조는 그 자체로 공유 가능하고, 무거운 2차 비식별이 필요 없다.
 */
export interface ReplayOutlineTask {
  /** 표시용 순번 — 의존성 위상순서로 매긴 "A"·"B"·"C". */
  ref: string;
  title: string;
  /** ★번호만. URL 은 저장소 좌표를 담아 경계 밖으로 내보내지 않는다. */
  prNumber: number | null;
  /** 이 태스크가 기다린 태스크들의 ref(미션 내부 간선만). */
  dependsOn: string[];
  done: boolean;
}

/** 미션의 작업 분해 + 의존성 머지 순서. 조립은 `lib/replay/missionOutline.ts`. */
export interface ReplayOutline {
  tasks: ReplayOutlineTask[];
  /** 완료된 태스크의 PR 번호를 의존성 순서로 나열 — 머지 서사의 근거. */
  mergeOrder: number[];
  /** 실제로 의존 간선이 있었나(없으면 "병렬로 돌았다"가 사실이다). */
  hasDependencies: boolean;
  /** 상한 때문에 개요에서 빠진 태스크 수. 조용한 절단 금지. */
  truncated: number;
}

export interface MissionReplay {
  replayVersion: 1;
  missionId: string;
  projectId: string;
  goal: string;
  templateId: string;
  launchedAt: Date;
  completedAt: Date | null;
  stats: ReplayStats;
  cast: ReplayCastMember[];
  /** ts 오름차순. 동시각은 id 로 안정 정렬(재집계해도 순서가 안 흔들린다). */
  beats: ReplayBeat[];
  prUrls: string[];
  /**
   * 작업 분해 + 의존성 머지 순서 (미션 서사 GIF 의 1급 소스).
   *
   * `beats` 와 겹치지 않는다: 비트는 "언제 무슨 일이 있었나"(시간축)이고, 개요는
   * "무엇이 무엇을 기다렸나"(의존축)다. 후자는 시간축에서 복원할 수 없다.
   */
  outline: ReplayOutline;
  /** 어떤 소스가 실제로 읽혔는지 — 권한 부족으로 빠진 레인을 UI 가 정직하게 표시. */
  provenance: {
    sources: Record<ReplaySource, ReplaySourceState>;
    generatedAt: Date;
  };
}

/** The only shape that may cross a future export/publish boundary. */
export interface RedactedReplay {
  level: Exclude<ReplayVisibilityLevel, "L0">;
  payload: unknown;
  /** Exact bytes consumed by preview and, later, the publisher. */
  serialized: string;
  removed: RedactionRemoval[];
  verified: boolean;
}

export interface RedactionRemoval {
  path: string;
  rule: string;
  action: string;
}
