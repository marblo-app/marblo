import { describe, expect, it } from "vitest";
import { beginner as enBeginner } from "../../src/locales/en/beginner";
import { workspace as enWorkspace } from "../../src/locales/en/workspace";
import { beginner as koBeginner } from "../../src/locales/ko/beginner";
import { workspace as koWorkspace } from "../../src/locales/ko/workspace";

describe("mode label copy", () => {
  it("uses beginner mode and Marblo mode in English UI copy", () => {
    const copy = [
      enBeginner["beginner.topbar.advanced"],
      enBeginner["beginner.topbar.advancedHint"],
      enBeginner["beginner.promote.title"],
      enBeginner["beginner.promote.body"],
      enBeginner["beginner.promote.cta"],
      enBeginner["beginner.tour.advanced.title"],
      enBeginner["beginner.tour.advanced.body"],
      enBeginner["beginner.settings.off"],
      enBeginner["beginner.topbar.simple"],
      enBeginner["beginner.topbar.simpleHint"],
      enWorkspace["workspace.tour.settings.title"],
      enWorkspace["workspace.tour.settings.body"],
    ].join("\n");

    expect(copy).toContain("Beginner mode");
    expect(copy).toContain("Marblo mode");
    expect(copy).not.toMatch(/\bSimple mode\b|\bAdvanced mode\b/i);
  });

  it("uses 비기너 모드 and 마블로 모드 in Korean UI copy", () => {
    const copy = [
      koBeginner["beginner.topbar.advanced"],
      koBeginner["beginner.topbar.advancedHint"],
      koBeginner["beginner.promote.title"],
      koBeginner["beginner.promote.body"],
      koBeginner["beginner.promote.cta"],
      koBeginner["beginner.tour.advanced.title"],
      koBeginner["beginner.tour.advanced.body"],
      koBeginner["beginner.settings.off"],
      koBeginner["beginner.topbar.simple"],
      koBeginner["beginner.topbar.simpleHint"],
      koWorkspace["workspace.tour.settings.title"],
      koWorkspace["workspace.tour.settings.body"],
    ].join("\n");

    expect(copy).toContain("비기너 모드");
    expect(copy).toContain("마블로 모드");
    expect(copy).not.toMatch(
      /심플 모드|간단 모드|고급 모드|개발 모드|어드밴스/,
    );
  });
});
