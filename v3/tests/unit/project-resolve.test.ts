/**
 * W7 — project id selection. Regression: create_task(project_id='마블로')
 * silently filed the task under the bound project (GFB8…) → invisible on the
 * user's board. selectProjectId now honors a valid explicit id and surfaces a
 * friendly name for the caller to resolve.
 */
import { describe, it, expect } from "vitest";
import {
  selectProjectId,
  looksLikeFirestoreId,
} from "../../electron/mcp-server/project-resolve";

const BOUND = "GFB8JnJrrX6AgahqmGB3xx"; // 22-char id (bound / default project)
const OTHER = "AbcdefGhijklmno1234567"; // another valid id

describe("looksLikeFirestoreId", () => {
  it("accepts long alphanumerics, rejects names/short/empty", () => {
    expect(looksLikeFirestoreId(BOUND)).toBe(true);
    expect(looksLikeFirestoreId("마블로")).toBe(false);
    expect(looksLikeFirestoreId("stockai-platform")).toBe(false);
    expect(looksLikeFirestoreId("short")).toBe(false);
    expect(looksLikeFirestoreId(undefined)).toBe(false);
  });
});

describe("selectProjectId", () => {
  it("honors an explicit valid id over the bound default (the core fix)", () => {
    const sel = selectProjectId(OTHER, BOUND);
    expect(sel).toMatchObject({ projectId: OTHER, source: "explicit" });
    expect(sel.friendlyName).toBeUndefined();
  });

  it("surfaces a friendly name and keeps default as fallback + warns", () => {
    const sel = selectProjectId("마블로", BOUND);
    expect(sel.projectId).toBe(BOUND);
    expect(sel.source).toBe("default");
    expect(sel.friendlyName).toBe("마블로");
    expect(sel.warning).toMatch(/not a Firestore document id/);
  });

  it("falls back to default when no explicit id is given", () => {
    expect(selectProjectId(undefined, BOUND)).toMatchObject({
      projectId: BOUND,
      source: "default",
    });
    expect(selectProjectId("", BOUND)).toMatchObject({
      projectId: BOUND,
      source: "default",
    });
  });

  it("reports 'none' when neither explicit nor default resolves", () => {
    expect(selectProjectId(undefined, "")).toMatchObject({
      projectId: "",
      source: "none",
    });
    // A friendly name with no bound project cannot be filed.
    const sel = selectProjectId("마블로", "");
    expect(sel.projectId).toBe("");
    expect(sel.source).toBe("none");
    expect(sel.warning).toMatch(/no bound project/);
  });

  it("trims whitespace before deciding", () => {
    expect(selectProjectId(`  ${OTHER}  `, BOUND)).toMatchObject({
      projectId: OTHER,
      source: "explicit",
    });
  });
});
