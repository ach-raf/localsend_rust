/**
 * Incoming "accept this?" prompts. Several devices (or one chatty one) can ask
 * at once; the UI shows them one at a time, oldest first, and a prompt that the
 * sender abandons must disappear without disturbing the others.
 */

export interface IncomingFile {
  name: string;
  size?: number;
}

export interface IncomingRequest {
  /** transfer_id for single files, session_id for batches — the key the
   * backend resolves the answer with. */
  id: string;
  kind: "file" | "batch";
  senderAlias: string | null;
  senderIp: string;
  files: IncomingFile[];
}

export function enqueueRequest(
  queue: IncomingRequest[],
  request: IncomingRequest,
): IncomingRequest[] {
  if (queue.some((item) => item.id === request.id)) return queue;
  return [...queue, request];
}

export function removeRequest(
  queue: IncomingRequest[],
  id: string,
): IncomingRequest[] {
  return queue.some((item) => item.id === id)
    ? queue.filter((item) => item.id !== id)
    : queue;
}

export interface IncomingMessage {
  id: string;
  senderAlias: string;
  senderIp: string;
  content: string;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}
