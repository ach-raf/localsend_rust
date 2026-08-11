import { invoke } from "@tauri-apps/api/core";
import { notifications } from "./notifications";

export interface TransferPeer {
  ip: string;
  port: number;
  alias: string;
}

function normalizeDesktopPath(path: string): string {
  if (!path.startsWith("file://")) return path;

  const url = new URL(path);
  const decodedPath = decodeURIComponent(url.pathname);
  if (url.hostname) {
    return `\\\\${url.hostname}${decodedPath.replaceAll("/", "\\")}`;
  }
  return decodedPath.replace(/^\/(?=[A-Za-z]:)/, "");
}

export async function sendFilePathsToPeer(
  peer: TransferPeer,
  paths: string[],
): Promise<void> {
  const filePaths = paths.map(normalizeDesktopPath);
  const filesMetadata = await Promise.all(
    filePaths.map((filePath) =>
      invoke<{ name: string; size: number }>("get_file_metadata", { filePath }),
    ),
  );

  const [accepted, sessionId] = await invoke<[boolean, string]>(
    "request_batch_transfer_to_peer",
    {
      peerIp: peer.ip,
      peerPort: peer.port,
      files: filesMetadata.map((file) => [file.name, file.size]),
    },
  );

  if (!accepted) {
    const message = `The peer rejected the transfer of ${filesMetadata.length} files.`;
    notifications.show({
      title: "Transfer Rejected",
      message,
      color: "yellow",
    });
    throw new Error(message);
  }

  for (let index = 0; index < filePaths.length; index += 1) {
    const filePath = filePaths[index];
    const fileName = filesMetadata[index].name;
    const notificationId = `${sessionId}-${index}`;

    notifications.show({
      id: notificationId,
      title: `Sending ${fileName}`,
      message: "Starting...",
      loading: true,
      autoClose: false,
    });

    try {
      await invoke("send_file_to_peer", {
        peerIp: peer.ip,
        peerPort: peer.port,
        filePath,
        sessionId,
        progressId: notificationId,
      });
      notifications.update({
        id: notificationId,
        title: "Sent",
        message: `Successfully sent ${fileName}`,
        color: "phosphor",
        loading: false,
        autoClose: 2000,
      });
    } catch (error) {
      const message =
        typeof error === "string" ? error : String(error ?? "Unknown error");
      notifications.update({
        id: notificationId,
        title: "Error",
        message: `Failed to send ${fileName}: ${message}`,
        color: "red",
        loading: false,
        autoClose: 5000,
      });
      throw new Error(message);
    }
  }
}
