import { where, orderBy, limit, type Unsubscribe } from "firebase/firestore";
import { subscribeToCollection, convertTimestamps } from "./firestore";
import type { MergeHistoryEntry } from "../types/mergeHistory";

const COLLECTION = "merge_history";
const DATE_FIELDS = ["mergedAt"];

function toEntry(raw: Record<string, unknown>): MergeHistoryEntry {
  return convertTimestamps<MergeHistoryEntry>(raw, DATE_FIELDS);
}

/**
 * Live-subscribe to the merge-history audit trail, newest first. The cockpit is
 * cross-project, so projectId is optional: omit it to watch every project (the
 * Worktrees tab default), or pass one to scope. A single orderBy needs no
 * composite index; the projectId filter keeps the same single-field ordering.
 */
export function subscribeToMergeHistory(
  callback: (entries: MergeHistoryEntry[]) => void,
  options?: { projectId?: string; maxResults?: number },
): Unsubscribe {
  const constraints = [
    ...(options?.projectId
      ? [where("projectId", "==", options.projectId)]
      : []),
    orderBy("mergedAt", "desc"),
    limit(options?.maxResults ?? 200),
  ];

  return subscribeToCollection<Record<string, unknown>>(
    COLLECTION,
    constraints,
    (docs) => callback(docs.map(toEntry)),
  );
}
