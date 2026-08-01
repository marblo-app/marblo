/**
 * 1차 엔진 단위 동작 — 규칙표 §5.4 의 MASK/ANON/RELATIVIZE 계열과
 * 엔트로피(R8) 세부(§5.5)를 규칙 단위로 검증.
 */
import { describe, it, expect } from "vitest";
import { redact } from "../../../src/lib/redact/redact";
import {
  shannonEntropyBitsPerChar,
  judgeToken,
  containsHighEntropyToken,
  ENTROPY_THRESHOLD_BITS_PER_CHAR,
} from "../../../src/lib/redact/entropy";

function payloadOf(result: { payload: unknown }): string {
  return JSON.stringify(result.payload);
}

describe("R1/R1b — path masking", () => {
  it("masks home paths to <workspace>", () => {
    const out = payloadOf(
      redact(
        { title: "built /Users/realdev/projects/app fine", status: "ok" },
        { level: "L2" },
      ),
    );
    expect(out).not.toContain("realdev");
    expect(out).toContain("<workspace>");
  });

  it("masks windows home paths", () => {
    const out = payloadOf(
      redact(
        { title: "saved to C:\\Users\\realdev\\code\\app", status: "ok" },
        { level: "L2" },
      ),
    );
    expect(out).not.toContain("realdev");
  });

  it("masks marblo worktree paths to <worktree>", () => {
    const out = payloadOf(
      redact(
        {
          title: "wt at /Users/realdev/.marblo/worktrees/Proj1/Task2 ok",
          status: "ok",
        },
        { level: "L2" },
      ),
    );
    expect(out).not.toContain("realdev");
    expect(out).not.toContain("Proj1");
    expect(out).toContain("<worktree>");
  });

  it("R1c: unknown absolute path drops the item instead of guessing", () => {
    const out = payloadOf(
      redact(
        { title: "config at /etc/secret-app/conf.d/x.conf", status: "ok" },
        { level: "L2" },
      ),
    );
    expect(out).not.toContain("secret-app");
    expect(out).not.toContain("title");
  });
});

describe("R2/R2b/R2c — PII and identity anonymization", () => {
  it("masks emails and phones in kept strings", () => {
    const out = payloadOf(
      redact(
        { title: "contact real.name@corp.io or 010-1234-5678", status: "ok" },
        { level: "L2" },
      ),
    );
    expect(out).not.toContain("real.name");
    expect(out).not.toContain("1234");
    expect(out).toContain("<EMAIL>");
    expect(out).toContain("<PHONE>");
  });

  it("anonymizes person fields with stable per-run aliases", () => {
    const result = redact(
      {
        actorName: "김실명",
        tasks: [{ actorName: "김실명" }, { actorName: "박실명" }],
      },
      { level: "L1" },
    );
    const out = payloadOf(result);
    expect(out).not.toContain("실명");
    const parsed = result.payload as {
      actorName: string;
      tasks: Array<{ actorName: string }>;
    };
    expect(parsed.actorName).toBe("member-1");
    expect(parsed.tasks[0].actorName).toBe("member-1"); // 같은 사람 = 같은 별칭
    expect(parsed.tasks[1].actorName).toBe("member-2");
  });

  it("anonymizes agent ids", () => {
    const parsed = redact({ agentId: "b5a4eecf-uuid-here" }, { level: "L1" })
      .payload as {
      agentId: string;
    };
    expect(parsed.agentId).toBe("agent-1");
  });
});

describe("R7 — secret key names mask the value regardless of content", () => {
  it("masks classic env-style names and camelCase names", () => {
    const parsed = redact(
      {
        MARBLO_API_KEY: "totally-innocent-value",
        apiKey: "hello",
        accessToken: "world",
        status: "ok",
      },
      { level: "L3" },
    ).payload as Record<string, string>;
    expect(parsed.MARBLO_API_KEY).toBe("<REDACTED>");
    expect(parsed.apiKey).toBe("<REDACTED>");
    expect(parsed.accessToken).toBe("<REDACTED>");
    expect(parsed.status).toBe("ok");
  });
});

