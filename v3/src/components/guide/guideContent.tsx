/**
 * Guide tab long-form content — split ko/en.
 *
 * Why a content module instead of `guide.*` translation keys: the guide is 8
 * rich-JSX sections plus an 18-row command table. Keying every sentence would
 * explode the locale table and make the prose unreadable across two files.
 * Instead the whole body lives here as parallel ko/en blocks (the pattern
 * sanctioned by ../../locales/README.md for long-form copy). The page chrome
 * (title/subtitle/footer) stays as `guide.*` keys; GuideTab picks the block
 * for the active locale.
 *
 * Translation boundary: `/tf-*` slash-command names, MCP tool names, file
 * paths and keyboard chords are identifiers — kept verbatim in both locales.
 */
import type { Locale } from "../../lib/i18n";

export interface GuideSection {
  title: string;
  body: React.ReactNode;
}

interface GuideContent {
  sections: GuideSection[];
}

interface TfCommand {
  cmd: string;
  what: string;
}

const KO_COMMANDS: TfCommand[] = [
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

const EN_COMMANDS: TfCommand[] = [
  {
    cmd: "/tf-start",
    what: "Start a project — analyze + break down tasks + spawn agents in one shot",
  },
  {
    cmd: "/tf-analyze",
    what: "Analyze requirements and identify components / roles / dependencies",
  },
  {
    cmd: "/tf-create-tasks",
    what: "Bulk-create tasks in Marblo MCP from the analysis",
  },
  { cmd: "/tf-spawn-agents", what: "Auto-spawn agents for the roles you need" },
  {
    cmd: "/tf-status",
    what: "Summarize task progress for the project as a dashboard",
  },
  {
    cmd: "/tf-add",
    what: "Add a new task mid-flight / edit priority and description",
  },
  { cmd: "/tf-fix", what: "Diagnose and recover FAILED / BLOCKED tasks" },
  {
    cmd: "/tf-handoff",
    what: "Have an agent take over and finish a failed task directly",
  },
  { cmd: "/tf-hold", what: "Pause / resume a task" },
  { cmd: "/tf-review", what: "Review tasks in REVIEW and mark them DONE" },
  { cmd: "/tf-feedback", what: "Register PM feedback on a task" },
  {
    cmd: "/tf-ralph",
    what: "Track repetitive work ticket by ticket with the Ralph pattern",
  },
  {
    cmd: "/tf-resume",
    what: "Resume a previous session (restore current-progress context)",
  },
  { cmd: "/tf-sync", what: "Sync Firestore ↔ local state" },
  {
    cmd: "/tf-work",
    what: "Claim and work the next available task for your role",
  },
  { cmd: "/tf-done", what: "Mark the current task done + attach the PR URL" },
  { cmd: "/tf-plan", what: "Plan a complex task (Plan mode)" },
  { cmd: "/tf-guide", what: "TaskForce workflow usage guide" },
];

function CommandTable({ commands }: { commands: TfCommand[] }) {
  return (
    <div className="space-y-1 text-xs">
      {commands.map((c) => (
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
  );
}

const KO: GuideContent = {
  sections: [
    {
      title: "1. Marblo란",
      body: (
        <p className="text-sm text-[#bac2de] leading-relaxed">
          Marblo는 이종 AI 에이전트(Claude Code / Gemini / Codex)를 가상
          터미널로 분할 호출하여, 오케스트레이터가 칸반 보드와 연동해 컨텍스트를
          유지하며 태스크를 운영하는 데스크탑 도구입니다. 한 창 = 한 프로젝트가
          기본, 창을 더 열면 다른 프로젝트를 동시에 굴릴 수 있습니다.
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
          <CommandTable commands={KO_COMMANDS} />
        </div>
      ),
    },
    {
      title: "4. Marblo MCP — 오케스트레이터 ↔ 칸반 ↔ 에이전트",
      body: (
        <div className="text-sm text-[#bac2de] leading-relaxed space-y-2">
          <p>
            Marblo MCP 서버는 자동으로 사용자 Claude Code의 글로벌 설정에
            등록됩니다 (<code>~/.claude.json</code>). Marblo 앱이 실행 중이면
            외부 Claude Code 세션에서도 다음 도구를 호출할 수 있습니다:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <code>create_task / get_all_tasks / update_task_status</code> —
              칸반 태스크 CRUD
            </li>
            <li>
              <code>
                spawn_agent / dispatch_task / reuse_agent / kill_agent
              </code>{" "}
              — 에이전트 라이프사이클
            </li>
            <li>
              <code>notify_orchestrator / add_activity</code> — 메시지 전달 /
              진행 기록
            </li>
            <li>
              <code>search_tasks / get_agent_skill</code> — 검색 / 역할 스킬
              조회
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
            상단 메뉴에서 새 창을 열면 다른 프로젝트의 오케스트레이터 /
            에이전트를 동시에 굴릴 수 있습니다. 창마다 독립된 PTY / Bridge
            라우팅이 적용되어 서로 간섭하지 않습니다.
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
      title: "7. 텔레그램 채널 연결 — 에이전트 알림 / 제어를 텔레그램으로",
      body: (
        <div className="text-sm text-[#bac2de] leading-relaxed space-y-3">
          <p>
            텔레그램 봇을 연결하면 에이전트 진행 상황을 알림으로 받고, 텔레그램
            채팅으로 오케스트레이터에 메시지를 보낼 수 있습니다. 아래 순서대로
            설정합니다.
          </p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              <strong>봇 생성 → 토큰 발급:</strong> 텔레그램에서{" "}
              <code className="text-[#89b4fa]">@BotFather</code> 와 대화를 열고{" "}
              <code className="text-[#89b4fa]">/newbot</code> 으로 봇을 만든 뒤,
              발급된 <strong>봇 토큰</strong>(
              <code className="text-[#89b4fa]">123456:ABC-DEF...</code> 형식)을
              복사합니다.
            </li>
            <li>
              <strong>봇을 채널 / 그룹에 추가 → chatId 확인:</strong> 알림을
              받을 채널(또는 그룹)에 위 봇을 멤버로 추가한 뒤, 해당 대화의{" "}
              <strong>chatId</strong> 를 확인합니다. 예:{" "}
              <code className="text-[#89b4fa]">
                api.telegram.org/bot&lt;토큰&gt;/getUpdates
              </code>{" "}
              응답의 <code className="text-[#89b4fa]">chat.id</code> 값. 채널은
              보통 <code className="text-[#89b4fa]">-100...</code> 으로
              시작합니다.
            </li>
            <li>
              <strong>telegram 플러그인 설치:</strong> 사용자 Claude Code에{" "}
              <code className="text-[#89b4fa]">
                plugin:telegram@claude-plugins-official
              </code>{" "}
              플러그인을 설치합니다 (Harness 스토어 또는 플러그인 마켓).
            </li>
            <li>
              <strong>하네스탭 채널 패널에 입력 → 토글:</strong> 상단{" "}
              <strong>Harness</strong> 탭의 채널 패널에 봇 토큰과 chatId 를
              입력하고, 토글을 켜서 채널을 활성화합니다.
            </li>
          </ol>
          <p className="rounded-md border border-[#f9e2af]/30 bg-[#f9e2af]/10 px-3 py-2 text-[#f9e2af]">
            ⚠️ 채널 설정은{" "}
            <strong>이후 새로 launch 하는 오케스트레이터에만</strong>{" "}
            적용됩니다. 이미 실행 중인 오케스트레이터에 반영하려면{" "}
            <strong>해당 오케스트레이터를 재시작</strong>해야 합니다.
          </p>
        </div>
      ),
    },
    {
      title: "8. 다음 단계",
      body: (
        <ul className="list-disc pl-5 text-sm text-[#bac2de] space-y-1">
          <li>Board 탭에서 태스크 흐름 확인</li>
          <li>Agents 탭에서 에이전트 라이프사이클 / 비용 모니터링</li>
          <li>Settings에서 BYOK API 키 등록 (Anthropic / OpenAI / Google)</li>
          <li>Harness에서 추가 스킬 / MCP 설치 후 워크플로우 확장</li>
        </ul>
      ),
    },
  ],
};

const EN: GuideContent = {
  sections: [
    {
      title: "1. What is Marblo",
      body: (
        <p className="text-sm text-[#bac2de] leading-relaxed">
          Marblo is a desktop tool that fans heterogeneous AI agents (Claude
          Code / Gemini / Codex) out across virtual terminals, while an
          orchestrator keeps context and runs your tasks in sync with a kanban
          board. One window = one project by default; open more windows to run
          other projects at the same time.
        </p>
      ),
    },
    {
      title:
        "2. Getting started — create a project and launch the orchestrator",
      body: (
        <ol className="list-decimal pl-5 text-sm text-[#bac2de] space-y-1.5">
          <li>
            Pick a project folder in the left sidebar (or create a new one)
          </li>
          <li>The orchestrator panel below auto-launches Claude Code</li>
          <li>
            Ask the orchestrator in natural language → use{" "}
            <code>/tf-start</code> or <code>/tf-analyze</code>
          </li>
          <li>Review / edit the generated tasks on the Board tab</li>
          <li>Monitor spawned agents on the Agents tab</li>
        </ol>
      ),
    },
    {
      title: "3. TaskForce slash commands",
      body: (
        <div>
          <p className="mb-3 text-sm text-[#bac2de] leading-relaxed">
            <code>/tf-*</code> slash commands are registered into your Claude
            Code automatically when Marblo is installed. They show up in the
            slash menu no matter which directory you launch Claude from.
          </p>
          <CommandTable commands={EN_COMMANDS} />
        </div>
      ),
    },
    {
      title: "4. Marblo MCP — orchestrator ↔ kanban ↔ agents",
      body: (
        <div className="text-sm text-[#bac2de] leading-relaxed space-y-2">
          <p>
            The Marblo MCP server is registered into your Claude Code global
            config automatically (<code>~/.claude.json</code>). While the Marblo
            app is running, even external Claude Code sessions can call these
            tools:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <code>create_task / get_all_tasks / update_task_status</code> —
              kanban task CRUD
            </li>
            <li>
              <code>
                spawn_agent / dispatch_task / reuse_agent / kill_agent
              </code>{" "}
              — agent lifecycle
            </li>
            <li>
              <code>notify_orchestrator / add_activity</code> — message delivery
              / progress logging
            </li>
            <li>
              <code>search_tasks / get_agent_skill</code> — search / role-skill
              lookup
            </li>
          </ul>
          <p className="text-[#6c7086]">
            ⓘ The dynamic port is handed off via the{" "}
            <code>~/.marblo/bridge-port</code> discovery file, so there's
            nothing to configure manually.
          </p>
        </div>
      ),
    },
    {
      title: "5. Multi-window — work on several projects at once",
      body: (
        <div className="text-sm text-[#bac2de] leading-relaxed space-y-2">
          <p>
            Open a new window from the top menu to run another project's
            orchestrator / agents simultaneously. Each window gets independent
            PTY / Bridge routing, so they don't interfere with one another.
          </p>
          <p className="text-[#6c7086]">
            Opening the same project in two windows intentionally shares the
            instance (to keep continuity). Different projects stay fully
            isolated.
          </p>
        </div>
      ),
    },
    {
      title: "6. Harness store — install recommended skills / MCP in one click",
      body: (
        <div className="text-sm text-[#bac2de] leading-relaxed space-y-2">
          <p>
            Open the Harness store from the <strong>Harness</strong> tab up top
            or the shortcut{" "}
            <kbd className="rounded bg-[#313244] px-1.5 py-0.5 text-xs">
              Cmd/Ctrl + Shift + H
            </kbd>
            . Install / remove curated packages (superpowers, gstack, context7 /
            filesystem / github MCP, etc.) with a click on a card.
          </p>
          <p className="text-[#6c7086]">
            The <strong>Required (auto-installed)</strong> category is already
            installed globally when Marblo is set up. The Recommended / MCP
            categories are optional.
          </p>
        </div>
      ),
    },
    {
      title:
        "7. Connect a Telegram channel — agent notifications / control over Telegram",
      body: (
        <div className="text-sm text-[#bac2de] leading-relaxed space-y-3">
          <p>
            Connect a Telegram bot to receive agent progress as notifications
            and to message the orchestrator from a Telegram chat. Set it up in
            the order below.
          </p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              <strong>Create a bot → get a token:</strong> In Telegram, open a
              chat with <code className="text-[#89b4fa]">@BotFather</code> and
              create a bot with <code className="text-[#89b4fa]">/newbot</code>,
              then copy the issued <strong>bot token</strong> (format{" "}
              <code className="text-[#89b4fa]">123456:ABC-DEF...</code>).
            </li>
            <li>
              <strong>
                Add the bot to a channel / group → find the chatId:
              </strong>{" "}
              Add the bot as a member of the channel (or group) that should
              receive notifications, then find that chat's{" "}
              <strong>chatId</strong>. E.g. the{" "}
              <code className="text-[#89b4fa]">chat.id</code> value in the
              response of{" "}
              <code className="text-[#89b4fa]">
                api.telegram.org/bot&lt;token&gt;/getUpdates
              </code>
              . Channels usually start with{" "}
              <code className="text-[#89b4fa]">-100...</code>.
            </li>
            <li>
              <strong>Install the telegram plugin:</strong> Install the{" "}
              <code className="text-[#89b4fa]">
                plugin:telegram@claude-plugins-official
              </code>{" "}
              plugin into your Claude Code (via the Harness store or the plugin
              marketplace).
            </li>
            <li>
              <strong>
                Enter it in the Harness tab channel panel → toggle:
              </strong>{" "}
              Enter the bot token and chatId in the channel panel of the{" "}
              <strong>Harness</strong> tab up top, and flip the toggle to
              activate the channel.
            </li>
          </ol>
          <p className="rounded-md border border-[#f9e2af]/30 bg-[#f9e2af]/10 px-3 py-2 text-[#f9e2af]">
            ⚠️ Channel settings apply{" "}
            <strong>only to orchestrators launched afterward</strong>. To apply
            them to an already-running orchestrator, you must{" "}
            <strong>restart that orchestrator</strong>.
          </p>
        </div>
      ),
    },
    {
      title: "8. Next steps",
      body: (
        <ul className="list-disc pl-5 text-sm text-[#bac2de] space-y-1">
          <li>Check the task flow on the Board tab</li>
          <li>Monitor agent lifecycle / cost on the Agents tab</li>
          <li>
            Register BYOK API keys in Settings (Anthropic / OpenAI / Google)
          </li>
          <li>
            Install extra skills / MCP from Harness to extend your workflow
          </li>
        </ul>
      ),
    },
  ],
};

export const GUIDE_CONTENT: Record<Locale, GuideContent> = { ko: KO, en: EN };
