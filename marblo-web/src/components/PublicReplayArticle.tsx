/**
 * 공개 Replay 본문 렌더러 (Phase 4-2). 설계 §4 Phase 4 · §7.2 · §5.7 F5.
 *
 * ★이 컴포넌트는 **순수**하다 — 데이터 페치도, next-intl 도, 라우터 컨텍스트도
 * 없다. 이유는 F5 때문이다: "이스케이프된다"를 주장이 아니라 **테스트**로
 * 증명하려면 실제 렌더 경로를 `renderToStaticMarkup` 으로 돌릴 수 있어야 한다.
 * 페치·번역이 안에 박혀 있으면 그 증명이 불가능해지고, 대신 흉내낸 컴포넌트를
 * 테스트하게 된다 — 그건 아무것도 지켜주지 않는다.
 *
 * ★`dangerouslySetInnerHTML` 금지. 렌더되는 문자열은 전부 `lib/publicReplay.ts`
 * 를 통과한 값이고, 여기서는 React 텍스트 노드로만 나간다.
 */
import type { PublicReplayBeat, PublicReplayView } from "@/lib/publicReplay";

/**
 * 이 컴포넌트가 쓰는 문구 전부. 번역은 호출부(서버 페이지)가 미리 해결해서
 * 넘긴다 — 그래야 테스트가 next-intl 없이 실제 컴포넌트를 렌더할 수 있다.
 */
export interface ReplayLabels {
  /** 이 Replay 의 공개 등급 문구(이미 L1/L2/L3 중 하나로 해결됨). */
  level: string;
  redactedBadge: string;
  untitled: string;
  duration: (duration: string) => string;
  completedAt: (at: string) => string;
  castTitle: string;
  unknownAgent: string;
  tasksCompleted: (count: number) => string;
  timelineTitle: string;
  beatsOmitted: (count: number) => string;
  prTitle: string;
  creditedTo: string;
  privacyNote: string;
  cta: string;
  stats: {
    tasksDone: string;
    agents: string;
    prs: string;
    filesChanged: string;
    lines: string;
    testsPassed: string;
    riskFlags: string;
    retries: string;
    costTotal: string;
  };
}

export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

