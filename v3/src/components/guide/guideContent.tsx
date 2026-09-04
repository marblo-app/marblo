/**
 * Guide tab long-form content — split ko/en.
 *
 * Why a content module instead of `guide.*` translation keys: the guide is a
 * dozen rich-JSX sections plus two generated tables and an FAQ. Keying every
 * sentence would explode the locale table and make the prose unreadable across
 * two files. Instead the whole body lives here as parallel ko/en blocks (the
 * pattern sanctioned by ../../locales/README.md for long-form copy). The page
 * chrome (title/subtitle/footer) stays as `guide.*` keys; GuideTab picks the
 * block for the active locale.
 *
 * ★ ACCURACY RULE — the two things that always drifted are generated here, not
 * typed by hand:
 *   - the tab reference reads {@link visibleRightTabs} (real bar order, real
 *     dev-flag gating) and labels each row with the SAME `workspace.tab.*` key
 *     the tab bar renders;
 *   - the slash-command table reads {@link SLASH_COMMANDS} (the orchestrator's
 *     own palette) with its `orchestrator.cmd.*` descriptions.
 * Only the per-tab prose is written per locale. A tab or command added
 * elsewhere shows up here on its own; a hand-maintained copy is what let the
 * old guide advertise a fleet ("Gemini", "BYOK API keys") that no longer
 * existed and miss four shipped commands.
 *
 * ★ SCOPE vs the 시작하기 (Start here) tab: that tab DOES the setup — install,
 * sign-in, folder connect, first ticket, with live probe state. This guide does
 * not re-teach those steps; it explains what each surface is for and links back
 * to that tab. Keep it that way so the two never contradict each other.
 *
 * Translation boundary: `/tf-*` slash-command names, MCP tool names, file paths
 * and keyboard chords are identifiers — kept verbatim in both locales.
 */
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import {
  visibleRightTabs,
  type RightTabId,
} from "../../lib/splitWorkspaceLayout";
import { SLASH_COMMANDS } from "../orchestrator/SlashCommandPopup";

export interface GuideSection {
  /** Stable anchor id — also the React key and the table-of-contents target. */
  id: string;
  title: string;
  body: React.ReactNode;
}

interface GuideContent {
  sections: GuideSection[];
}

/** Per-tab prose, written per locale. Keys come from the real tab list. */
type TabNotes = Record<RightTabId, string>;

interface FaqItem {
  q: string;
  a: React.ReactNode;
}

// Same feature-flag mechanism as WorkTabs — dev-only tabs (missions/flows/
// deploy) are documented only when VITE_DEV_FEATURES lists their id, so the
// guide never describes a tab the reader cannot see.
const devFeatures = (import.meta.env.VITE_DEV_FEATURES || "")
  .split(",")
  .map((s: string) => s.trim());

// ─────────────────────────────────────────────────────────────────────────────
// Presentational helpers
// ─────────────────────────────────────────────────────────────────────────────

const P = "text-sm leading-relaxed text-[#bac2de]";
const MUTED = "text-xs leading-relaxed text-[#6c7086]";

