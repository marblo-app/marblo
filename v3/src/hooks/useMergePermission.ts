import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./useAuth";
import { useProjectStore } from "../stores/projectStore";
import * as teamService from "../services/teamService";
import { canMergeAsRole } from "../lib/teamRoles";

/**
 * 프로젝트별 "현재 사용자가 머지 가능한가"(owner/admin) 판정.
 *
 * WorktreeTab 은 크로스프로젝트 워크트리를 한 화면에 그리므로 단일 projectId
 * 훅으로는 부족하다 — 멤버 프로젝트 전체에 대해 판정 맵을 만든다.
 * owner 는 스토어의 project.ownerId 만으로 판정(추가 read 0), 그 외에는
 * memberRoles 문서 1회 조회. 판정 전/실패 시엔 fail-closed(false) — 권한
 * 게이트는 잠깐 안 보이는 쪽이 잘못 열리는 쪽보다 낫다.
 */
export function useMergePermission() {
  const { user } = useAuth();
  const projects = useProjectStore((s) => s.projects);
  const [allowed, setAllowed] = useState<Record<string, boolean>>({});

  // 스냅샷마다 projects 배열 identity 가 바뀌므로 (id, ownerId) 시그니처로
  // 재조회를 묶는다 — 멤버십/오너 구성이 실제로 변할 때만 다시 판정한다.
  const projectsKey = useMemo(
    () =>
      projects
        .map((p) => `${p.id}:${p.ownerId}`)
        .sort()
        .join(","),
    [projects],
  );

  useEffect(() => {
    if (!user) {
      setAllowed({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, boolean> = {};
      for (const p of useProjectStore.getState().projects) {
        if (p.ownerId === user.uid) {
          next[p.id] = true;
          continue;
        }
        try {
          const role = await teamService.getMemberRole(p.id, user.uid);
          next[p.id] = canMergeAsRole(role);
        } catch {
          next[p.id] = false;
        }
      }
      if (!cancelled) setAllowed(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, projectsKey]);

  const canMergeInProject = useCallback(
    (projectId: string | null | undefined): boolean =>
      projectId ? (allowed[projectId] ?? false) : false,
    [allowed],
  );

  return { canMergeInProject };
}
