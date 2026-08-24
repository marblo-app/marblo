/**
 * 사장님 인바운드 저널 — 오케가 **받은** 메시지를 MCP 서버가 볼 수 있게 하는 통로
 * (티켓 wx9c4NeVtZ1SGcbEISpg).
 *
 * ## 왜 이 파일이 존재하는가 — 표면 4개가 전부 오케가 쓴 글인 이유
 * `work-chain-capture.ts` 의 `CaptureSurface` 는 넷인데 넷 다 **오케가 쓴 글**이다
 * (owner_report · answer · activity · dispatch_instruction). 사장님 인바운드가
 * 표면에 없는 건 게으름이 아니라 **구조**였다:
 *
 *   · 인바운드는 electron **메인 프로세스**가 받는다
 *     (`telegram-poller.ts` `handleUpdate()` → `orch.injectMessage()`,
 *      `slack-poller.ts` 동형). 거기서 텍스트는 오케 **PTY 로만** 들어간다.
 *   · 포착 로직은 **MCP 서버 프로세스**(이 디렉터리)에 있고, MCP 서버는 오케가
 *     도구 인자로 넘긴 것만 본다. 브리지는 MCP→메인 단방향이라 역방향 통지가 없다.
 *   → 그래서 MCP 서버에는 사장님 문장이 **도달할 경로 자체가 없었다.**
 *
 * 이 파일이 그 한 칸을 메운다. 메인이 인바운드를 **오케 PTY 로 실제 전달한 뒤**
 * 여기에 한 줄 적고, MCP 서버가 티켓 생성 시점에 그 줄을 읽는다.
 *
 * ## ★injectMessage 경로는 건드리지 않는다
 * 그 경로엔 과거 메시지 유실 사고 이력이 있다(재전달·offset 보류 규율이 거기 있다).
 * 그래서 이 저널은 **전달 성공(`wrote === true`) 이후에만** 적힌다. 저널 쓰기가
 * 실패해도 전달은 이미 끝났고, 실패는 삼키고 로그만 남긴다 — 부기가 배달을
 * 막는 경로는 존재하지 않아야 한다.
 *
 * ## 왜 Firestore 가 아니라 로컬 파일인가
 * ①메인과 MCP 서버는 **같은 기기·같은 사용자**다(MCP 서버는 이 앱이 띄운다).
 * ②사장님 메시지 원문을 클라우드 컬렉션 하나 더 만들어 쌓을 이유가 없다 —
 *   이 데이터의 수명은 "티켓이 생길 때까지 몇 분" 이다.
 * ③같은 이유로 `work-chain-spool.ts` 가 이미 쓰는 패턴이다(원자적 rename 쓰기).
 *
 * ## 경쟁 쓰기
 * 메인은 append 하고 MCP 서버는 consumed 표시를 한다 — 마지막 쓰기가 이긴다.
 * 잃을 수 있는 건 consumed 표시 한 칸이고, 그 대가는 같은 미션 항목이 두 번
 * 적히는 것인데 그건 `dedupeAgainstChain` 이 다시 잡는다. 반대로 잠금을 걸면
 * 배달 경로가 부기 때문에 늦어진다 — 그쪽이 훨씬 비싸다.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type OwnerInboundChannel = "telegram" | "slack";

export interface OwnerInboundEntry {
  /**
   * 안정 키 — 같은 메시지를 두 번 적지 않는다. 텔레그램은 update_id,
   * Slack 은 `channel:ts` 라 재전달(at-least-once)이 일어나도 한 줄이다.
   */
  key: string;
  projectId: string;
  channel: OwnerInboundChannel;
  /** 보낸 사람 표시명. 토큰·비밀값은 절대 담지 않는다(폴러가 이미 스크럽한 값). */
  from: string;
  /** 인바운드 본문 원문. 가공하지 않는다 — 판정은 읽는 쪽이 한다. */
  text: string;
  /** 오케 PTY 로 **실제 전달된** 시각(epoch ms). */
  at: number;
  /**
   * 이 메시지로 이미 만들어진 체인 항목 — `그룹키 → 체인 항목 id`.
   * 그룹키는 미션 라벨 키(라벨 없으면 ""). 같은 미션의 두 번째 티켓은 새 항목을
   * 만들지 않고 이 id 에 근거 티켓으로 **붙는다**.
   */
  consumed?: Record<string, string>;
}

