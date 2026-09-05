/**
 * ★자기교착 — **우리가 남긴 글이 컴포저를 영구 점유하는 길** (티켓
 * nMpBzIMJmkSFqrrZfSKz, 축은 s7NGFa8Ln82adxEggWBj 와 같다).
 *
 * 경로는 이렇다:
 *   1. `writeAndSubmit` 이 본문을 쓰고 CR 을 예산(3회)껏 보낸다.
 *   2. 제출 신호가 끝내 안 오면 결말은 `unconfirmed` 인데, 반환값은 `true` 다 —
 *      중복 주입을 막기 위한 의도된 트레이드오프(pty-manager.ts 의
 *      "Enter still not registered … may be sitting unsubmitted in the composer").
 *   3. 그래서 **우리 본문이 컴포저에 그대로 남는다.** TUI 는 그 줄을 매 프레임
 *      다시 그리므로 화면측 증거가 계속 갱신되고, 이후 모든 주입이 영구히
 *      `composer-occupied` 로 거절된다. 아무도 치우지 않으면 안 풀린다.
 *
 * 첫 테스트가 그 길이 **실재함**을 재현하고, 나머지가 우리가 그 길을 막되
 * **남의 초안에는 손대지 않음**을 잠근다.
 *
 * ★GUI 를 띄우지 않는다 — node-pty 를 가짜로 갈아끼운다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { FakePty, spawned } = vi.hoisted(() => {
  class FakePty {
    written: string[] = [];
    dataCbs: Array<(data: string) => void> = [];
    exitCbs: Array<(e: { exitCode: number; signal?: number }) => void> = [];
    pid = 4242;
    destroyed = 0;

    write(data: string): void {
      this.written.push(data);
    }
    resize(): void {}
    kill(): void {}
    destroy(): void {
      this.destroyed++;
    }
    onData(cb: (data: string) => void): { dispose: () => void } {
      this.dataCbs.push(cb);
      return {
        dispose: () => {
          this.dataCbs = this.dataCbs.filter((r) => r !== cb);
        },
      };
    }
    onExit(cb: (e: { exitCode: number; signal?: number }) => void): {
      dispose: () => void;
    } {
      this.exitCbs.push(cb);
      return {
        dispose: () => {
          this.exitCbs = this.exitCbs.filter((r) => r !== cb);
        },
      };
    }
    emitData(data: string): void {
      for (const cb of [...this.dataCbs]) cb(data);
    }
  }
  return { FakePty, spawned: [] as FakePty[] };
});

vi.mock("node-pty", () => ({
  spawn: () => {
    const proc = new FakePty();
    spawned.push(proc);
    return proc;
  },
}));

import { PtyManager } from "../../electron/pty-manager";

type FakePtyInst = InstanceType<typeof FakePty>;

const ID = "pty-1";
const DELAY_MS = 10;
const VERIFY_MS = 600;
/** 우리 본문이 미제출로 컴포저에 남아 있는 화면 한 프레임. */
const OUR_TEXT_ON_SCREEN = "\r\x1b[2K❯ 우리가 넣은 본문";
/** 제출된 뒤의 빈 컴포저 프레임. */
const EMPTY_COMPOSER = "\r\x1b[2K❯ ";

let pm: PtyManager;
let proc: FakePtyInst;