function Note({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn";
  children: React.ReactNode;
}) {
  const cls =
    tone === "warn"
      ? "border-[#f9e2af]/30 bg-[#f9e2af]/10 text-[#f9e2af]"
      : "border-[#89b4fa]/25 bg-[#89b4fa]/5 text-[#a6adc8]";
  return (
    <p className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${cls}`}>
      {children}
    </p>
  );
}

/**
 * The tab reference. Order, membership and labels come from the shell itself —
 * only the description column is authored copy.
 */
function TabTable({ notes }: { notes: TabNotes }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 text-xs">
      {visibleRightTabs(devFeatures).map((id) => (
        <div
          key={id}
          data-testid="guide-tab-row"
          data-tab={id}
          className="flex flex-col gap-0.5 border-b border-[#313244]/50 py-1.5 sm:flex-row sm:gap-3"
        >
          <span className="shrink-0 font-medium text-[#89b4fa] sm:w-28">
            {t(`workspace.tab.${id}` as MessageKey)}
          </span>
          <span className="min-w-0 text-[#bac2de]">{notes[id]}</span>
        </div>
      ))}
    </div>
  );
}

/** The orchestrator's own slash-command palette, rendered as a reference. */
function CommandTable() {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 text-xs">
      {SLASH_COMMANDS.map((c) => (
        <div
          key={c.command}
          data-testid="guide-command-row"
          data-command={c.command}
          className="flex flex-col gap-0.5 border-b border-[#313244]/50 py-1 sm:flex-row sm:gap-3"
        >
          <code className="shrink-0 font-mono text-[#89b4fa] sm:w-40">
            {c.command}
          </code>
          <span className="min-w-0 text-[#bac2de]">{t(c.description)}</span>
        </div>
      ))}
    </div>
  );
}

function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <details
          key={item.q}
          className="group rounded-md border border-[#313244] bg-[#181825] px-3 py-2"
        >
          <summary className="cursor-pointer list-none text-sm font-medium text-[#cdd6f4] marker:content-none">
            <span className="mr-1.5 text-[#89b4fa] group-open:hidden">＋</span>
            <span className="mr-1.5 hidden text-[#89b4fa] group-open:inline">
              －
            </span>
            {item.q}
          </summary>
          <div className="mt-2 border-t border-[#313244] pt-2 text-xs leading-relaxed text-[#bac2de]">
            {item.a}
          </div>
        </details>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 한국어
// ─────────────────────────────────────────────────────────────────────────────

const KO_TAB_NOTES: TabNotes = {
  startHere:
    "설치 → 로그인 → 폴더 연결 → 첫 티켓까지 4단계 체크리스트. 진행 상황이 저장돼 다시 열면 멈춘 자리에서 이어집니다. 건너뛴 단계도 사라지지 않고 목록에 남습니다. 시연 영상과 인터랙티브 데모도 여기 있습니다.",
  guide: "지금 보고 있는 이 문서.",
  board:
    "칸반 보드. 오케스트레이터가 만든 티켓이 TODO · CLAIMED · IN_PROGRESS · REVIEW · DONE 다섯 칸으로 흐릅니다. BLOCKED / FAILED 는 위쪽 ‘정체’ 레인에 따로 모입니다. 카드를 열면 상세 · 활동 타임라인 · diff 를 볼 수 있습니다.",
  code: "Monaco 에디터. 사이드바 파일 트리에서 연 파일을 편집하고, 상단 선택으로 루트와 워크트리를 오갑니다. 마크다운 · 이미지 · 노트북은 전용 뷰로 열립니다.",
  lanes:
    "퀵레인. 메인 작업을 멈추지 않고, 방금 눈에 띈 개선점을 독립 워크트리에서 병렬로 돌립니다. 레인마다 터미널이 붙고 미션도 여기서 관리합니다.",
  browser:
    "앱 안 웹 브라우저. 주소창에 주소를 넣거나, 다른 화면(코드 미리보기 등)에서 링크를 누르면 여기에 탭으로 열립니다. 탭을 여러 개 띄우고 좌우로 나눠 볼 수 있어서, 에이전트가 띄운 로컬 데모를 앱을 떠나지 않고 확인합니다. 로그인 · 결제 페이지는 임베디드 브라우저에서 막히는 경우가 많아 시스템 브라우저로 보내고, 그때는 이유를 알림으로 알려 줍니다.",
  agents:
    "마블로봇 — 봇 갤러리, 봇 실행 상태, 트리거 설정을 봅니다. 실행 목록은 봇으로 분류된 에이전트만 보여 줍니다.",
  fleet:
    "플릿 관리 — 스폰된 에이전트 전체의 상태 · 담당 티켓 · 비용을 보고 중지 / 재시작 / 삭제합니다. 터미널 화면 자체는 왼쪽 터미널 열에 있습니다.",
  project:
    "이 프로젝트의 ‘사람’ 쪽 — 멤버 · 역할 · 초대 · 멤버별 작업량. 초대와 역할 부여는 설정 › 팀과 같은 화면을 공유합니다(팀 기능은 유료 플랜).",
  worktrees:
    "티켓마다 격리된 브랜치 작업 폴더 목록. 머지 가능 · 뒤처짐 · stale · 충돌 상태를 한눈에 보고, diff 확인 · 머지 · 정리를 여기서 합니다.",
  history:
    "완료된 티켓과 에이전트가 남긴 완료 보고, 머지 이력. 기간 · 역할로 거르고 공유 카드로 성과를 내보낼 수 있습니다.",
  usage:
    "모델별 · 에이전트별 · 일자별 토큰 사용량과 비용 추정. 라이브 집계(에이전트 문서)와 히스토리(BigQuery)를 합쳐 보여 줍니다.",
  store:
    "공개 레지스트리 카탈로그 — 스킬 · MCP 서버 · 에이전트 · 워크플로 · 지식팩 · 로컬 모델을 골라 담습니다. ‘있으면 좋은 것’ 쪽입니다.",
  harness:
    "이 앱을 쓰려면 ‘반드시’ 해야 하는 연결 — CLI 설치와 로그인, env-swap 벤더 키, 텔레그램 채널. 스토어가 선택이라면 여기는 필수 배선입니다.",
  missions: "미션 — 여러 단계를 묶어 굴리는 실행 단위 (개발 플래그 전용).",
  flows:
    "플로우 에디터 — 노드로 파이프라인을 짭니다 (베타 · 개발 플래그 전용).",
  deploy: "배포 탭 — GCP Cloud Run 배포 (개발 플래그 전용).",
  settings:
    "프로필 · 모델 · 요금제 · 팀 · 프라이버시 · 언어 · 버그 신고. 헤더의 톱니바퀴로도 열립니다.",
};

const KO_FAQ: FaqItem[] = [
  {
    q: "CLI 를 꼭 설치해야 하나요?",
    a: (
      <>
        네. 오케스트레이터와 에이전트는 설치된 CLI 위에서 실제 프로세스로
        돕니다. Claude Code 가 필수이고 Codex · Grok · Antigravity 는
        선택입니다. <strong>시작하기</strong> 탭 ①단계의{" "}
        <strong>‘모두 설치’</strong> 버튼이 아직 없는 것만 골라 순서대로
        설치합니다.
      </>
    ),
  },
  {
    q: "원클릭 설치가 실패했어요 (EACCES · npm 권한 오류 등)",
    a: (
      <>
        실패한 CLI 카드에 수동 설치 명령과 공식 문서 링크가 그대로 남습니다.
        터미널에서 그 명령을 직접 실행한 뒤 <strong>‘다시 확인’</strong> 을
        누르면 상태가 갱신됩니다. 개별 [설치] 버튼은 실패한 한 줄만 재시도하는
        용도로 남아 있습니다.
      </>
    ),
  },
  {
    q: "로그인은 몇 개나 해야 하나요?",
    a: (
      <>
        Claude Code 와 Codex 중 <strong>하나만</strong> 로그인해도 시작할 수
        있습니다. <strong>시작하기</strong> 탭 ②단계의{" "}
        <strong>원클릭 사인인</strong> 을 누르면 터미널 탭이 자동으로 열리고
        로그인 명령까지 자동 입력됩니다 — 브라우저가 뜨면 승인만 하면 되고,
        완료되면 앱이 스스로 인식합니다.
      </>
    ),
  },
  {
    q: "Claude / ChatGPT 구독이 없어요.",
    a: (
      <>
        두 가지 길이 있습니다. ①<strong>구독</strong> — ②단계의 안내 링크에서
        공식 플랜에 가입하면 정액 한도 안에서 씁니다. ②
        <strong>벤더 키(BYOM)</strong> — GLM · MiniMax · Kimi 같은 공급자의 키를
        등록하면 별도 하네스를 깔지 않고도 Claude 사다리의 한 칸으로 들어옵니다.
        등록은 시작하기 탭 아래쪽 또는 <strong>하네스</strong> 탭에서 합니다.
      </>
    ),
  },
  {
    q: "AI 사용료가 마블로 요금에 포함되나요?",
    a: (
      <>
        아니요. 토큰 사용료는{" "}
        <strong>이미 쓰고 계신 Claude Code · Codex 계정으로 청구</strong>
        됩니다. 마블로 요금제는 앱 기능과 한도에 대한 것입니다 — Free 는
        프로젝트 1개 · 동시 에이전트 5명이고, 유료 플랜은 사실상 제한이
        없습니다(공정 사용). 쓴 양은 <strong>사용량</strong> 탭에서 확인합니다.
      </>
    ),
  },
  {
    q: "모델은 누가 고르나요? 프리셋의 퍼센트는 어디 갔나요?",
    a: (
      <>
        프리셋은 이제 <strong>고정 퍼센트가 아니라 후보 집합</strong>입니다.
        실제 선택은 디스패치마다 태그 · 잔여 쿼터 · 주간 한도 · 관측된 사용량 ·
        라우팅 그래프를 점수화해서 결정합니다. 기본값{" "}
        <strong>Auto (Marblo Recommended)</strong> 는 Claude · Codex · Grok 을
        경쟁시키고, env-swap 벤더(MiniMax · GLM · Kimi)는 Claude 사다리의 칸으로
        참가합니다. <strong>Cost Saver</strong> 는 구독 잔여를 아껴야 할
        자원으로 보게 만들어 싼 칸이 이기게 하고, <strong>Balanced</strong> 는
        Antigravity 까지 포함한 전 fleet 균등, 그 밖에 단일 하네스 전용과 Custom
        이 있습니다.
      </>
    ),
  },
  {
    q: "모델·프리셋을 바꿨는데 반영이 안 돼요.",
    a: (
      <>
        선택 자체는 즉시 저장되지만, 디스패치 라우팅과 오케스트레이터 하네스는
        Electron 메인 프로세스가 읽습니다. 실제 스폰 분포는{" "}
        <strong>앱을 재시작한 뒤</strong>부터 바뀝니다. 오케스트레이터 모델과
        텔레그램 채널 설정도 마찬가지로{" "}
        <strong>이후 새로 띄우는 오케스트레이터</strong>에만 적용되니, 돌고 있는
        오케스트레이터는 재시작해 주세요.
      </>
    ),
  },
  {
    q: "폴더는 어떻게 연결하나요? 첫 실행에 처음 보는 프로젝트가 열려 있어요.",
    a: (
      <>
        처음 실행하면 폴더를 고르기 전에도 제품이 움직이도록{" "}
        <code>&lt;문서&gt;/Marblo Sample</code> 에 의존성 없는 미니 예제
        프로젝트를 만들어 자동으로 연결합니다. 내 저장소로 바꾸려면 상단의{" "}
        <strong>폴더 열기 / 폴더 바꾸기</strong> 를 쓰면 됩니다. 이미 내용이
        있는 폴더는 <strong>한 바이트도 건드리지 않습니다</strong> — 비어 있을
        때만 예제를 심습니다.
      </>
    ),
  },
  {
    q: "화면이 너무 복잡해요. 대화창 하나만 보고 싶어요.",
    a: (
      <>
        헤더의 <strong>💬 비기너 모드</strong> 를 누르면 탭 · 보드 · 워크트리를
        접고 큰 오케스트레이터 대화창 하나만 남습니다. 반대로 비기너 모드
        상단바의 <strong>‘마블로 모드로 보기’</strong> 로 언제든 돌아옵니다.
        설정 › 프로필에도 같은 토글이 있고,{" "}
        <strong>진행 중인 에이전트는 모드를 바꿔도 그대로 계속 돕니다</strong>.
      </>
    ),
  },
  {
    q: "오케스트레이터가 안 뜹니다.",
    a: (
      <>
        순서대로 확인하세요. ① 폴더가 연결돼 있는지(미연결이면 기동을 시도조차
        하지 않습니다) ② <strong>시작하기</strong> 탭에서 CLI 가 ‘준비 완료’
        인지 — 인증이 없으면 스폰이 조용히 실패합니다 ③ ‘다시 확인’ 으로
        프로브를 갱신 ④ 그래도 안 되면 앱 재시작. 콜드 재시작 직후 터미널이
        까맣게 보이는 것은 정상이며, 클릭하거나 창 크기를 바꾸면 다시
        그려집니다.
      </>
    ),
  },
  {
    q: "설치 · 로그인 안내가 계속 다시 보입니다.",
    a: (
      <>
        온보딩은 모달이 아니라 <strong>시작하기</strong> 탭이라 닫아도 사라지지
        않고 그 자리에 남습니다(그게 의도입니다). 이 탭으로 착지하는 것만 끄고
        싶다면 탭 맨 아래의 <strong>‘시작할 때 이 탭으로 열지 않기’</strong> 를
        쓰세요 — 단계는 그대로 남습니다. 이미 끝낸 단계가 다시 남은 것으로
        보인다면 ‘다시 확인’ 을 눌러 프로브를 갱신해 주세요.
      </>
    ),
  },
  {
    q: "워크트리가 뭔가요? 왜 폴더가 계속 늘어나죠?",
    a: (
      <>
        에이전트는 서로의 작업을 덮어쓰지 않도록 티켓마다{" "}
        <strong>격리된 git 워크트리(=별도 브랜치 폴더)</strong>에서 일합니다.{" "}
        <strong>워크트리</strong> 탭에서 상태를 보고 diff 를 확인한 뒤 머지하고,
        끝난 것은 같은 화면에서 정리하면 됩니다.
      </>
    ),
  },
  {
    q: "여러 프로젝트를 동시에 굴리려면?",
    a: (
      <>
        새 창을 열면 됩니다(창 하나 = 프로젝트 하나). 창마다 PTY 와 Bridge
        라우팅이 독립이라 서로 간섭하지 않습니다. 같은 프로젝트를 두 창에서 열면
        연속성을 위해 인스턴스를 의도적으로 공유합니다.
      </>
    ),
  },
];

const KO: GuideContent = {
  sections: [
    {
      id: "what",
      title: "1. 마블로란",
      body: (
        <div className={`${P} space-y-2`}>
          <p>
            마블로는 <strong>AI 에이전트 팀의 관제탑</strong>입니다.
            오케스트레이터에게 말로 시키면 → 할 일을 티켓으로 쪼개고 → 각 티켓에
            맞는 에이전트를 실제 터미널 프로세스로 띄우고 → 티켓마다 격리된
            워크트리에서 작업해 → 보드와 완료 이력에 결과가 쌓입니다.
          </p>
          <p>
            에이전트는 이미 쓰고 계신 CLI(Claude Code · Codex · Grok ·
            Antigravity)로 돌아갑니다. 마블로는 그 위에서 무엇을 누구에게
            맡길지, 무엇이 끝났는지를 관리합니다.
          </p>
        </div>
      ),
    },
    {
      id: "first",
      title: "2. 처음 켰다면 — 비기너 모드와 마블로 모드",
      body: (
        <div className={`${P} space-y-2`}>
          <p>
            새로 설치한 기기는 <strong>비기너 모드</strong>로 열립니다. 탭도
            보드도 없이 오케스트레이터 대화창 하나뿐이라, 하고 싶은 말을 적어
            보내는 것만으로 첫 결과까지 갑니다. 진행 상황은 대화창 아래 라이브
            스트립에 미니 보드와 일하는 에이전트로 나타납니다.
          </p>
          <p>
            폴더를 아직 안 골랐어도 괜찮습니다 — 첫 실행에 예제 프로젝트가
            자동으로 연결돼 오케스트레이터가 바로 열립니다(아래 FAQ 참고).
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              비기너 → 마블로: 상단바 <strong>‘마블로 모드로 보기’</strong>. 첫
              작업이 끝나면 승격 안내도 한 번 뜹니다.
            </li>
            <li>
              마블로 → 비기너: 헤더의 <strong>💬 비기너 모드</strong>. 설정 ›
              프로필에도 같은 토글이 있습니다.
            </li>
          </ul>
          <Note>
            모드는 <strong>보여 주는 범위만</strong> 바꿉니다. 돌고 있는
            에이전트와 티켓은 그대로 유지되고, 마블로 모드로 돌아오면 열어
            두었던 탭까지 복원됩니다.
          </Note>
        </div>
      ),
    },
    {
      id: "setup",
      title: "3. 셋업은 ‘시작하기’ 탭에서 — 원클릭 두 개",
      body: (
        <div className={`${P} space-y-2`}>
          <p>
            설치와 로그인은 이 문서가 아니라 <strong>시작하기</strong> 탭이
            담당합니다. 상태를 실제로 검사해서 남은 것만 시키기 때문입니다.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <strong>모두 설치</strong> — 아직 없는 CLI 만 골라 순서대로
              설치합니다. 이미 있는 것은 건너뜁니다.
            </li>
            <li>
              <strong>원클릭 사인인</strong> — 터미널 탭이 자동으로 열리고
              로그인 명령이 자동 입력됩니다. 브라우저 승인만 하면 앱이 완료를
              스스로 인식합니다. Claude Code · Codex 중 하나면 충분합니다.
            </li>
            <li>
              <strong>폴더 연결</strong> — 첫 실행이면 예제 프로젝트가 이미
              연결돼 있습니다. 내 저장소로 바꾸려면 폴더 열기.
            </li>
            <li>
              <strong>첫 티켓</strong> — 여기까지 오면 마블로가 실제로 무엇을
              해주는지 눈으로 보입니다.
            </li>
          </ol>
          <p className={MUTED}>
            네 단계는 저장돼 다시 열면 멈춘 자리에서 이어지고, 건너뛴 단계도
            목록에서 사라지지 않습니다. 막히면 각 단계에 ‘막혔을 때’ 대안이 함께
            적혀 있습니다.
          </p>
        </div>
      ),
    },
    {
      id: "layout",
      title: "4. 화면 구성",
      body: (
        <div className={`${P} space-y-2`}>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>왼쪽 터미널 열</strong> — 위는 오케스트레이터, 아래는
              에이전트 터미널. 가운데 경계선을 끌어 폭과 높이를 조절하고, 창이
              좁아지면 자동으로 접힙니다.
            </li>
            <li>
              <strong>오른쪽 작업 탭</strong> — 보드 · 코드 · 워크트리 등. 탭을
              바꿔도 왼쪽 터미널은 그대로 살아 있습니다.
            </li>
            <li>
              <strong>사이드바</strong> — 파일 트리와 프로젝트 전환.
            </li>
            <li>
              <strong>Activity 패널</strong> —{" "}
              <kbd className="rounded bg-[#313244] px-1.5 py-0.5 text-xs">
                Cmd/Ctrl + Shift + A
              </kbd>{" "}
              로 열리는 실시간 활동 스트림. 항목을 누르면 해당 탭으로
              이동합니다.
            </li>
          </ul>
          <p className={MUTED}>
            창 하나 = 프로젝트 하나가 기본입니다. 새 창을 열면 다른 프로젝트를
            동시에 굴릴 수 있고, 창마다 PTY / Bridge 라우팅이 독립입니다.
          </p>
        </div>
      ),
    },
    {
      id: "tabs",
      title: "5. 탭별 안내",
      body: (
        <div className="space-y-3">
          <p className={P}>
            아래 목록은 지금 이 빌드의 탭 바를 그대로 읽어 만듭니다 — 순서도
            구성도 화면과 같습니다.
          </p>
          <TabTable notes={KO_TAB_NOTES} />
        </div>
      ),
    },
    {
      id: "orchestrator",
      title: "6. 오케스트레이터에게 시키기",
      body: (
        <div className="space-y-3">
          <div className={`${P} space-y-2`}>
            <p>
              그냥 한국어로 말하면 됩니다 — “결제 실패 로그를 조사해서 원인
              티켓으로 쪼개 줘” 같은 식으로. 정형화된 작업에는 아래{" "}
              <code>/tf-*</code> 슬래시 커맨드가 더 빠릅니다. 입력창에{" "}
              <code>/</code> 를 치면 같은 목록이 자동완성으로 뜹니다.
            </p>
            <p className={MUTED}>
              이 커맨드는 마블로 설치 시 사용자 Claude Code 에 등록되므로, 앱
              밖에서 띄운 Claude 세션의 슬래시 메뉴에도 나타납니다.
            </p>
          </div>
          <CommandTable />
        </div>
      ),
    },
    {
      id: "models",
      title: "7. 모델 — 무엇이 어떤 티켓을 맡을지",
      body: (
        <div className={`${P} space-y-2`}>
          <p>모델은 두 군데에서 정합니다(설정 › 모델).</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>오케스트레이터 하네스</strong> — 관제탑 자신이 어떤 CLI 로
              돌지. 바꾸면 새로 띄우는 오케스트레이터부터 적용됩니다.
            </li>
            <li>
              <strong>Agent Model Preset</strong> — 티켓을 맡을 에이전트의{" "}
              <strong>후보 집합</strong>. 고정 퍼센트가 아닙니다: 실제 선택은
              디스패치마다 태그 · 잔여 쿼터 · 주간 한도 · 관측된 사용량 · 라우팅
              그래프를 점수화해 결정합니다.
            </li>
          </ul>
          <p>
            기본값 <strong>Auto (Marblo Recommended)</strong> 는 Claude · Codex
            · Grok 을 경쟁시킵니다. <strong>Cost Saver</strong> 는 구독 잔여를
            아껴야 할 자원으로 보게 해 싼 칸(MiniMax · GLM · Kimi 등 env-swap)이
            이기게 하고, 어려운 티켓은 그대로 상위 칸을 지킵니다.{" "}
            <strong>Balanced</strong> 는 Antigravity 를 포함한 전 fleet 균등,
            그리고 단일 하네스 전용 프리셋과 직접 고르는 <strong>Custom</strong>{" "}
            이 있습니다.
          </p>
          <Note tone="warn">
            ⚠️ 프리셋은 즉시 저장되지만 라우팅은 메인 프로세스가 읽습니다 — 실제
            스폰 분포는 <strong>앱 재시작 후</strong>부터 바뀝니다.
          </Note>
        </div>
      ),
    },
    {
      id: "mcp",
      title: "8. Marblo MCP — 오케스트레이터 ↔ 보드 ↔ 에이전트",
      body: (
        <div className={`${P} space-y-2`}>
          <p>
            Marblo MCP 서버는 설치 시 사용자 Claude Code 의 글로벌 설정(
            <code>~/.claude.json</code>)에 자동 등록됩니다. 앱이 실행 중이면 앱
            밖의 Claude 세션에서도 다음 도구를 쓸 수 있습니다.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <code>create_task / get_all_tasks / update_task_status</code> —
              티켓 CRUD
            </li>
            <li>
              <code>
                spawn_agent / dispatch_task / reuse_agent / kill_agent
              </code>{" "}
              — 에이전트 라이프사이클
            </li>
            <li>
              <code>add_activity / ask_orchestrator</code> — 진행 기록 / 질의
            </li>
            <li>
              <code>search_tasks / get_agent_skill</code> — 검색 / 역할 스킬
              조회
            </li>
          </ul>
          <p className={MUTED}>
            ⓘ 동적 포트는 <code>~/.marblo/bridge-port</code> 디스커버리 파일로
            전달되므로 따로 설정할 것이 없습니다.
          </p>
        </div>
      ),
    },
    {
      id: "extend",
      title: "9. 확장 — 하네스 · 스토어 · 텔레그램",
      body: (
        <div className={`${P} space-y-3`}>
          <p>
            <strong>하네스</strong> 탭은 <em>반드시 필요한 연결</em>(CLI 설치 ·
            로그인, env-swap 벤더 키, 채널)이고, <strong>스토어</strong> 탭은{" "}
            <em>골라 담는 카탈로그</em>(스킬 · MCP · 에이전트 · 워크플로 ·
            지식팩 · 로컬 모델)입니다. 하네스는{" "}
            <kbd className="rounded bg-[#313244] px-1.5 py-0.5 text-xs">
              Cmd/Ctrl + Shift + H
            </kbd>{" "}
            로도 열립니다.
          </p>
          <div className="space-y-2">
            <p className="font-medium text-[#cdd6f4]">
              텔레그램으로 알림 받고 지시하기
            </p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                텔레그램에서 <code className="text-[#89b4fa]">@BotFather</code>{" "}
                에게 <code className="text-[#89b4fa]">/newbot</code> 으로 봇을
                만들고 <strong>봇 토큰</strong>을 복사합니다.
              </li>
              <li>
                알림 받을 채널 / 그룹에 그 봇을 추가한 뒤{" "}
                <strong>chatId</strong> 를 확인합니다(채널은 보통{" "}
                <code className="text-[#89b4fa]">-100…</code> 으로 시작).
              </li>
              <li>
                <strong>하네스</strong> 탭 채널 패널에 토큰과 chatId 를 넣고
                토글을 켭니다.
              </li>
            </ol>
            <Note tone="warn">
              ⚠️ 채널 설정은{" "}
              <strong>이후 새로 띄우는 오케스트레이터에만</strong> 적용됩니다.
              돌고 있는 오케스트레이터에 반영하려면 재시작하세요.
            </Note>
          </div>
        </div>
      ),
    },
    {
      id: "faq",
      title: "10. 자주 묻는 질문",
      body: <Faq items={KO_FAQ} />,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// English
// ─────────────────────────────────────────────────────────────────────────────

const EN_TAB_NOTES: TabNotes = {
  startHere:
    "A four-step checklist: install → sign in → connect a folder → first ticket. Progress is saved, so reopening resumes where you stopped, and a skipped step stays in the list instead of vanishing. The demo video and the interactive demo live here too.",
  guide: "This page.",
  board:
    "The kanban board. Tickets the orchestrator creates flow through TODO · CLAIMED · IN_PROGRESS · REVIEW · DONE, with BLOCKED / FAILED collected in a separate “stuck” lane above. Open a card for details, the activity timeline and the diff.",
  code: "The Monaco editor. Edit files opened from the sidebar tree and switch between the repo root and any worktree from the selector. Markdown, images and notebooks open in dedicated views.",
  lanes:
    "Quick Lanes. Run the improvement you just noticed in its own worktree, in parallel, without leaving your main work. Each lane gets a terminal, and missions are managed here too.",
  browser:
    "The app's own web browser. Type an address, or click a link from another screen (a code preview, say) and it opens here as a tab. Tabs stack and split side by side, so the local demo an agent just started can be checked without leaving the app. Sign-in and payment pages go to your system browser instead — they routinely refuse to load in an embedded browser — and you get a notification saying why.",
  agents:
    "Marblo Bots — bot gallery, bot run status and trigger settings. The run list only shows agents classified as bots.",
  fleet:
    "Fleet management — status, assigned ticket and cost for every spawned agent, plus stop / restart / delete. The terminals themselves live in the left column.",
  project:
    "The people side of the project — members, roles, invites and per-member workload. Invites and role assignment share the same screen as Settings → Team (team features are a paid plan).",
  worktrees:
    "Every ticket's isolated branch folder in one list: mergeable · behind · stale · conflicted at a glance, plus diff review, merge and cleanup.",
  history:
    "Completed tickets with the agents' completion reports and merge history. Filter by period and role, and export a share card of what shipped.",
  usage:
    "Token usage and cost estimates per model, per agent and per day — live totals (agent docs) merged with history (BigQuery).",
  store:
    "The public registry catalog — skills, MCP servers, agents, workflows, knowledge packs and local models. This is the optional, nice-to-have side.",
  harness:
    "The connections this app REQUIRES — CLI install and sign-in, env-swap vendor keys, channels. If the store is optional, this is the wiring.",
  missions: "Missions — multi-step execution units (dev flag only).",
  flows:
    "The flow editor — build pipelines out of nodes (beta · dev flag only).",
  deploy: "Deploy tab — GCP Cloud Run deploys (dev flag only).",
  settings:
    "Profile · models · billing · team · privacy · language · bug report. Also reachable from the gear in the header.",
};

const EN_FAQ: FaqItem[] = [
  {
    q: "Do I really have to install a CLI?",
    a: (
      <>
        Yes. The orchestrator and the agents run as real processes on top of an
        installed CLI. Claude Code is required; Codex, Grok and Antigravity are
        optional. Step ① of the <strong>Start here</strong> tab has an{" "}
        <strong>Install all</strong> button that picks only what is missing and
        installs it in order.
      </>
    ),
  },
  {
    q: "Automatic install failed (EACCES, npm permission errors…)",
    a: (
      <>
        The failed CLI's card keeps the manual command and a link to the
        official docs. Run that command in a terminal, then hit{" "}
        <strong>Re-check</strong> to refresh the state. The per-row [Install]
        button stays around precisely so you can retry the one row that failed.
      </>
    ),
  },
  {
    q: "How many accounts do I need to sign in to?",
    a: (
      <>
        <strong>One</strong> of Claude Code or Codex is enough to start. Step
        ②'s <strong>one-click sign-in</strong> opens a terminal tab and types
        the login command for you — approve it in the browser that pops up, and
        the app detects completion on its own.
      </>
    ),
  },
  {
    q: "I don't have a Claude / ChatGPT subscription.",
    a: (
      <>
        Two paths. (1) <strong>Subscribe</strong> — step ② links to the official
        plans; you then work inside a flat-rate limit. (2){" "}
        <strong>Vendor keys (BYOM)</strong> — register a key for GLM, MiniMax,
        Kimi and friends and they join as rungs on the Claude ladder without
        installing another harness. Register them at the bottom of Start here or
        on the <strong>Harness</strong> tab.
      </>
    ),
  },
  {
    q: "Is AI usage included in what I pay Marblo?",
    a: (
      <>
        No. Token usage is{" "}
        <strong>
          billed to the Claude Code / Codex account you already have
        </strong>
        . Marblo's plans cover app features and limits — Free is 1 project and 5
        concurrent agents; paid tiers are effectively unlimited (fair use). See
        what you've spent on the <strong>Usage</strong> tab.
      </>
    ),
  },
  {
    q: "Who picks the model? Where did the preset percentages go?",
    a: (
      <>
        A preset is now a <strong>candidate set, not a fixed split</strong>.
        Each dispatch scores tags, live quota headroom, weekly token limits,
        observed usage and the routing graph, then picks the harness and the
        rung. The default <strong>Auto (Marblo Recommended)</strong> makes
        Claude, Codex and Grok compete, with env-swap vendors (MiniMax, GLM,
        Kimi) riding the Claude ladder. <strong>Cost Saver</strong> makes the
        selector treat subscription quota as scarce so cheap rungs win;{" "}
        <strong>Balanced</strong> spreads across the whole fleet including
        Antigravity; and there are single-harness presets plus{" "}
        <strong>Custom</strong>.
      </>
    ),
  },
  {
    q: "I changed the model / preset and nothing happened.",
    a: (
      <>
        The choice saves immediately, but dispatch routing and the orchestrator
        harness are read by the Electron main process. The actual spawn
        distribution changes <strong>after you restart the app</strong>. The
        orchestrator model and Telegram channel settings likewise apply only to{" "}
        <strong>orchestrators launched afterwards</strong> — restart a running
        one to pick them up.
      </>
    ),
  },
  {
    q: "How do I connect a folder? Why is there a project I never created?",
    a: (
      <>
        So the product moves before you have picked anything, the first run
        seeds a dependency-free mini project at{" "}
        <code>&lt;Documents&gt;/Marblo Sample</code> and connects it
        automatically. Point it at your own repo with{" "}
        <strong>Open folder / Change folder</strong> up top. A folder that
        already has content is <strong>never touched</strong> — the sample is
        only seeded into an empty one.
      </>
    ),
  },
  {
    q: "This is too much screen. Can I get just the chat?",
    a: (
      <>
        Hit <strong>💬 Beginner mode</strong> in the header: tabs, board and
        worktrees fold away and one big orchestrator chat remains. Come back any
        time with <strong>Marblo mode</strong> in the beginner-mode top bar (the
        same toggle also lives in Settings → Profile).{" "}
        <strong>Running agents keep running</strong> across the switch.
      </>
    ),
  },
  {
    q: "The orchestrator won't start.",
    a: (
      <>
        In order: (1) is a folder connected? Without one it does not even try to
        launch. (2) On <strong>Start here</strong>, is the CLI marked ready?
        With no auth, spawns fail silently. (3) Hit <strong>Re-check</strong> to
        refresh the probe. (4) Still stuck — restart the app. A black terminal
        right after a cold restart is normal; click it or resize the window and
        it repaints.
      </>
    ),
  },
  {
    q: "The install / sign-in guidance keeps coming back.",
    a: (
      <>
        Onboarding is the <strong>Start here</strong> tab, not a modal, so it
        deliberately stays put instead of disappearing when dismissed. If you
        only want to stop landing on it, use{" "}
        <strong>“don't open this tab on start”</strong> at the bottom of the tab
        — the steps remain. If a step you already finished looks incomplete, hit
        Re-check to refresh the probe.
      </>
    ),
  },
  {
    q: "What is a worktree, and why do folders keep appearing?",
    a: (
      <>
        So agents never overwrite each other, each ticket is worked in an{" "}
        <strong>isolated git worktree</strong> (its own branch folder). The{" "}
        <strong>Worktrees</strong> tab shows their state, lets you review the
        diff, merge, and clean up the finished ones.
      </>
    ),
  },
  {
    q: "How do I run several projects at once?",
    a: (
      <>
        Open another window — one window, one project. Each window has its own
        PTY and Bridge routing, so they never interfere. Opening the same
        project twice intentionally shares the instance, to keep continuity.
      </>
    ),
  },
];

const EN: GuideContent = {
  sections: [
    {
      id: "what",
      title: "1. What Marblo is",
      body: (
        <div className={`${P} space-y-2`}>
          <p>
            Marblo is a <strong>control tower for a team of AI agents</strong>.
            Tell the orchestrator what you want → it breaks the work into
            tickets → spawns the right agent for each one as a real terminal
            process → each works in its own isolated worktree → results land on
            the board and in your work history.
          </p>
          <p>
            The agents run on CLIs you already use — Claude Code, Codex, Grok,
            Antigravity. Marblo is the layer above them that decides who gets
            what and tracks what actually finished.
          </p>
        </div>
      ),
    },
    {
      id: "first",
      title: "2. First launch — beginner mode vs Marblo mode",
      body: (
        <div className={`${P} space-y-2`}>
          <p>
            A fresh install opens in <strong>beginner mode</strong>: no tabs, no
            board, just one orchestrator chat. Type what you want and you reach
            a first result from there. Progress shows up under the chat as a
            live strip with a mini board and the agents at work.
          </p>
          <p>
            You don't need to have picked a folder yet — the first run connects
            a sample project automatically so the orchestrator opens right away
            (see the FAQ below).
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Beginner → Marblo: <strong>Marblo mode</strong> in the top bar.
              You also get a one-time invitation once your first work finishes.
            </li>
            <li>
              Marblo → beginner: <strong>💬 Beginner mode</strong> in the
              header. The same toggle is in Settings → Profile.
            </li>
          </ul>
          <Note>
            The mode changes <strong>only what is shown</strong>. Running agents
            and tickets are untouched, and coming back to Marblo mode restores
            the tabs you had open.
          </Note>
        </div>
      ),
    },
    {
      id: "setup",
      title: "3. Setup lives on the Start here tab — two one-click buttons",
      body: (
        <div className={`${P} space-y-2`}>
          <p>
            Installing and signing in is the <strong>Start here</strong> tab's
            job, not this page's — it probes the real state and only asks for
            what is missing.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <strong>Install all</strong> — picks only the CLIs you don't have
              and installs them in order, skipping the rest.
            </li>
            <li>
              <strong>One-click sign-in</strong> — opens a terminal tab and
              types the login command for you; approve in the browser and the
              app detects it. One of Claude Code / Codex is enough.
            </li>
            <li>
              <strong>Connect a folder</strong> — on a first run the sample
              project is already connected. Open your own repo to switch.
            </li>
            <li>
              <strong>First ticket</strong> — the step where you actually see
              what Marblo does for you.
            </li>
          </ol>
          <p className={MUTED}>
            The four steps persist, so reopening resumes where you left off, and
            a skipped step never disappears from the list. Each step also
            carries a “when you're stuck” fallback.
          </p>
        </div>
      ),
    },
    {
      id: "layout",
      title: "4. How the screen is laid out",
      body: (
        <div className={`${P} space-y-2`}>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Left terminal column</strong> — orchestrator on top, agent
              terminals below. Drag the dividers to resize; it auto-collapses on
              narrow windows.
            </li>
            <li>
              <strong>Right work pane</strong> — board, code, worktrees and the
              rest. Switching tabs never disturbs the terminals on the left.
            </li>
            <li>
              <strong>Sidebar</strong> — file tree and project switching.
            </li>
            <li>
              <strong>Activity panel</strong> —{" "}
              <kbd className="rounded bg-[#313244] px-1.5 py-0.5 text-xs">
                Cmd/Ctrl + Shift + A
              </kbd>{" "}
              opens the live activity stream; clicking an entry jumps to the tab
              it belongs to.
            </li>
          </ul>
          <p className={MUTED}>
            One window = one project by default. Open more windows to run other
            projects at the same time; each window has independent PTY / Bridge
            routing.
          </p>
        </div>
      ),
    },
    {
      id: "tabs",
      title: "5. The tabs",
      body: (
        <div className="space-y-3">
          <p className={P}>
            The list below is generated from this build's actual tab bar — same
            order, same membership as what you see.
          </p>
          <TabTable notes={EN_TAB_NOTES} />
        </div>
      ),
    },
    {
      id: "orchestrator",
      title: "6. Talking to the orchestrator",
      body: (
        <div className="space-y-3">
          <div className={`${P} space-y-2`}>
            <p>
              Plain language works — “dig through the payment failure logs and
              split the causes into tickets”. For routine work the{" "}
              <code>/tf-*</code> slash commands below are faster; typing{" "}
              <code>/</code> in the input brings up the same list as
              autocomplete.
            </p>
            <p className={MUTED}>
              These commands are registered into your Claude Code when Marblo is
              installed, so they also appear in the slash menu of Claude
              sessions you start outside the app.
            </p>
          </div>
          <CommandTable />
        </div>
      ),
    },
    {
      id: "models",
      title: "7. Models — who takes which ticket",
      body: (
        <div className={`${P} space-y-2`}>
          <p>Two settings decide this (Settings → Models).</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Orchestrator harness</strong> — which CLI the control
              tower itself runs on. Applies to orchestrators launched after the
              change.
            </li>
            <li>
              <strong>Agent model preset</strong> — the{" "}
              <strong>candidate set</strong> for the agents taking your tickets.
              Not a fixed split: each dispatch scores tags, live quota headroom,
              weekly limits, observed usage and the routing graph.
            </li>
          </ul>
          <p>
            The default <strong>Auto (Marblo Recommended)</strong> lets Claude,
            Codex and Grok compete. <strong>Cost Saver</strong> makes the rung
            selector treat subscription quota as scarce so the cheap env-swap
            rungs (MiniMax, GLM, Kimi) win, while hard tickets keep the frontier
            rung. <strong>Balanced</strong> spreads evenly across the whole
            fleet including Antigravity, and there are single-harness presets
            plus a <strong>Custom</strong> picker.
          </p>
          <Note tone="warn">
            ⚠️ The preset saves instantly, but routing is read by the main
            process — the real spawn distribution only changes{" "}
            <strong>after an app restart</strong>.
          </Note>
        </div>
      ),
    },
    {
      id: "mcp",
      title: "8. Marblo MCP — orchestrator ↔ board ↔ agents",
      body: (
        <div className={`${P} space-y-2`}>
          <p>
            The Marblo MCP server is registered into your Claude Code global
            config (<code>~/.claude.json</code>) at install time. While the app
            is running, even Claude sessions started outside it can call:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <code>create_task / get_all_tasks / update_task_status</code> —
              ticket CRUD
            </li>
            <li>
              <code>
                spawn_agent / dispatch_task / reuse_agent / kill_agent
              </code>{" "}
              — agent lifecycle
            </li>
            <li>
              <code>add_activity / ask_orchestrator</code> — progress logging /
              questions
            </li>
            <li>
              <code>search_tasks / get_agent_skill</code> — search / role-skill
              lookup
            </li>
          </ul>
          <p className={MUTED}>
            ⓘ The dynamic port is handed off via the{" "}
            <code>~/.marblo/bridge-port</code> discovery file, so there is
            nothing to configure manually.
          </p>
        </div>
      ),
    },
    {
      id: "extend",
      title: "9. Extending — harness · store · Telegram",
      body: (
        <div className={`${P} space-y-3`}>
          <p>
            The <strong>Harness</strong> tab is the <em>required</em> wiring
            (CLI install and sign-in, env-swap vendor keys, channels); the{" "}
            <strong>Store</strong> tab is the <em>optional</em> catalog (skills,
            MCP servers, agents, workflows, knowledge packs, local models).
            Harness also opens with{" "}
            <kbd className="rounded bg-[#313244] px-1.5 py-0.5 text-xs">
              Cmd/Ctrl + Shift + H
            </kbd>
            .
          </p>
          <div className="space-y-2">
            <p className="font-medium text-[#cdd6f4]">
              Notifications and control over Telegram
            </p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                In Telegram, create a bot with{" "}
                <code className="text-[#89b4fa]">/newbot</code> via{" "}
                <code className="text-[#89b4fa]">@BotFather</code> and copy the{" "}
                <strong>bot token</strong>.
              </li>
              <li>
                Add that bot to the channel / group that should receive
                notifications and find its <strong>chatId</strong> (channels
                usually start with <code className="text-[#89b4fa]">-100…</code>
                ).
              </li>
              <li>
                Enter the token and chatId in the channel panel of the{" "}
                <strong>Harness</strong> tab and flip the toggle.
              </li>
            </ol>
            <Note tone="warn">
              ⚠️ Channel settings apply{" "}
              <strong>only to orchestrators launched afterwards</strong>.
              Restart a running orchestrator to pick them up.
            </Note>
          </div>
        </div>
      ),
    },
    {
      id: "faq",
      title: "10. FAQ",
      body: <Faq items={EN_FAQ} />,
    },
  ],
};

export const GUIDE_CONTENT: Record<"ko" | "en", GuideContent> = { ko: KO, en: EN };