interface OwnerInboundFile {
  version: 1;
  entries: OwnerInboundEntry[];
}

/**
 * 보관 상한. 이 저널의 수명은 "티켓이 생길 때까지 몇 분" 이라 길게 들고 있을
 * 이유가 없다 — 오래된 줄은 잘못 붙을 위험만 늘린다.
 */
export const OWNER_INBOUND_MAX_ENTRIES = 60;

/** 프로젝트당 보관 상한. 한 프로젝트가 저널 전체를 밀어내지 못하게. */
export const OWNER_INBOUND_MAX_PER_PROJECT = 12;

function journalPath(): string {
  return (
    process.env.MARBLO_OWNER_INBOUND_PATH ||
    path.join(os.homedir(), ".marblo", "owner-inbound.json")
  );
}

async function read(): Promise<OwnerInboundFile> {
  try {
    const raw = await fs.readFile(journalPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<OwnerInboundFile>;
    return parsed.version === 1 && Array.isArray(parsed.entries)
      ? { version: 1, entries: parsed.entries }
      : { version: 1, entries: [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, entries: [] };
    throw error;
  }
}

async function write(file: OwnerInboundFile): Promise<void> {
  const target = journalPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(file), { mode: 0o600 });
  await fs.rename(temporary, target);
}

/**
 * 상한을 적용한다 — 프로젝트별로 최신 N개만 남기고, 전체도 N개로 자른다.
 * 순수(테스트에서 직접 부른다).
 */
export function pruneOwnerInbound(
  entries: readonly OwnerInboundEntry[],
): OwnerInboundEntry[] {
  const byProject = new Map<string, number>();
  const kept: OwnerInboundEntry[] = [];
  // 최신부터 훑으며 프로젝트별 상한을 적용한다.
  for (const entry of [...entries].sort((a, b) => b.at - a.at)) {
    const count = byProject.get(entry.projectId) ?? 0;
    if (count >= OWNER_INBOUND_MAX_PER_PROJECT) continue;
    byProject.set(entry.projectId, count + 1);
    kept.push(entry);
    if (kept.length >= OWNER_INBOUND_MAX_ENTRIES) break;
  }
  // 저장은 오래된 것부터(사람이 열어봤을 때 읽는 순서).
  return kept.reverse();
}

/**
 * 인바운드 한 줄을 적는다. ★같은 key 가 이미 있으면 **덮어쓰지 않는다** —
 * 재전달로 같은 메시지가 다시 와도 consumed 표시가 지워지면 안 되기 때문이다.
 */
export async function recordOwnerInbound(
  entry: OwnerInboundEntry,
): Promise<void> {
  const file = await read();
  if (file.entries.some((e) => e.key === entry.key)) return;
  file.entries.push(entry);
  await write({ version: 1, entries: pruneOwnerInbound(file.entries) });
}

/** 프로젝트의 인바운드를 **최신순**으로. 실패하면 빈 배열(읽기는 절대 안 죽는다). */
export async function readOwnerInbound(
  projectId: string,
): Promise<OwnerInboundEntry[]> {
  try {
    const file = await read();
    return file.entries
      .filter((e) => e.projectId === projectId)
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/**
 * 그룹키를 이 체인 항목 id 로 소비했다고 표시한다. 표시가 유실되면 같은 미션이
 * 두 번 적힐 수 있지만 그건 `dedupeAgainstChain` 이 받는다(머리말 참조).
 */
export async function markOwnerInboundConsumed(
  key: string,
  groupKey: string,
  itemId: string,
): Promise<void> {
  try {
    const file = await read();
    const entry = file.entries.find((e) => e.key === key);
    if (!entry) return;
    entry.consumed = { ...(entry.consumed ?? {}), [groupKey]: itemId };
    await write(file);
  } catch {
    // 표시 실패는 배달도 포착도 막지 않는다.
  }
}
