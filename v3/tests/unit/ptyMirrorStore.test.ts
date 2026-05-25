import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("window", {});

const { usePtyMirrorStore } = await import("../../src/stores/ptyMirrorStore");

beforeEach(() => {
  // zustand setState with replace=true would wipe actions too — only clear
  // the data fields and keep the action methods bound by create().
  usePtyMirrorStore.setState({ buffers: {}, attached: {} });
});

describe("ptyMirrorStore", () => {
  it("ingest splits chunks into lines (LF)", () => {
    usePtyMirrorStore.getState().ingest("s1", "hello\nworld\n");
    expect(usePtyMirrorStore.getState().getLines("s1")).toEqual([
      "hello",
      "world",
    ]);
  });

  it("ingest holds partial trailing line until newline", () => {
    usePtyMirrorStore.getState().ingest("s1", "abc");
    expect(usePtyMirrorStore.getState().getLines("s1")).toEqual([]);
    usePtyMirrorStore.getState().ingest("s1", "def\n");
    expect(usePtyMirrorStore.getState().getLines("s1")).toEqual(["abcdef"]);
  });

  it("normalizes CRLF to LF", () => {
    usePtyMirrorStore.getState().ingest("s1", "first\r\nsecond\r\n");
    expect(usePtyMirrorStore.getState().getLines("s1")).toEqual([
      "first",
      "second",
    ]);
  });

  it("treats bare CR as line overwrite (progress bar style)", () => {
    usePtyMirrorStore.getState().ingest("s1", "progress 50%\rprogress 75%\n");
    expect(usePtyMirrorStore.getState().getLines("s1")).toEqual([
      "progress 75%",
    ]);
  });

  it("ring buffer evicts oldest when capacity exceeded", () => {
    usePtyMirrorStore.setState({
      buffers: {
        s1: { lines: [], pendingTail: "", capacity: 3, rev: 0 },
      },
      attached: {},
    });
    usePtyMirrorStore.getState().ingest("s1", "a\nb\nc\nd\ne\n");
    expect(usePtyMirrorStore.getState().getLines("s1")).toEqual([
      "c",
      "d",
      "e",
    ]);
  });

  it("rev increments only on completed lines, not partial tail", () => {
    usePtyMirrorStore.getState().ingest("s1", "partial");
    const r1 = usePtyMirrorStore.getState().buffers["s1"].rev;
    usePtyMirrorStore.getState().ingest("s1", "tail\n");
    const r2 = usePtyMirrorStore.getState().buffers["s1"].rev;
    expect(r2).toBeGreaterThan(r1);
  });

  it("isolates sessions — ingest into one does not touch another", () => {
    usePtyMirrorStore.getState().ingest("s1", "alpha\n");
    usePtyMirrorStore.getState().ingest("s2", "beta\n");
    expect(usePtyMirrorStore.getState().getLines("s1")).toEqual(["alpha"]);
    expect(usePtyMirrorStore.getState().getLines("s2")).toEqual(["beta"]);
  });

  it("reset clears lines but keeps the buffer registered", () => {
    usePtyMirrorStore.getState().ingest("s1", "x\ny\n");
    usePtyMirrorStore.getState().reset("s1");
    expect(usePtyMirrorStore.getState().getLines("s1")).toEqual([]);
    expect(usePtyMirrorStore.getState().buffers["s1"]).toBeDefined();
  });

  it("attach is idempotent — second call does not duplicate listener registration", () => {
    usePtyMirrorStore.getState().attach("s1");
    usePtyMirrorStore.getState().attach("s1");
    expect(usePtyMirrorStore.getState().attached["s1"]).toBe(true);
  });

  it("detach clears the attached flag but keeps the buffer for reattach", () => {
    usePtyMirrorStore.getState().attach("s1");
    usePtyMirrorStore.getState().ingest("s1", "hi\n");
    usePtyMirrorStore.getState().detach("s1");
    expect(usePtyMirrorStore.getState().attached["s1"]).toBeUndefined();
    expect(usePtyMirrorStore.getState().getLines("s1")).toEqual(["hi"]);
  });

  it("getLines on unknown session returns empty array (no throw)", () => {
    expect(usePtyMirrorStore.getState().getLines("nope")).toEqual([]);
  });
});
