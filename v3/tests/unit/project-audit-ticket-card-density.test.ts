/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { ProjectAuditTicketCard } from "../../src/components/project/ProjectAuditTicketCard";
import type {
  AuditTicketGroup,
  UnifiedAuditRow,
} from "../../src/lib/projectAuditView";

vi.mock("../../src/components/project/ProjectAuditLinks", () => ({
  ProjectAuditLinks: ({ taskId }: { taskId: string }) =>
    createElement(
      "button",
      { type: "button", title: `#${taskId}` },
      "ticket link",
    ),
}));

afterEach(() => {
  cleanup();
});

function row(overrides: Partial<UnifiedAuditRow> = {}): UnifiedAuditRow {
  return {
    key: "ledger-1",
    actorKind: "agent",
    createdAt: new Date("2026-08-29T03:20:00.000Z"),
    actorLabel: "frontend-agent",
    actorUid: "agent-1",
    label: {
      kind: "tool",
      key: "project.audit.tool.addActivity",
      toolName: "add_activity",
    },
    detail: "Implementation complete",
    taskId: "task-1",
    model: "gpt-5",
    failed: false,
    worktree: { state: "value", value: "project/task-1" },
    evidence: {
      paramsJson: null,
      resultText: "Activity logged",
      instructionRedacted: null,
      activityText: "Implementation complete",
      resolutionText: null,
    },
    ...overrides,
  };
}

function group(overrides: Partial<AuditTicketGroup> = {}): AuditTicketGroup {
  return {
    key: "task-1",
    taskId: "task-1",
    title: "Compact audit card",
    status: "IN_PROGRESS",
    missionId: "mission-1",
    prUrl: "https://github.com/marblo-app/marblo/pull/1299",
    worktreeId: "project/task-1",
    claimedBy: "agent-1",
    models: ["gpt-5", "claude-sonnet"],
    actorLabels: ["frontend-agent", "orchestrator"],
    actionCount: 4,
    actorCount: 2,
    failedCount: 0,
    latestAt: new Date("2026-08-29T03:25:00.000Z"),
    attention: null,
    rows: [row()],
    detail: {
      lastActivity: "Implementation complete",
      resolutionSummary: null,
      prUrl: "https://github.com/marblo-app/marblo/pull/1299",
      worktreeId: "project/task-1",
    },
    ...overrides,
  };
}

function renderCard(expanded = false) {
  return render(
    createElement(ProjectAuditTicketCard, {
      group: group(),
      expanded,
      onToggle: vi.fn(),
      locale: "ko",
      worktrees: [],
      missionLabel: "Mission: audit density",
      onOpenTicket: vi.fn(),
      onOpenBoard: vi.fn(),
    }),
  );
}

describe("ProjectAuditTicketCard density", () => {
  it("uses WorkHistoryRow-level collapsed chrome and keeps only ledger summary facts visible", () => {
    const { container } = renderCard(false);

    const card = screen.getByTestId("audit-ticket");
    expect(card.className).toContain("rounded-lg");
    expect(card.className).toContain("px-3");
    expect(card.className).toContain("py-2");

    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle.className).toContain("flex-1");
    expect(toggle.textContent).toContain("IN_PROGRESS");
    expect(toggle.textContent).toContain("Compact audit card");

    const title = container.querySelector(".text-sm.text-primary");
    expect(title?.textContent).toBe("Compact audit card");

    expect(screen.getByText(/4 actions/).className).toContain("text-xs");
    expect(screen.getByText(/2 actors/)).toBeTruthy();
    expect(screen.getByText(/08\. 29\./)).toBeTruthy();

    expect(screen.queryByText("🤖 gpt-5")).toBeNull();
    expect(screen.queryByText("Mission: audit density")).toBeNull();
    expect(screen.queryByText("Implementation complete")).toBeNull();
  });

  it("restores links, model chips, mission chip, evidence, and original timeline when expanded", () => {
    renderCard(true);

    expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
    expect(screen.getAllByText("🤖 gpt-5").length).toBeGreaterThan(0);
    expect(screen.getByText("🤖 claude-sonnet")).toBeTruthy();
    expect(screen.getByText("Mission: audit density")).toBeTruthy();
    expect(screen.getAllByText("Implementation complete").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Activity logged").length).toBeGreaterThan(0);

    const ticketLinks = screen.getAllByTitle("#task-1");
    fireEvent.click(ticketLinks[1]);
    expect(ticketLinks[1]).toBeTruthy();
  });
});