export default function PublicReplayArticle({
  replay,
  labels,
  homeHref,
}: {
  replay: PublicReplayView;
  labels: ReplayLabels;
  homeHref: string;
}) {
  const duration = formatDuration(replay.durationMs);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:py-16">
      <header className="mb-10">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 font-medium text-zinc-300">
            {labels.level}
          </span>
          <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-zinc-500">
            {labels.redactedBadge}
          </span>
          {replay.templateId && (
            <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-zinc-500">
              {replay.templateId}
            </span>
          )}
        </div>

        <h1 className="font-display text-2xl leading-snug font-bold text-white sm:text-3xl">
          {replay.goal || labels.untitled}
        </h1>

        {(duration || replay.completedAt) && (
          <p className="mt-3 text-sm text-zinc-500">
            {duration && <span>{labels.duration(duration)}</span>}
            {duration && replay.completedAt && <span className="mx-2">·</span>}
            {replay.completedAt && (
              <span>{labels.completedAt(replay.completedAt)}</span>
            )}
          </p>
        )}
      </header>

      <StatsGrid replay={replay} labels={labels} />

      {replay.cast.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-sm font-semibold tracking-wide text-zinc-400 uppercase">
            {labels.castTitle}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {replay.cast.map((member, index) => (
              <li
                key={`${member.agentRef}-${index}`}
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
              >
                <p className="font-medium text-zinc-200">
                  {member.agentRef || labels.unknownAgent}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {[
                    member.vendor,
                    member.spawnedModel || member.detectedModelId,
                    member.role,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {member.tasksCompleted !== null && (
                  <p className="mt-2 text-xs text-zinc-400">
                    {labels.tasksCompleted(member.tasksCompleted)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {replay.beats.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-sm font-semibold tracking-wide text-zinc-400 uppercase">
            {labels.timelineTitle}
          </h2>
          <ol className="space-y-2">
            {replay.beats.map((beat, index) => (
              <BeatRow key={beat.id || index} beat={beat} />
            ))}
          </ol>
          {replay.beatsOmitted > 0 && (
            <p className="mt-3 text-xs text-zinc-600">
              {labels.beatsOmitted(replay.beatsOmitted)}
            </p>
          )}
        </section>
      )}

      {replay.prUrls.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-sm font-semibold tracking-wide text-zinc-400 uppercase">
            {labels.prTitle}
          </h2>
          <ul className="space-y-2">
            {replay.prUrls.map((url) => (
              <li key={url}>
                {/* href 로 들어오는 값은 `safePrUrl` 이 https + 호스트
                    화이트리스트로 걸러낸 것뿐이다. React 는 href 스킴을 검사하지
                    않으므로(=`javascript:` 를 그대로 렌더한다) 그 게이트가
                    유일한 방어다. rel 은 외부 사용자 콘텐츠 링크 위생. */}
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  className="text-sm break-all text-indigo-400 hover:text-indigo-300"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-16 border-t border-zinc-800 pt-6">
        {/* Q5: opt-in 크레딧. 기본은 익명이고, 익명이면 이 블록 자체가 없다.
            핸들은 링크로 만들지 않는다 — 사용자 문자열로 URL 을 조립하는 순간
            오픈 리다이렉트가 된다. */}
        {replay.creditHandle && (
          <p className="text-sm text-zinc-400">
            {labels.creditedTo}{" "}
            <span className="font-medium text-zinc-200">
              {replay.creditHandle}
            </span>
          </p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-zinc-600">
          {labels.privacyNote}
        </p>
        {/* next/link 가 아니라 평범한 앵커다: 이 컴포넌트는 라우터 컨텍스트 없이
            렌더돼야 한다(위 파일 주석). 내부 정적 경로라 잃는 건 프리페치뿐이다. */}
        <a
          href={homeHref}
          className="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          {labels.cta}
        </a>
      </footer>
    </div>
  );
}

function StatsGrid({
  replay,
  labels,
}: {
  replay: PublicReplayView;
  labels: ReplayLabels;
}) {
  const { stats } = replay;
  // 비식별화가 통째로 드롭한 수치는 **그리지 않는다**. 0 으로 채우면 "0건 했다"는
  // 거짓말이 된다 — 설계가 denied 와 empty 를 절대 같은 값으로 접지 않는 것과
  // 같은 이유다.
  const tiles: { label: string; value: string }[] = [];
  const push = (label: string, value: number | null) => {
    if (value === null) return;
    tiles.push({ label, value: `${value}` });
  };

  push(labels.stats.tasksDone, stats.tasksDone);
  push(labels.stats.agents, stats.agents);
  push(labels.stats.prs, stats.prs);
  push(labels.stats.filesChanged, stats.filesChanged);
  if (stats.linesAdded !== null || stats.linesDeleted !== null) {
    tiles.push({
      label: labels.stats.lines,
      value: `+${stats.linesAdded ?? 0} / -${stats.linesDeleted ?? 0}`,
    });
  }
  if (stats.testsPassed !== null) {
    tiles.push({
      label: labels.stats.testsPassed,
      // 분모를 아는 경우에만 비율로 쓴다. 분모 없이 "12" 만 보이면 사용자는
      // 그걸 12/12 로 읽는다(ReplayStats.reportsScanned 주석과 같은 이유).
      value:
        stats.reportsScanned !== null
          ? `${stats.testsPassed}/${stats.reportsScanned}`
          : `${stats.testsPassed}`,
    });
  }
  push(labels.stats.riskFlags, stats.riskFlags);
  push(labels.stats.retries, stats.retries);
  // R14 — 비용은 등급과 무관한 독립 opt-in 이라 대개 없다.
  if (stats.costTotal !== null) {
    tiles.push({
      label: labels.stats.costTotal,
      value: `$${stats.costTotal.toFixed(2)}`,
    });
  }

  if (tiles.length === 0) return null;

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
        >
          <p className="font-display text-xl font-bold text-white">
            {tile.value}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{tile.label}</p>
        </div>
      ))}
    </section>
  );
}

function BeatRow({ beat }: { beat: PublicReplayBeat }) {
  const meta = [beat.agentRef, beat.actorRef, beat.taskId]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex gap-3 rounded-lg border border-zinc-900 bg-zinc-900/20 px-3 py-2">
      <span className="shrink-0 pt-0.5 font-mono text-xs text-zinc-600">
        {beat.ts}
      </span>
      <div className="min-w-0">
        <p className="text-sm break-words text-zinc-200">{beat.title}</p>
        <p className="mt-0.5 text-xs text-zinc-600">
          {[beat.kind, meta].filter(Boolean).join(" — ")}
        </p>
        {beat.detail && (
          <p className="mt-2 text-xs break-words whitespace-pre-wrap text-zinc-500">
            {beat.detail}
          </p>
        )}
      </div>
    </li>
  );
}
