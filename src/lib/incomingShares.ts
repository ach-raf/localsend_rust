import type { IncomingShare } from "tauri-plugin-android-share-target-api";
import type { TransferPeer } from "./fileTransfer";

export interface IncomingShareProgress {
  peerKey: string | null;
  filesSent: boolean;
  textSent: boolean;
}

export interface IncomingShareActions {
  sendFiles(peer: TransferPeer, paths: string[]): Promise<void>;
  sendText(peer: TransferPeer, text: string): Promise<void>;
  acknowledge(id: string): Promise<boolean>;
}

export function createIncomingShareProgress(): IncomingShareProgress {
  return { peerKey: null, filesSent: false, textSent: false };
}

export function enqueueIncomingShare(
  shares: IncomingShare[],
  share: IncomingShare,
): IncomingShare[] {
  return shares.some((item) => item.id === share.id)
    ? shares
    : [...shares, share];
}

export function removeIncomingShare(
  shares: IncomingShare[],
  id: string,
): IncomingShare[] {
  return shares.filter((share) => share.id !== id);
}

export function getIncomingShareText(share: IncomingShare): string | null {
  const subject = share.subject?.trim() ?? "";
  const body = (share.text ?? share.htmlText)?.trim() ?? "";

  if (subject && body && subject !== body) return `${subject}\n\n${body}`;
  return body || subject || null;
}

export async function forwardIncomingShare(
  share: IncomingShare,
  peer: TransferPeer,
  progress: IncomingShareProgress,
  actions: IncomingShareActions,
): Promise<void> {
  const peerKey = `${peer.ip}:${peer.port}`;
  if (progress.peerKey !== peerKey) {
    progress.peerKey = peerKey;
    progress.filesSent = false;
    progress.textSent = false;
  }

  const paths = share.files.map((file) => file.uri);
  const text = getIncomingShareText(share);

  if (paths.length === 0 && !text) {
    throw new Error("The incoming share does not contain files or text");
  }

  if (paths.length > 0 && !progress.filesSent) {
    await actions.sendFiles(peer, paths);
    progress.filesSent = true;
  }

  if (text && !progress.textSent) {
    await actions.sendText(peer, text);
    progress.textSent = true;
  }

  await actions.acknowledge(share.id);
}
