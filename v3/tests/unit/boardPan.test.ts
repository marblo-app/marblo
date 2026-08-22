/**
 * @vitest-environment jsdom
 *
 * 보드 drag-to-pan 판단 로직 — lib/boardPan.ts.
 *
 * ★가장 중요한 계약: 카드(dnd-kit 이 role=button 을 붙인다)·버튼·입력칸·링크 위에서
 * 시작한 포인터는 pan 후보가 아니다. 이게 깨지면 카드 드래그앤드롭이 죽는다.
 */
import { describe, expect, it } from "vitest";
import {
  BoardPanSession,
  PAN_THRESHOLD_PX,
  isPanCandidatePointer,
  isPanIgnoredTarget,
} from "../../src/lib/boardPan";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("isPanIgnoredTarget — 어디서 시작한 포인터를 손대지 않나", () => {
  it("dnd-kit 카드 루트(role=button) 와 그 안쪽은 무시", () => {
    const root = mount(
      `<div id="col"><div role="button" id="card"><h4 id="title">t</h4></div></div>`,
    );
    expect(isPanIgnoredTarget(root.querySelector("#card"), root)).toBe(true);
    expect(isPanIgnoredTarget(root.querySelector("#title"), root)).toBe(true);
  });

  it("button / a[href] / input / textarea / select / label / contenteditable 무시", () => {
    const root = mount(`
      <button id="b">b</button>
      <a href="#" id="a">a</a>
      <input id="i" />
      <textarea id="t"></textarea>
      <select id="s"></select>
      <label id="l">l</label>
      <div contenteditable="true" id="ce">c</div>
      <div data-board-pan-ignore id="opt">o</div>
    `);
    for (const id of ["b", "a", "i", "t", "s", "l", "ce", "opt"]) {
      expect(isPanIgnoredTarget(root.querySelector(`#${id}`), root), id).toBe(
        true,
      );
    }
  });

  it("빈 배경(컨테이너 자신·컬럼 여백)은 pan 후보", () => {
    const root = mount(
      `<div id="col"><div id="header"><span id="label">DONE</span></div><div id="list"></div></div>`,
    );
    expect(isPanIgnoredTarget(root, root)).toBe(false);
    expect(isPanIgnoredTarget(root.querySelector("#col"), root)).toBe(false);
    expect(isPanIgnoredTarget(root.querySelector("#label"), root)).toBe(false);
    expect(isPanIgnoredTarget(root.querySelector("#list"), root)).toBe(false);
  });

  it("root 바깥 조상의 button 은 보지 않는다", () => {
    const outer = mount(
      `<button id="wrap"><div id="root"><div id="bg"></div></div></button>`,
    );
    const root = outer.querySelector("#root") as HTMLElement;
    expect(isPanIgnoredTarget(root.querySelector("#bg"), root)).toBe(false);
  });

  it("Element 가 아닌 타깃은 무시하지 않는다(null 안전)", () => {
    const root = mount(`<div></div>`);
    expect(isPanIgnoredTarget(null, root)).toBe(false);
  });
});

describe("isPanCandidatePointer — 포인터 종류", () => {
  it("마우스·펜 주 버튼만", () => {
    expect(isPanCandidatePointer({ button: 0, pointerType: "mouse" })).toBe(
      true,
    );
    expect(isPanCandidatePointer({ button: 0, pointerType: "pen" })).toBe(true);
    expect(isPanCandidatePointer({ button: 0 })).toBe(true); // 미지원 환경
  });
  it("오른쪽/가운데 버튼, 터치는 아니다", () => {
    expect(isPanCandidatePointer({ button: 1, pointerType: "mouse" })).toBe(
      false,
    );
    expect(isPanCandidatePointer({ button: 2, pointerType: "mouse" })).toBe(
      false,
    );
    expect(isPanCandidatePointer({ button: 0, pointerType: "touch" })).toBe(
      false,
    );
  });
});

describe("BoardPanSession — 임계값과 스크롤 계산", () => {
  it("임계값 미만 이동은 pan 이 아니다(클릭) — move 가 null, end 가 false", () => {
    const s = new BoardPanSession(100, 300);
    expect(s.move(100 + PAN_THRESHOLD_PX - 1)).toBeNull();
    expect(s.move(100 - (PAN_THRESHOLD_PX - 1))).toBeNull();
    expect(s.isPanning).toBe(false);
    expect(s.end()).toBe(false);
  });

  it("임계값을 넘으면 pan — 포인터 방향 반대로 scrollLeft 가 움직인다", () => {
    const s = new BoardPanSession(100, 300);
    // 오른쪽으로 20px 끌면 내용이 따라와야 하니 scrollLeft 는 줄어든다.
    expect(s.move(120)).toBe(280);
    expect(s.isPanning).toBe(true);
    // 이후엔 임계값과 무관하게 계속 따라온다(되돌아와도 pan 상태 유지).
    expect(s.move(101)).toBe(299);
    expect(s.move(60)).toBe(340);
    expect(s.end()).toBe(true);
    expect(s.isPanning).toBe(false);
  });

  it("scrollLeft 는 음수로 가지 않는다", () => {
    const s = new BoardPanSession(0, 10);
    expect(s.move(50)).toBe(0);
  });
});
