import { where, type Unsubscribe } from 'firebase/firestore';
import type { TaskComment } from '../types/chat';
import {
  createDocument,
  subscribeToCollection,
  toTimestamp,
  convertTimestamps,
} from './firestore';

const COLLECTION = 'taskComments';
const DATE_FIELDS = ['createdAt'];

function toComment(raw: Record<string, unknown>): TaskComment {
  return convertTimestamps<TaskComment>(raw, DATE_FIELDS);
}

export async function addComment(
  taskId: string,
  projectId: string,
  authorId: string,
  authorName: string,
  authorPhotoURL: string,
  content: string,
): Promise<string> {
  return createDocument(COLLECTION, {
    taskId,
    projectId,
    authorId,
    authorName,
    authorPhotoURL,
    content,
    createdAt: toTimestamp(new Date()),
  });
}

export function subscribeToComments(
  taskId: string,
  callback: (comments: TaskComment[]) => void,
): Unsubscribe {
  return subscribeToCollection<Record<string, unknown>>(
    COLLECTION,
    [where('taskId', '==', taskId)],
    (docs) => {
      const comments = docs.map(toComment).sort((a, b) => +a.createdAt - +b.createdAt);
      callback(comments);
    },
  );
}
