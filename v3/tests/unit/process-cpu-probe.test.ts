/**
 * 능동 프로브 (a) — OS 관측(티켓 DQYoyas3ESx33zXJOCOa).
 *
 * 고정하는 것:
 *   · `ps -o time=` 의 세 가지 포맷(MM:SS.ss / HH:MM:SS / DD-HH:MM:SS) 파싱
 *   · ★파싱 실패는 조용한 null 이지 NaN 이 아니다 — NaN 이 새면 CPU 축이
 *     "있는 척하면서 아무 일도 안 하는" 상태가 되고, 그건 관측 불가보다 나쁘다
 *   · probePidAlive 는 **ESRCH 일 때만** false. 그 외 모르는 건 전부 null
 *     ("모른다" 를 "죽었다" 로 기울이지 않는다)
 *   · sampleProcessProbe 는 어떤 경로로도 대상 프로세스를 건드리지 않는다
 */
import { describe, expect, it } from "vitest";
import {
  parsePsCpuTime,
  probePidAlive,
  sampleProcessCpuMs,
  sampleProcessProbe,
} from "../../electron/process-cpu-probe";

describe("parsePsCpuTime — ps 누적 CPU 시간 포맷", () => {
  it("MM:SS.ss (macOS 기본)", () => {
    expect(parsePsCpuTime("0:00.00")).toBe(0);
    expect(parsePsCpuTime("0:12.34")).toBe(12_340);
    expect(parsePsCpuTime("15:02.50")).toBe(15 * 60_000 + 2_500);
  });

  it("HH:MM:SS", () => {
    expect(parsePsCpuTime("1:02:03")).toBe((3600 + 123) * 1000);
  });

  it("DD-HH:MM:SS", () => {
    expect(parsePsCpuTime("2-03:04:05")).toBe(
      ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000,
    );
  });

  it("앞뒤 공백/개행을 허용한다(ps 는 열 정렬로 공백을 붙여 낸다)", () => {
    expect(parsePsCpuTime("   3:20.00\n")).toBe(200_000);
  });

  it("★파싱 실패는 전부 null — NaN 이 새면 안 된다", () => {
    for (const bad of ["", "   ", "abc", "1:2:3:4", "x:yy.zz", "-", "12"]) {
      const got = parsePsCpuTime(bad);
      expect(got).toBeNull();
      expect(Number.isNaN(got as unknown as number)).toBe(false);
    }
  });
});

describe("probePidAlive — ESRCH 만 죽음, 나머지는 모름", () => {
  it("자기 자신의 pid 는 살아 있다", () => {
    expect(probePidAlive(process.pid)).toBe(true);
  });

  it("존재하지 않는 pid 는 false", () => {
    // 2^22 근처의 사용 중이 아닐 매우 큰 pid. ESRCH 를 유도한다.
    expect(probePidAlive(4_194_303)).toBe(false);
  });

  it("★비정상 입력(null/0/1/음수/소수)은 죽음이 아니라 '모름'(null)", () => {
    for (const bad of [null, undefined, 0, 1, -5, 1.5, NaN]) {
      expect(probePidAlive(bad as number)).toBeNull();
    }
  });

  it("pid=1(init/launchd)은 판정하지 않는다 — 우리 자식일 리 없다", () => {
    expect(probePidAlive(1)).toBeNull();
  });
});

describe("sampleProcessCpuMs / sampleProcessProbe", () => {
  it("자기 자신을 관측하면 macOS 에서 숫자, 다른 플랫폼에서 null", async () => {
    const cpu = await sampleProcessCpuMs(process.pid);
    if (process.platform === "darwin") {
      expect(typeof cpu).toBe("number");
      expect(cpu as number).toBeGreaterThanOrEqual(0);
    } else {
      // ★플랫폼 미지원은 '관측 불가' 로만 떨어진다 — 여기서 죽음을 만들지 않는다.
      expect(cpu).toBeNull();
    }
  });

  it("비정상 pid 는 관측 불가(null)", async () => {
    expect(await sampleProcessCpuMs(null)).toBeNull();
    expect(await sampleProcessCpuMs(0)).toBeNull();
  });

  it("표본은 alive/cpuMs/prevCpuMs 세 칸을 모두 채워 돌려준다", async () => {
    const s = await sampleProcessProbe(process.pid, 1_234);
    expect(s.alive).toBe(true);
    expect(s.prevCpuMs).toBe(1_234);
    if (process.platform !== "darwin") expect(s.cpuMs).toBeNull();
  });

  it("★pid 가 확정적으로 없으면 ps 를 부르지 않고 곧장 alive=false", async () => {
    const s = await sampleProcessProbe(4_194_303, null);
    expect(s.alive).toBe(false);
    expect(s.cpuMs).toBeNull();
  });
});
