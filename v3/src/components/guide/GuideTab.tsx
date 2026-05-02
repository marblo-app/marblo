/**
 * Guide tab — onboarding-friendly first-tab cheatsheet for Marblo's
 * required workflow primitives (TaskForce slash commands, Marblo MCP,
 * multi-window, Harness store).
 *
 * Pure content. No backend calls. Designed to be the first thing a new
 * user sees so they understand the building blocks before opening the
 * Board / Code / Agents tabs.
 */

interface GuideSection {
  title: string;
  body: React.ReactNode;
}

const TF_COMMANDS: Array<{ cmd: string; what: string }> = [
  {
    cmd: "/tf-start",
    what: "프로젝트를 시작 — 분석 + 태스크 분해 + 에이전트 스폰 한 번에",
  },
  {
    cmd: "/tf-analyze",
    what: "요구사항을 분석하고 컴포넌트 / 역할 / 의존성 파악",
  },
  {
    cmd: "/tf-create-tasks",
    what: "분석 결과를 Marblo MCP에 태스크로 일괄 생성",
  },
  { cmd: "/tf-spawn-agents", what: "필요한 역할의 에이전트를 자동 스폰" },
  {
    cmd: "/tf-status",
    what: "프로젝트 태스크 진행 상태를 대시보드 형태로 요약",
  },
  { cmd: "/tf-add", what: "진행 중 새 태스크 추가 / 우선순위·설명 수정" },
  { cmd: "/tf-fix", what: "FAILED / BLOCKED 태스크 진단 및 복구" },
  { cmd: "/tf-handoff", what: "에이전트가 실패한 태스크를 직접 이어받아 완료" },
  { cmd: "/tf-hold", what: "태스크 일시 보류 / 재개" },
  { cmd: "/tf-review", what: "REVIEW 상태 태스크 검토 후 DONE 처리" },
  { cmd: "/tf-feedback", what: "PM 피드백을 태스크에 등록" },
  { cmd: "/tf-ralph", what: "Ralph 패턴으로 반복 작업을 티켓 단위로 추적" },
  { cmd: "/tf-resume", what: "이전 세션 재개 (현 진행 상황 컨텍스트 복구)" },
  { cmd: "/tf-sync", what: "Firestore ↔ 로컬 상태 동기화" },
  { cmd: "/tf-work", what: "내 역할의 다음 사용 가능 태스크 클레임 후 작업" },
  { cmd: "/tf-done", what: "현재 태스크 완료 처리 + PR URL 첨부" },
  { cmd: "/tf-plan", what: "복잡한 작업의 계획 수립 (Plan 모드)" },
  { cmd: "/tf-guide", what: "TaskForce 워크플로우 사용 가이드" },
];

