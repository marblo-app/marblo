import { useEffect, useRef } from "react";
import {
  applyAssistantDefaultSurface,
  isAssistantProject,
} from "../lib/projectKind";
import { useProjectStore } from "../stores/projectStore";
import { useSplitWorkspaceStore } from "../stores/splitWorkspaceStore";

/**
 * assistant kind 프로젝트로 **전환**될 때 기본 서피스를 적용한다.
 *
 * - 우측 탭: board 중심이면 code 로 이동(위키/문서)
 * - 파일 사이드바 열기 + 문서 그래프 서브뷰
 * - 좌측 오케 대화열은 셸이 상시 유지(건드릴 것 없음)
 *
 * 프로젝트 id 가 바뀔 때만 1회. 같은 프로젝트 안에서의 탭 조작은 존중한다.
 * dev 프로젝트는 **아무 것도 하지 않는다**(현행 불변).
 */
export function useProjectKindSurface(): void {
  const currentProject = useProjectStore((s) => s.currentProject);
  const prevProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    const id = currentProject?.id ?? null;
    if (id === prevProjectIdRef.current) return;
    prevProjectIdRef.current = id;

    if (!isAssistantProject(currentProject)) return;

    const split = useSplitWorkspaceStore.getState();
    applyAssistantDefaultSurface({
      activeTab: split.activeTab,
      setActiveTab: split.setActiveTab,
      setFileTreeOpen: split.setFileTreeOpen,
    });
  }, [currentProject?.id, currentProject?.kind]);
}