describe("R8 — entropy details (§5.5)", () => {
  it("threshold constant is exposed and set to 3.5", () => {
    expect(ENTROPY_THRESHOLD_BITS_PER_CHAR).toBe(3.5);
  });

  it("scores per token — dictionary dilution does not save a hot token", () => {
    const hot = "K9fQ2xR7mW4jL8nP3vT6yB1cD5gH0aZs";
    const diluted = `the quick brown fox ${hot} jumps over the lazy dog again and again and again`;
    expect(containsHighEntropyToken(diluted)).toBe(true);
  });

  it("git SHAs pass (labeled), sha256-labeled digests pass", () => {
    expect(judgeToken("3598efc7aa11bb22cc33dd44ee55ff6677889900")).toBe(
      "gitSha",
    );
    expect(
      judgeToken(
        "sha256:9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
      ),
    ).toBe("clean");
  });

  it("long all-letter identifiers are not flagged (no digit mix)", () => {
    expect(
      containsHighEntropyToken("shouldInjectOrchestratorNotification"),
    ).toBe(false);
  });

  it("entropy math sanity", () => {
    expect(shannonEntropyBitsPerChar("aaaa")).toBe(0);
    expect(shannonEntropyBitsPerChar("abcd")).toBe(2);
  });
});

describe("R14/R15/R16 — cost, timestamps, ticket ids", () => {
  const fixture = {
    status: "ok",
    costTotal: 12.34,
    startedAt: 1753924800000,
    endedAt: 1753933800000,
    taskId: "qEqSDXUsmTmQaDRBxlHU",
    title: "fix login #731",
  };

  it("drops cost unless opted in (R14)", () => {
    expect(payloadOf(redact(fixture, { level: "L3" }))).not.toContain("12.34");
    expect(
      payloadOf(redact(fixture, { level: "L3", includeCost: true })),
    ).toContain("12.34");
  });

  it("relativizes timestamps below L3, keeps absolute at L3 (R15)", () => {
    const l2 = redact(fixture, { level: "L2" }).payload as Record<
      string,
      unknown
    >;
    expect(l2.startedAt).toBe("+00:00");
    expect(l2.endedAt).toBe("+02:30");
    const l3 = redact(fixture, { level: "L3" }).payload as Record<
      string,
      unknown
    >;
    expect(l3.startedAt).toBe(1753924800000);
  });

  it("anonymizes ticket/doc ids (R16) at every level", () => {
    const out = payloadOf(redact(fixture, { level: "L3" }));
    expect(out).not.toContain("qEqSDXUsmTmQaDRBxlHU");
    const l1 = payloadOf(redact(fixture, { level: "L1" }));
    expect(l1).not.toContain("#731");
  });
});

describe("R11 — repository gate is fail-closed", () => {
  const fixture = {
    status: "ok",
    repoUrl: "https://github.com/acme/private-repo",
    branch: "feature/secret-initiative",
  };

  it("drops repo identifiers without an explicit public allowlist", () => {
    const out = payloadOf(redact(fixture, { level: "L3" }));
    expect(out).not.toContain("private-repo");
    expect(out).not.toContain("secret-initiative");
  });

  it("passes only exact allowlisted URLs", () => {
    const out = payloadOf(
      redact(fixture, {
        level: "L2",
        publicRepos: ["https://github.com/acme/private-repo"],
      }),
    );
    expect(out).toContain("acme/private-repo");
    expect(out).not.toContain("secret-initiative"); // 브랜치는 allowlist 밖 → drop
  });
});

describe("R9 — free text drops below L3, excerpt only if clean at L3", () => {
  it("drops prompts at L1/L2 entirely", () => {
    const out = payloadOf(
      redact({ prompt: "build me a rocket", status: "ok" }, { level: "L2" }),
    );
    expect(out).not.toContain("rocket");
  });

  it("keeps clean prose at L3 but drops dirty prose", () => {
    const clean = payloadOf(
      redact(
        { prompt: "please refactor the login flow", status: "ok" },
        { level: "L3" },
      ),
    );
    expect(clean).toContain("refactor");
    const dirty = payloadOf(
      redact(
        {
          prompt: "use key sk-ant-api03-Xk7Qw9Zr2Lm8Pv3Ty6Ub1Nc4Rf5V ok",
          status: "ok",
        },
        { level: "L3" },
      ),
    );
    expect(dirty).not.toContain("sk-ant");
    expect(dirty).not.toContain("prompt");
  });
});

describe("R12 — infra identifiers drop the item", () => {
  it("drops private IPs, buckets, service accounts, internal hosts", () => {
    for (const bad of [
      "db at 10.0.12.34 unreachable",
      "bucket gs://acme-prod-backups full",
      "svc runner@acme-prod.iam.gserviceaccount.com denied",
      "host api.acme.internal timeout",
      "192.168.0.11 responded",
      "172.31.4.2 gateway",
    ]) {
      const out = payloadOf(
        redact({ title: bad, status: "ok" }, { level: "L3" }),
      );
      expect(out, bad).not.toContain("acme");
      expect(out, bad).not.toContain("10.0.12.34");
      expect(out, bad).not.toContain("192.168.0.11");
      expect(out, bad).not.toContain("172.31.4.2");
    }
  });
});
