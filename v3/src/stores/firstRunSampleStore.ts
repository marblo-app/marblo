import { create } from "zustand";

/**
 * 첫 실행 샘플 프로젝트 자동 연결(#872)의 **진행 상태** — 화면에 보여주기 위한
 * 것뿐이다. "언제 시드할까" 는 `lib/firstRunSample` 이, 실제 시드·등록은
 * `useFirstRunSampleProject` 가 그대로 든다.
 *
 * 왜 필요한가: 시드는 디스크 쓰기 + git init + 첫 커밋이라 1~2초가 걸린다. 그
 * 사이 비기너 셸은 "작업할 폴더를 열어 주세요" 게이트를 그대로 그렸고, 신규
 * 유저(그리고 시연 중인 사장님)는 곧 알아서 붙을 폴더를 **직접 고르러** 네이티브
 * 피커를 열게 된다. 자동 연결이 그 뒤에 도착하면 화면이 한 번 튄다.
 *
 * 상태 하나로 끝나는 문제라 스토어도 딱 그만큼이다. persist 하지 않는다 — 이건
 * "이번 실행에서 지금 무슨 일이 벌어지는 중인가" 이지 기록이 아니다(기기당 1회
 * 마커는 이미 localStorage 에 있다).
 */
export type FirstRunSampleStatus =
  | "idle"
  | "preparing"
  | "connected"
  | "failed";

interface FirstRunSampleState {
  status: FirstRunSampleStatus;
  setStatus: (status: FirstRunSampleStatus) => void;
}

export const useFirstRunSampleStore = create<FirstRunSampleState>((set) => ({
  status: "idle",
  setStatus: (status) => set({ status }),
}));
