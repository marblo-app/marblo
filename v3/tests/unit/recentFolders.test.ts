import { describe, expect, it } from "vitest";
import {
  MAX_RECENT_FOLDERS,
  folderLabel,
  mergeRecentFolders,
  parseRecentFolders,
} from "../../src/lib/recentFolders";

describe("folderLabel", () => {
  it("returns the basename", () => {
    expect(folderLabel("/Users/me/projects/marblo")).toBe("marblo");
  });

  it("ignores trailing slashes", () => {
    expect(folderLabel("/Users/me/projects/marblo/")).toBe("marblo");
  });

  it("falls back to the path when there is no basename", () => {
    expect(folderLabel("/")).toBe("/");
  });
});

describe("mergeRecentFolders", () => {
  it("prepends the newest path", () => {
    expect(mergeRecentFolders(["/a", "/b"], "/c")).toEqual(["/c", "/a", "/b"]);
  });

  it("dedupes by moving an existing path to the front", () => {
    expect(mergeRecentFolders(["/a", "/b", "/c"], "/c")).toEqual([
      "/c",
      "/a",
      "/b",
    ]);
  });

  it("caps the list at the max length (newest-first)", () => {
    const existing = ["/a", "/b", "/c", "/d", "/e"];
    expect(mergeRecentFolders(existing, "/f")).toEqual([
      "/f",
      "/a",
      "/b",
      "/c",
      "/d",
    ]);
    expect(mergeRecentFolders(existing, "/f")).toHaveLength(MAX_RECENT_FOLDERS);
  });

  it("respects a custom max", () => {
    expect(mergeRecentFolders(["/a", "/b"], "/c", 2)).toEqual(["/c", "/a"]);
  });

  it("ignores blank paths but still cleans the existing list", () => {
    expect(mergeRecentFolders(["/a", "/a", "/b"], "   ")).toEqual(["/a", "/b"]);
  });

  it("trims the incoming path before comparing", () => {
    expect(mergeRecentFolders(["/a"], "  /a  ")).toEqual(["/a"]);
  });
});

describe("parseRecentFolders", () => {
  it("returns an empty list for null", () => {
    expect(parseRecentFolders(null)).toEqual([]);
  });

  it("returns an empty list for malformed JSON", () => {
    expect(parseRecentFolders("{not json")).toEqual([]);
  });

  it("returns an empty list for a non-array value", () => {
    expect(parseRecentFolders('{"a":1}')).toEqual([]);
  });

  it("keeps only string entries and dedupes", () => {
    expect(parseRecentFolders('["/a", 2, "/a", "/b", null]')).toEqual([
      "/a",
      "/b",
    ]);
  });

  it("caps at the max length", () => {
    const raw = JSON.stringify(["/a", "/b", "/c", "/d", "/e", "/f", "/g"]);
    expect(parseRecentFolders(raw)).toHaveLength(MAX_RECENT_FOLDERS);
  });
});