const SECTIONS: GuideSection[] = [
  {
    title: "1. Marblo란",
    body: (
      <p className="text-sm text-[#bac2de] leading-relaxed">
        Marblo는 이종 AI 에이전트(Claude Code / Gemini / Codex)를 가상 터미널로
        분할 호출하여, 오케스트레이터가 칸반 보드와 연동해 컨텍스트를 유지하며
        태스크를 운영하는 데스크탑 도구입니다. 한 창 = 한 프로젝트가 기본, 창을
        더 열면 다른 프로젝트를 동시에 굴릴 수 있습니다.
      </p>
    ),
  },
  {
    title: "2. 시작하기 — 프로젝트 만들고 오케스트레이터 띄우기",
    body: (
      <ol className="list-decimal pl-5 text-sm text-[#bac2de] space-y-1.5">
        <li>좌측 사이드바에서 프로젝트 폴더 선택 (또는 새로 만들기)</li>
        <li>아래 오케스트레이터 패널이 자동으로 Claude Code를 띄움</li>
        <li>
          오케스트레이터에 자연어로 요청 → <code>/tf-start</code> 또는
          <code>/tf-analyze</code> 사용
        </li>
        <li>Board 탭에서 생성된 태스크를 확인 / 편집</li>
        <li>Agents 탭에서 스폰된 에이전트 모니터링</li>
      </ol>
    ),
  },
  {
    title: "3. TaskForce 슬래시 커맨드",
    body: (
      <div>
        <p className="mb-3 text-sm text-[#bac2de] leading-relaxed">
          <code>/tf-*</code> 슬래시 커맨드는 Marblo 설치 시 자동으로 사용자
          Claude Code에 등록됩니다. 어느 디렉터리에서 Claude를 띄우든 슬래시
          메뉴에 노출됩니다.
        </p>
        <div className="space-y-1 text-xs">
          {TF_COMMANDS.map((c) => (
            <div
              key={c.cmd}
              className="flex gap-3 border-b border-[#313244]/50 py-1"
            >
              <code className="shrink-0 w-32 font-mono text-[#89b4fa]">
                {c.cmd}
              </code>
              <span className="text-[#bac2de]">{c.what}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    title: "4. Marblo MCP — 오케스트레이터 ↔ 칸반 ↔ 에이전트",
    body: (
      <div className="text-sm text-[#bac2de] leading-relaxed space-y-2">
        <p>
          Marblo MCP 서버는 자동으로 사용자 Claude Code의 글로벌 설정에
          등록됩니다 (<code>~/.claude.json</code>). Marblo 앱이 실행 중이면 외부
          Claude Code 세션에서도 다음 도구를 호출할 수 있습니다:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <code>create_task / get_all_tasks / update_task_status</code> — 칸반
            태스크 CRUD
          </li>
          <li>
            <code>spawn_agent / dispatch_task / reuse_agent / kill_agent</code>{" "}
            — 에이전트 라이프사이클
          </li>
          <li>
            <code>notify_orchestrator / add_activity</code> — 메시지 전달 / 진행
            기록
          </li>
          <li>
            <code>search_tasks / get_agent_skill</code> — 검색 / 역할 스킬 조회
          </li>
        </ul>
        <p className="text-[#6c7086]">
          ⓘ 동적 포트는 <code>~/.marblo/bridge-port</code> 디스커버리 파일로
          전달되므로 사용자가 따로 설정할 필요 없습니다.
        </p>
      </div>
    ),
  },
  {
    title: "5. 멀티윈도우 — 여러 프로젝트 동시 작업",
    body: (
      <div className="text-sm text-[#bac2de] leading-relaxed space-y-2">
        <p>
          상단 메뉴에서 새 창을 열면 다른 프로젝트의 오케스트레이터 / 에이전트를
          동시에 굴릴 수 있습니다. 창마다 독립된 PTY / Bridge 라우팅이 적용되어
          서로 간섭하지 않습니다.
        </p>
        <p className="text-[#6c7086]">
          같은 프로젝트를 두 창에서 열면 의도적으로 인스턴스를 공유합니다
          (연속성 유지). 다른 프로젝트는 완전히 격리됩니다.
        </p>
      </div>
    ),
  },
  {
    title: "6. Harness 스토어 — 추천 스킬 / MCP 한 번에 설치",
    body: (
      <div className="text-sm text-[#bac2de] leading-relaxed space-y-2">
        <p>
          상단 탭의 <strong>Harness</strong> 또는 단축키{" "}
          <kbd className="rounded bg-[#313244] px-1.5 py-0.5 text-xs">
            Cmd/Ctrl + Shift + H
          </kbd>{" "}
          로 Harness 스토어를 엽니다. 큐레이팅된 패키지(superpowers, gstack,
          context7 / filesystem / github MCP 등)를 카드 클릭으로 설치 / 제거할
          수 있습니다.
        </p>
        <p className="text-[#6c7086]">
          <strong>필수 (자동 설치)</strong> 카테고리는 Marblo 설치 시 이미
          글로벌에 깔린 항목입니다. 추천 / MCP 카테고리는 옵션입니다.
        </p>
      </div>
    ),
  },
  {
    title: "7. 다음 단계",
    body: (
      <ul className="list-disc pl-5 text-sm text-[#bac2de] space-y-1">
        <li>Board 탭에서 태스크 흐름 확인</li>
        <li>Agents 탭에서 에이전트 라이프사이클 / 비용 모니터링</li>
        <li>Settings에서 BYOK API 키 등록 (Anthropic / OpenAI / Google)</li>
        <li>Harness에서 추가 스킬 / MCP 설치 후 워크플로우 확장</li>
      </ul>
    ),
  },
];

export function GuideTab() {
  return (
    <div className="h-full w-full overflow-y-auto bg-[#181825] p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="border-b border-[#313244] pb-4">
          <h1 className="text-xl font-bold text-[#cdd6f4]">
            Marblo 시작 가이드
          </h1>
          <p className="mt-1 text-sm text-[#6c7086]">
            AI 에이전트 군대를 조립하고 오케스트레이션 — 핵심 빌딩 블록 한
            페이지 요약
          </p>
        </header>

        {SECTIONS.map((section) => (
          <section
            key={section.title}
            className="rounded-md border border-[#313244] bg-[#1e1e2e] p-4"
          >
            <h2 className="mb-3 text-base font-semibold text-[#cdd6f4]">
              {section.title}
            </h2>
            {section.body}
          </section>
        ))}

        <footer className="border-t border-[#313244] pt-4 text-xs text-[#6c7086]">
          더 자세한 내용은 <code>docs/project_status.md</code> 또는 PRD 문서
          참조.
        </footer>
      </div>
    </div>
  );
}