/** 제출 신호를 한 번도 안 주고 CR 예산을 다 태운다 → `unconfirmed`. */
async function writeThatNeverSubmits(text: string): Promise<boolean> {
  const p = pm.writeAndSubmit(ID, text, DELAY_MS);
  await vi.advanceTimersByTimeAsync(DELAY_MS + VERIFY_MS * 3 + 50);
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  spawned.length = 0;
  pm = new PtyManager();
  pm.create(ID, "orchestrator");
  proc = spawned[0] as FakePtyInst;
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("자기교착 경로가 실재한다", () => {
  it("★CR 이 끝내 안 먹힌 우리 글이 컴포저를 점유하고, 사유는 우리 자신이다", async () => {
    const delivered = await writeThatNeverSubmits("우리가 넣은 본문");
    // 호출부 장부에는 '전달됨' 으로 남는다(의도된 anti-dup 트레이드오프).
    expect(delivered).toBe(true);

    // 그런데 화면엔 우리 본문이 그대로 있다.
    proc.emitData(OUR_TEXT_ON_SCREEN);

    expect(pm.composerVerdict(ID).writable).toBe(false);
    expect(pm.composerVerdict(ID).state).toBe("occupied");
    // ★그리고 그 점유자는 사장님이 아니라 우리다.
    expect(pm.composerOccupancy(ID)).toBe("self-injected");
  });
});

describe("우리가 남긴 글은 우리가 치운다", () => {
  it("★막힌 게 우리 글이면 CR 한 번으로 마저 제출하고 다음 주입이 통과한다", async () => {
    await writeThatNeverSubmits("우리가 넣은 본문");
    proc.emitData(OUR_TEXT_ON_SCREEN);
    const before = proc.written.length;

    const next = pm.writeAndSubmit(ID, "다음 메시지", DELAY_MS);
    // 해제 CR 이 나가고, 그 CR 로 제출된 화면(빈 컴포저)이 그려진다.
    await vi.advanceTimersByTimeAsync(1);
    expect(proc.written.slice(before)).toEqual(["\r"]);
    proc.emitData(EMPTY_COMPOSER);

    await vi.advanceTimersByTimeAsync(VERIFY_MS + DELAY_MS + 50);
    proc.emitData("esc to interrupt");
    await vi.advanceTimersByTimeAsync(VERIFY_MS + 50);

    await expect(next).resolves.toBe(true);
    expect(proc.written).toContain("\x1b[200~다음 메시지\x1b[201~");
  });

  it("해제 CR 은 막힌 글 1건당 한 번뿐이다 — CR 을 난사하지 않는다", async () => {
    await writeThatNeverSubmits("우리가 넣은 본문");
    proc.emitData(OUR_TEXT_ON_SCREEN);

    // 화면이 끝내 안 풀리는 경우: 첫 시도에서 해제 CR 1회, 그 뒤로는 0회.
    const first = pm.writeAndSubmit(ID, "A", DELAY_MS);
    await vi.advanceTimersByTimeAsync(VERIFY_MS + 50);
    proc.emitData(OUR_TEXT_ON_SCREEN);
    await expect(first).resolves.toBe(false);
    const afterFirst = proc.written.filter((w) => w === "\r").length;

    const second = pm.writeAndSubmit(ID, "B", DELAY_MS);
    await vi.advanceTimersByTimeAsync(VERIFY_MS + 50);
    await expect(second).resolves.toBe(false);
    expect(proc.written.filter((w) => w === "\r").length).toBe(afterFirst);
  });
});

describe("남의 초안에는 손대지 않는다", () => {
  it("★사람이 친 초안이면 해제 CR 을 보내지 않고 그대로 거절한다", async () => {
    // 사람이 터미널 탭에 친 키는 PtyManager.write 로 지나간다.
    pm.write(ID, "사장님이 쓰다 만 초안");
    proc.emitData("\r\x1b[2K❯ 사장님이 쓰다 만 초안");
    expect(pm.composerOccupancy(ID)).toBe("human-draft");

    const crBefore = proc.written.filter((w) => w === "\r").length;
    const refused = pm.writeAndSubmit(ID, "우리 메시지", DELAY_MS);
    await vi.advanceTimersByTimeAsync(VERIFY_MS + 50);

    await expect(refused).resolves.toBe(false);
    // CR 도, 본문도 나가지 않았다.
    expect(proc.written.filter((w) => w === "\r").length).toBe(crBefore);
    expect(proc.written.some((w) => w.includes("우리 메시지"))).toBe(false);
  });

  it("우리 글이 막고 있어도 그 뒤 사람이 손을 댔으면 건드리지 않는다", async () => {
    await writeThatNeverSubmits("우리가 넣은 본문");
    proc.emitData(OUR_TEXT_ON_SCREEN);
    expect(pm.composerOccupancy(ID)).toBe("self-injected");

    // 사장님이 그 줄에 이어서 무언가 치기 시작하셨다.
    pm.write(ID, "그런데 말이죠");
    expect(pm.composerOccupancy(ID)).toBe("human-draft");

    const crBefore = proc.written.filter((w) => w === "\r").length;
    const refused = pm.writeAndSubmit(ID, "우리 메시지", DELAY_MS);
    await vi.advanceTimersByTimeAsync(VERIFY_MS + 50);

    await expect(refused).resolves.toBe(false);
    expect(proc.written.filter((w) => w === "\r").length).toBe(crBefore);
  });

  it("오케가 도는 중이면 자기교착이 아니다 — 큐에 든 글을 치우지 않는다", async () => {
    await writeThatNeverSubmits("우리가 넣은 본문");
    proc.emitData(OUR_TEXT_ON_SCREEN);
    // 오케가 턴을 시작했다(스피너).
    proc.emitData("esc to interrupt");

    expect(pm.composerOccupancy(ID)).toBe("orchestrator-busy");

    const crBefore = proc.written.filter((w) => w === "\r").length;
    const refused = pm.writeAndSubmit(ID, "우리 메시지", DELAY_MS);
    await vi.advanceTimersByTimeAsync(VERIFY_MS + 50);

    await expect(refused).resolves.toBe(false);
    expect(proc.written.filter((w) => w === "\r").length).toBe(crBefore);
  });
});
