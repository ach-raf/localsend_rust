import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Container,
  Grid,
  Paper,
  Text,
  Title,
  Group,
  ThemeIcon,
  Stack,
  Tabs,
  Textarea,
  Button,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import { notifications } from "../lib/notifications";
import {
  IconUpload,
  IconFile,
  IconDeviceDesktop,
  IconSend,
  IconRefresh,
  IconX,
  IconClipboard,
  IconChevronRight,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { showOpenFilePicker } from "tauri-plugin-android-fs-api";
import ShareSheet from "../components/ShareSheet";
import TextMessageModal from "../components/TextMessageModal";
import StatusStrip from "../components/StatusStrip";
import FileTransferConfirmModal from "../components/FileTransferConfirmModal";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { useIncomingShareQueue } from "../hooks/useIncomingShareQueue";
import { sendFilePathsToPeer } from "../lib/fileTransfer";
import {
  enqueueRequest,
  formatFileSize,
  removeRequest,
  type IncomingMessage,
  type IncomingRequest,
} from "../lib/incomingRequests";
import { detectAndroid } from "../lib/platform";
import {
  createIncomingShareProgress,
  forwardIncomingShare,
  getIncomingShareText,
  type IncomingShareProgress,
} from "../lib/incomingShares";
import {
  hasOpenableFile,
  openReceivedFile,
  type ReceivedFileRef,
} from "../lib/receivedFiles";
import { monogram } from "../lib/peerDisplay";

interface Peer {
  id?: string;
  ip: string;
  port: number;
  alias: string;
  hostname: string;
}

interface FileTransferRequest {
  transfer_id: string;
  file_name: string;
  file_size?: number;
  sender_ip: string;
}

interface BatchTransferRequest {
  session_id: string;
  sender_alias: string;
  sender_ip: string;
  files: { name: string; size: number }[];
}

export default function Home() {
  const androidEnabled = useMemo(detectAndroid, []);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<Peer | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Prompts and messages queue up instead of overwriting each other.
  const [messages, setMessages] = useState<IncomingMessage[]>([]);
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const requestsRef = useRef<IncomingRequest[]>([]);
  const currentRequest = requests[0] ?? null;
  const currentMessage = messages[0] ?? null;
  const [dragTargetPeerKey, setDragTargetPeerKey] = useState<string | null>(
    null,
  );
  // Whole-window drag feedback + held drops: a drop that hits no peer card
  // goes to the selected device, or waits here until the user taps one.
  const [dragOverWindow, setDragOverWindow] = useState(false);
  const [stagedDrops, setStagedDrops] = useState<string[]>([]);
  const {
    shares: pendingShares,
    currentShare: pendingShare,
    acknowledge: acknowledgeIncomingShare,
  } = useIncomingShareQueue(androidEnabled);

  // Use ref to access current selectedPeer in event handlers without re-subscribing
  const selectedPeerRef = useRef<Peer | null>(null);
  const peersRef = useRef<Peer[]>([]);
  const [shareSendingKey, setShareSendingKey] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const shareProgressRef = useRef(
    new Map<string, IncomingShareProgress>(),
  );

  const pendingShareText = pendingShare
    ? getIncomingShareText(pendingShare)
    : null;

  useEffect(() => {
    selectedPeerRef.current = selectedPeer;
  }, [selectedPeer]);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    requestsRef.current = requests;
  }, [requests]);

  useEffect(() => {
    const applyPeers = (incoming: Peer[]) => {
      // Deduplicate peers by IP address (in case multiple mDNS entries exist)
      const uniquePeers = incoming.reduce((acc, peer) => {
        // Use IP as the unique key - if multiple entries have same IP, keep the most recent
        const existingIndex = acc.findIndex((p) => p.ip === peer.ip);
        if (existingIndex === -1) {
          acc.push(peer);
        } else {
          // Replace with the new entry (assumes newer is better)
          acc[existingIndex] = peer;
        }
        return acc;
      }, [] as Peer[]);
      setPeers(uniquePeers);

      // If the selected peer dropped off the network and we're not mid-send,
      // close the send panel so the user isn't left staring at a dead peer.
      // Incoming receives are independent of this panel, so we only guard on
      // outgoing activity (sending) here.
      const sel = selectedPeerRef.current;
      if (
        sel &&
        !sendingRef.current &&
        !uniquePeers.some(
          (p) => p.ip === sel.ip && p.port === sel.port,
        )
      ) {
        setSelectedPeer(null);
      }
    };

    // Subscribe FIRST, then pull a snapshot. The backend only emits when the
    // list changes, and this page is unmounted while on Settings, so without the
    // snapshot a remount shows an empty list until something changes. (Calling
    // refresh before `listen` resolved also lost its re-emit.)
    const unlistenPeers = listen<Peer[]>("peers-update", (event) =>
      applyPeers(event.payload),
    );
    unlistenPeers
      .then(() => invoke<Peer[]>("get_peers"))
      .then(applyPeers)
      .then(() => invoke("refresh_peers"))
      .catch((e) => console.error("Failed to load peers:", e));

    const unlistenFileStart = listen("file-receive-start", (event: any) => {
      const { transfer_id, file_name } = event.payload;
      notifications.show({
        title: "Receiving File",
        message: `Receiving ${file_name}...`,
        loading: true,
        autoClose: false,
        id: transfer_id,
      });
    });

    const unlistenProgress = listen("transfer-progress", (event: any) => {
      const { transfer_id, current_bytes, total_bytes } = event.payload;
      const percent = total_bytes
        ? Math.round((current_bytes / total_bytes) * 100)
        : 0;
      const sizeStr = total_bytes ? formatFileSize(total_bytes) : "Unknown";
      const currentStr = formatFileSize(current_bytes);

      // Try to update notification if it exists (for receiver or sender if ID matches)
      // Note: Mantine notifications.update does not create if missing?
      // Actually if sender, we created it in handleSelectFiles.
      // If receiver, we created it in file-receive-start.
      notifications.update({
        id: transfer_id,
        title: total_bytes ? `Transferring... ${percent}%` : "Transferring...",
        message: `${currentStr} / ${sizeStr}`,
        loading: true,
        autoClose: false,
      });
    });

    const unlistenFileComplete = listen(
      "file-receive-complete",
      (event: any) => {
        const {
          transfer_id,
          file_name,
          file_path,
          file_uri,
          show_in_app = true,
        } = event.payload;
        const fileRef: ReceivedFileRef = { file_path, file_uri };

        if (!show_in_app) {
          notifications.hide(transfer_id);
          return;
        }

        notifications.update({
          id: transfer_id,
          title: "File Received",
          message: `Successfully received ${file_name}`,
          color: "phosphor",
          loading: false,
          autoClose: 10000,
          action: hasOpenableFile(fileRef)
            ? {
                label: file_uri ? "Open File" : "Open File Location",
                onClick: () => {
                  void openReceivedFile(fileRef).catch((error) => {
                    console.error("Failed to open received file:", error);
                    notifications.show({
                      title: "Unable to open file",
                      message: String(error),
                      color: "red",
                    });
                  });
                },
              }
            : undefined,
        });
      }
    );

    const unlistenMessage = listen<{
      sender_alias: string;
      sender_ip: string;
      content: string;
    }>("message-received", (event) => {
      setMessages((queue) => [
        ...queue,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          senderAlias: event.payload.sender_alias,
          senderIp: event.payload.sender_ip,
          content: event.payload.content,
        },
      ]);
    });

    const unlistenFileTransferRequest = listen<FileTransferRequest>(
      "file-transfer-request",
      (event) => {
        const r = event.payload;
        setRequests((queue) =>
          enqueueRequest(queue, {
            id: r.transfer_id,
            kind: "file",
            senderAlias: null,
            senderIp: r.sender_ip,
            files: [{ name: r.file_name, size: r.file_size }],
          }),
        );
      },
    );

    const unlistenBatchTransferRequest = listen<BatchTransferRequest>(
      "batch-transfer-request",
      (event) => {
        const r = event.payload;
        setRequests((queue) =>
          enqueueRequest(queue, {
            id: r.session_id,
            kind: "batch",
            senderAlias: r.sender_alias,
            senderIp: r.sender_ip,
            files: r.files,
          }),
        );
      },
    );

    // The sender gave up (timeout / disconnect): close that prompt only.
    const unlistenRequestCancelled = listen<{ id: string }>(
      "transfer-request-cancelled",
      (event) => {
        const wasShowing = requestsRef.current.some(
          (r) => r.id === event.payload.id,
        );
        setRequests((queue) => removeRequest(queue, event.payload.id));
        if (wasShowing) {
          notifications.show({
            title: "Request expired",
            message: "The sender cancelled or didn't wait for an answer.",
            color: "yellow",
            autoClose: 4000,
          });
        }
      },
    );

    const unlistenRequestAnswered = listen<{ id: string }>(
      "transfer-request-answered",
      (event) => setRequests((queue) => removeRequest(queue, event.payload.id)),
    );

    const unlistenFileTransferError = listen<{
      transfer_id: string;
      file_name: string;
      reason?: string;
    }>("file-receive-error", (event) => {
      notifications.update({
        id: event.payload.transfer_id,
        title: "Transfer failed",
        message: `${event.payload.file_name} wasn't saved${
          event.payload.reason ? ` — ${event.payload.reason}` : ""
        }`,
        color: "red",
        loading: false,
        autoClose: 8000,
      });
    });

    // The receiving server couldn't start (e.g. port taken): say so loudly.
    const unlistenServerError = listen<string>("server-error", (event) => {
      notifications.show({
        id: "server-error",
        title: "Can't receive files",
        message: event.payload,
        color: "red",
        autoClose: false,
      });
    });

    // Listen for media scan trigger on Android
    const unlistenMediaScan = listen<string>(
      "trigger-media-scan",
      async (event) => {
        try {
          await invoke("plugin:media_scanner|scan_media_file", {
            path: event.payload,
          });
        } catch (e) {
          console.error("Failed to trigger media scan:", e);
        }
      }
    );

    const unlistenFileDrop = getCurrentWebview().onDragDropEvent(
      async (event) => {
        if (event.payload.type === "leave") {
          setDragTargetPeerKey(null);
          setDragOverWindow(false);
          return;
        }

        const scaleFactor = await getCurrentWindow().scaleFactor();
        const x = event.payload.position.x / scaleFactor;
        const y = event.payload.position.y / scaleFactor;
        const element = document.elementFromPoint(x, y);
        const peerElement = element?.closest<HTMLElement>(
          "[data-peer-drop-key]",
        );
        const targetKey = peerElement?.dataset.peerDropKey ?? null;

        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragTargetPeerKey(targetKey);
          setDragOverWindow(true);
          return;
        }

        // Drop: every pixel of the window is a valid target. A peer card
        // targets that card; anything else targets the selected device —
        // including while the Text tab is open — or is held for later when
        // no device is selected.
        setDragTargetPeerKey(null);
        setDragOverWindow(false);
        const paths = event.payload.paths;
        if (paths.length === 0) return;

        const targetPeer = targetKey
          ? peersRef.current.find(
              (peer) => `${peer.ip}:${peer.port}` === targetKey,
            )
          : selectedPeerRef.current;

        if (!targetPeer) {
          // Never lose a drop: hold the files until a device is tapped.
          setStagedDrops((prev) => [...prev, ...paths]);
          notifications.show({
            title: "Files ready",
            message: "Dropped files are waiting — tap a device to send them.",
            color: "phosphor",
          });
          return;
        }

        setSelectedPeer(targetPeer);
        await sendFilesToPeer(targetPeer, event.payload.paths);
      },
    );

    return () => {
      unlistenPeers.then((f) => f());
      unlistenFileStart.then((f) => f());
      unlistenFileComplete.then((f) => f());
      unlistenMessage.then((f) => f());
      unlistenFileTransferRequest.then((f) => f());
      unlistenBatchTransferRequest.then((f) => f());
      unlistenRequestCancelled.then((f) => f());
      unlistenRequestAnswered.then((f) => f());
      unlistenServerError.then((f) => f());
      unlistenFileTransferError.then((f) => f());
      unlistenMediaScan.then((f) => f());
      unlistenFileDrop.then((f) => f());
      unlistenProgress.then((f) => f());
    };
  }, []);

  /**
   * The one outgoing-files path: guards concurrent sends and surfaces
   * failures. Used by the file picker, window drops, and staged sends so
   * they can never drift apart.
   */
  const sendFilesToPeer = useCallback(async (peer: Peer, paths: string[]) => {
    if (sendingRef.current) {
      notifications.show({
        title: "Transfer in progress",
        message:
          "Wait for the current batch to finish before sending more files.",
        color: "yellow",
      });
      return false;
    }
    sendingRef.current = true;
    setSending(true);
    try {
      await sendFilePathsToPeer(peer, paths);
      return true;
    } catch (error) {
      console.error("Failed to send files:", error);
      notifications.show({
        title: "Unable to send files",
        message: String(error),
        color: "red",
      });
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, []);

  const handleSelectFiles = async () => {
    if (!selectedPeer) {
      notifications.show({
        title: "No Peer Selected",
        message: "Please select a peer to send files to.",
        color: "yellow",
      });
      return;
    }

    try {
      let filePaths: string[] = [];

      // Use Android FS API on Android, dialog plugin on other platforms
      if (androidEnabled) {
        try {
          const uris = await showOpenFilePicker({
            multiple: true,
            mimeTypes: ["*/*"],
          });
          // Convert AndroidFsUri[] to string[] - properly convert URI objects to strings
          filePaths = (uris || []).map((uri) => {
            // The API returns URI objects - check various possible structures
            if (typeof uri === "string") {
              return uri;
            }
            // Try accessing the uri property directly (common structure)
            if (uri && typeof uri === "object") {
              // Check for common property names
              if ("uri" in uri && typeof uri.uri === "string") {
                return uri.uri;
              }
              // Check if it has a toString method
              if (typeof uri.toString === "function") {
                const str = uri.toString();
                // Only use toString if it returns a valid URI string
                if (str && str.startsWith("content://")) {
                  return str;
                }
              }
              // Try JSON stringify and parse to extract URI
              try {
                const jsonStr = JSON.stringify(uri);
                const parsed = JSON.parse(jsonStr);
                if (parsed.uri && typeof parsed.uri === "string") {
                  return parsed.uri;
                }
              } catch {}
            }
            // Last resort: try String conversion
            const str = String(uri);
            if (str && str.startsWith("content://")) {
              return str;
            }
            // If all else fails, log and throw
            console.error("Failed to extract URI from:", uri);
            throw new Error(`Invalid URI object: ${JSON.stringify(uri)}`);
          });

          if (filePaths.length === 0) {
            return; // User cancelled or no files selected
          }

          console.log("Selected file URIs:", filePaths);
        } catch (e) {
          console.error("Failed to open file picker on Android:", e);
          notifications.show({
            title: "Error",
            message: `Failed to open file picker: ${e}`,
            color: "red",
          });
          return;
        }
      } else {
        // Use dialog plugin on desktop
        const selected = await open({
          multiple: true,
          directory: false,
        });

        if (!selected) {
          return; // User cancelled
        }

        // Convert to array if single file selected
        filePaths = Array.isArray(selected) ? selected : [selected];
      }

      await sendFilesToPeer(selectedPeer, filePaths);
    } catch (e) {
      notifications.show({
        title: "Error",
        message: `Failed to open file dialog: ${e}`,
        color: "red",
      });
    }
  };

  /** Selecting a device flushes any files staged from a no-target drop. */
  const handlePeerClick = async (peer: Peer) => {
    setSelectedPeer(peer);
    if (stagedDrops.length === 0) return;
    const files = stagedDrops;
    setStagedDrops([]);
    const sent = await sendFilesToPeer(peer, files);
    if (!sent) {
      // Put them back — a failed send must not eat the user's files.
      setStagedDrops((prev) => [...files, ...prev]);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedPeer || !message.trim()) return;
    setSending(true);
    try {
      await invoke("send_text_to_peer", {
        peerIp: selectedPeer.ip,
        peerPort: selectedPeer.port,
        text: message,
      });
      notifications.show({
        title: "Sent",
        message: "Message sent",
        color: "phosphor",
      });
      setMessage("");
    } catch (e) {
      notifications.show({
        title: "Error",
        message: `Failed to send message: ${e}`,
        color: "red",
      });
    } finally {
      setSending(false);
    }
  };

  const handleSendIncomingShare = async (peer: Peer) => {
    if (!pendingShare || sendingRef.current) return;

    const progress =
      shareProgressRef.current.get(pendingShare.id) ??
      createIncomingShareProgress();
    shareProgressRef.current.set(pendingShare.id, progress);
    sendingRef.current = true;
    setSending(true);
    setShareSendingKey(`${peer.ip}:${peer.port}`);

    try {
      await forwardIncomingShare(pendingShare, peer, progress, {
        sendFiles: sendFilePathsToPeer,
        sendText: async (target, text) => {
          await invoke("send_text_to_peer", {
            peerIp: target.ip,
            peerPort: target.port,
            text,
          });
        },
        acknowledge: acknowledgeIncomingShare,
      });
      shareProgressRef.current.delete(pendingShare.id);
      notifications.show({
        title: "Sent",
        message: `Shared content sent to ${peer.alias}`,
        color: "phosphor",
      });
    } catch (error) {
      console.error("Failed to send incoming share:", error);
      notifications.show({
        title: "Couldn't send — tap a device to retry",
        message: String(error),
        color: "red",
      });
    } finally {
      sendingRef.current = false;
      setSending(false);
      setShareSendingKey(null);
    }
  };

  const handleDiscardIncomingShare = async () => {
    if (!pendingShare || sendingRef.current) return;

    try {
      await acknowledgeIncomingShare(pendingShare.id);
      shareProgressRef.current.delete(pendingShare.id);
    } catch (error) {
      notifications.show({
        title: "Unable to cancel share",
        message: String(error),
        color: "red",
      });
    }
  };

  // A share just arrived (cold start or warm): kick discovery so the picker
  // fills quickly instead of waiting for the next mDNS announcement.
  const pendingShareId = pendingShare?.id ?? null;
  useEffect(() => {
    if (!pendingShareId) return;
    invoke("refresh_peers").catch((e) =>
      console.error("Failed to refresh peers for share:", e),
    );
  }, [pendingShareId]);

  // Core refresh — no UI side effects. Shared by the header button and the
  // pull-to-refresh gesture so they can't drift apart.
  const refreshPeers = useCallback(async () => {
    await invoke("refresh_peers");
    // Keep the button spinner alive briefly so it's obvious something happened
    // even when discovery resolves instantly.
    await new Promise((r) => setTimeout(r, 800));
  }, []);

  const handleRefreshPeers = async () => {
    setRefreshing(true);
    try {
      await refreshPeers();
      notifications.show({
        title: "Discovery Refreshed",
        message: "Searching for nearby peers...",
        color: "phosphor",
        autoClose: 2000,
      });
    } catch (e) {
      notifications.show({
        title: "Error",
        message: `Failed to refresh: ${e}`,
        color: "red",
      });
    } finally {
      setTimeout(() => setRefreshing(false), 2000);
    }
  };

  // Pull-to-refresh — Android only.
  // Refs the hook drives directly (no React renders during the drag).
  const ptrContentRef = useRef<HTMLDivElement>(null);
  const ptrSpinnerRef = useRef<HTMLDivElement>(null);
  const { refreshing: ptrRefreshing, armed: ptrArmed } = usePullToRefresh({
    enabled: androidEnabled,
    onRefresh: refreshPeers,
    contentRef: ptrContentRef,
    spinnerRef: ptrSpinnerRef,
  });

  const answerRequest = async (accepted: boolean) => {
    const request = requestsRef.current[0];
    if (!request) return;

    try {
      await invoke("respond_to_file_transfer", {
        transferId: request.id,
        accepted,
      });
    } catch (e) {
      // Usually "not found": the sender already gave up. Nothing to answer.
      console.warn("Transfer response failed:", e);
      notifications.show({
        title: "Too late",
        message: "That request is no longer active.",
        color: "yellow",
        autoClose: 3000,
      });
    } finally {
      setRequests((queue) => removeRequest(queue, request.id));
    }
  };

  const handleAcceptTransfer = () => answerRequest(true);
  const handleRejectTransfer = () => answerRequest(false);

  return (
    <>
      {/* Pull-to-refresh indicator (Android only). Always mounted when enabled;
          its opacity/scale are driven by the --ptr-progress CSS variable set by
          the hook, so revealing it costs no React renders. */}
      {androidEnabled && (
        <div
          className={`ptr-indicator${ptrRefreshing ? " is-refreshing" : ""}`}
          aria-hidden="true"
          style={{ top: `calc(64px + env(safe-area-inset-top, 0px))` }}
        >
          <ThemeIcon
            size={36}
            variant={ptrArmed || ptrRefreshing ? "filled" : "light"}
            color="phosphor"
            radius="xl"
            className={ptrRefreshing ? "ptr-spinner" : ""}
          >
            <div ref={ptrSpinnerRef} style={{ display: "grid", placeItems: "center" }}>
              <IconRefresh size={20} />
            </div>
          </ThemeIcon>
          <Text size="xs" c="dimmed" mt={6}>
            {ptrRefreshing
              ? "Searching…"
              : ptrArmed
                ? "Release to refresh"
                : "Pull to refresh"}
          </Text>
        </div>
      )}

      {pendingShare ? (
        <ShareSheet
          share={pendingShare}
          queuedCount={pendingShares.length}
          text={pendingShareText}
          peers={peers}
          sendingKey={shareSendingKey}
          onSend={handleSendIncomingShare}
          onCancel={handleDiscardIncomingShare}
        />
      ) : (
      <Container
        ref={ptrContentRef}
        size="100%"
        px={{ base: "xs", sm: "md", lg: "xl" }}
        pt={{ base: "md", sm: 0 }}
        className="animate-[fadeIn_250ms_ease-out]"
      >
        <StatusStrip />
        <Grid gutter={{ base: "xs", sm: "md", lg: "lg" }}>
          {/* Mobile: Single column that switches content. Desktop: Side-by-side */}
          <Grid.Col
            span={{ base: 12, sm: 12, md: 5, lg: 4, xl: 3 }}
            className={
              selectedPeer ? "hidden sm:block" : "relative sm:relative"
            }
          >
            <Paper p={{ base: "sm", sm: "lg" }} h="100%" className="peers-panel-paper">
              <Group justify="space-between" mb="lg" wrap="nowrap">
                <Title order={3} className="text-text-primary">
                  Nearby Peers
                </Title>
                <Tooltip label="Refresh discovery">
                  <ActionIcon
                    variant="light"
                    color="phosphor"
                    onClick={handleRefreshPeers}
                    loading={refreshing}
                    size="xl"
                  >
                    <IconRefresh size={24} stroke={2} />
                  </ActionIcon>
                </Tooltip>
              </Group>

              {stagedDrops.length > 0 && (
                <div className="staged-strip" role="status">
                  <IconFile size={18} aria-hidden="true" />
                  <span className="staged-strip-text">
                    <span className="t-mono">{stagedDrops.length}</span>{" "}
                    {stagedDrops.length === 1 ? "file" : "files"} ready — tap a
                    device to send
                  </span>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="Discard staged files"
                    onClick={() => setStagedDrops([])}
                  >
                    <IconX size={16} />
                  </ActionIcon>
                </div>
              )}

              {peers.length === 0 ? (
                <div className="empty-listen">
                  <div className="signal">
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                  <h4>
                    Listening for <b>nearby devices</b>
                  </h4>
                  <p>
                    Open Local Share on another device — both must be on the
                    same Wi-Fi.
                  </p>
                </div>
              ) : (
                <Stack gap="sm">
                  {peers.map((peer) => {
                    const key = `${peer.ip}:${peer.port}`;
                    return (
                      <div
                        key={key}
                        data-peer-drop-key={key}
                        role="button"
                        tabIndex={0}
                        aria-pressed={selectedPeer?.ip === peer.ip}
                        className={`peer-card ${
                          selectedPeer?.ip === peer.ip ? "selected" : ""
                        } ${dragTargetPeerKey === key ? "peer-drop-target" : ""}`}
                        onClick={() => handlePeerClick(peer)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handlePeerClick(peer);
                          }
                        }}
                      >
                        <div className="peer-avatar" aria-hidden="true">
                          <span>{monogram(peer.alias)}</span>
                          <i className="peer-live" />
                        </div>
                        <div className="peer-meta">
                          <div className="peer-name">{peer.alias}</div>
                          <div className="peer-addr t-mono">
                            {peer.ip}
                            <span>:{peer.port}</span>
                          </div>
                          {dragTargetPeerKey === key && (
                            <div className="peer-drop-hint">Drop to send</div>
                          )}
                        </div>
                        <IconChevronRight
                          size={18}
                          className="peer-chevron"
                          aria-hidden="true"
                        />
                      </div>
                    );
                  })}
                </Stack>
              )}
            </Paper>
          </Grid.Col>

          {/* Mobile send panel - appears in same position as peer list */}
          <Grid.Col
            span={{ base: 12, sm: 12, md: 7, lg: 8, xl: 9 }}
            className={
              !selectedPeer ? "hidden sm:block" : "relative sm:relative"
            }
          >
            {selectedPeer ? (
              <Paper p={{ base: "sm", sm: "lg" }} className="send-panel-paper">
                <Group
                  justify="space-between"
                  mb="lg"
                  wrap="nowrap"
                  align="center"
                >
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                    <div className="panel-kicker">Send to</div>
                    <Title
                      order={3}
                      className="text-text-primary break-words leading-[1.2]"
                    >
                      {selectedPeer.alias}
                    </Title>
                  </div>
                  <Tooltip label="Close">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => setSelectedPeer(null)}
                      size="xl"
                      className="mobile-hide-close-button flex-shrink-0"
                    >
                      <IconX size={24} stroke={2} />
                    </ActionIcon>
                  </Tooltip>
                </Group>

                  <Tabs defaultValue="files">
                  <Tabs.List mb="lg" style={{ gap: "0.5rem" }}>
                    <Tabs.Tab
                      value="files"
                      leftSection={<IconFile size={16} />}
                    >
                      Files
                    </Tabs.Tab>
                    <Tabs.Tab
                      value="text"
                      leftSection={<IconSend size={16} />}
                    >
                      Text
                    </Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel
                    value="files"
                    className="tab-panel-fixed"
                    style={{ overflow: "hidden" }}
                  >
                    <div
                      className="upload-area flex flex-col items-center justify-center gap-4 py-[clamp(1rem,3vw,2rem)] px-[clamp(0.5rem,2vw,1rem)] cursor-pointer h-full"
                      onClick={handleSelectFiles}
                    >
                      <div className="upload-mark">
                        <IconUpload size={24} stroke={2} />
                      </div>
                      <div
                        style={{
                          textAlign: "center",
                          maxWidth: "100%",
                          padding: "0 0.25rem",
                        }}
                      >
                        <Text
                          fw={600}
                          mb="xs"
                          style={{ wordBreak: "break-word" }}
                        >
                          Send files to {selectedPeer.alias}
                        </Text>
                        <Text c="dimmed" size="sm">
                          Drag & drop, or click to browse
                        </Text>
                      </div>
                      <Button
                        leftSection={<IconFile size={18} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectFiles();
                        }}
                        loading={sending}
                        size="lg"
                        className="depth-button-primary min-w-[clamp(160px,40vw,200px)] h-[clamp(48px,10vw,56px)] text-[clamp(1.1rem,2.5vw,1.25rem)]"
                      >
                        Select Files
                      </Button>
                    </div>
                  </Tabs.Panel>

                  <Tabs.Panel
                    value="text"
                    className="tab-panel-fixed"
                    style={{ overflow: "hidden" }}
                  >
                    <Stack
                      gap="md"
                      style={{ height: "100%", overflow: "auto" }}
                    >
                      <div
                        style={{
                          position: "relative",
                          flex: 1,
                          minHeight: 0,
                          marginBottom: "1rem",
                        }}
                      >
                        <Textarea
                          placeholder="Type a message..."
                          minRows={6}
                          autosize
                          maxRows={10}
                          value={message}
                          onChange={(e) => setMessage(e.currentTarget.value)}
                          styles={{
                            input: {
                              fontSize: "clamp(1.1rem, 2.5vw, 1.25rem)",
                              lineHeight: "1.6",
                              paddingRight: "3.5rem",
                            },
                          }}
                        />
                        <Tooltip label="Paste from clipboard">
                          <ActionIcon
                            variant="light"
                            color="phosphor"
                            onClick={async () => {
                              try {
                                const clipboardText = await readText();
                                if (clipboardText) {
                                  setMessage((prev) => prev + clipboardText);
                                  notifications.show({
                                    title: "Pasted",
                                    message: "Content pasted from clipboard",
                                    color: "phosphor",
                                    autoClose: 2000,
                                  });
                                } else {
                                  notifications.show({
                                    title: "Clipboard Empty",
                                    message: "No text found in clipboard",
                                    color: "yellow",
                                    autoClose: 2000,
                                  });
                                }
                              } catch (e) {
                                notifications.show({
                                  title: "Error",
                                  message: `Failed to read clipboard: ${e}`,
                                  color: "red",
                                });
                              }
                            }}
                            size="lg"
                            className="absolute top-2 right-2"
                            style={{ zIndex: 10 }}
                          >
                            <IconClipboard size={18} />
                          </ActionIcon>
                        </Tooltip>
                      </div>
                      <Button
                        rightSection={<IconSend size={16} />}
                        onClick={handleSendMessage}
                        loading={sending}
                        disabled={!message.trim()}
                        size="lg"
                        className="depth-button-primary h-[clamp(48px,10vw,56px)] text-[clamp(1.1rem,2.5vw,1.25rem)]"
                        fullWidth
                      >
                        Send Message
                      </Button>
                    </Stack>
                  </Tabs.Panel>
                  </Tabs>
              </Paper>
            ) : (
              <Paper
                p={{ base: "md", sm: "xl" }}
                h="100%"
                className="empty-state-panel flex flex-col items-center justify-center"
              >
                <div className="empty-pick">
                  <div className="gl">
                    <IconDeviceDesktop size={22} />
                  </div>
                  <h4>No device selected</h4>
                  <p>Choose a peer to send files or text.</p>
                </div>
              </Paper>
            )}
          </Grid.Col>
        </Grid>
      </Container>
      )}

      {dragOverWindow && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <IconUpload size={28} stroke={2} />
            <span>
              {selectedPeer ? (
                <>
                  Drop to send to <b>{selectedPeer.alias}</b>
                </>
              ) : (
                "Drop files, then tap a device to send"
              )}
            </span>
          </div>
        </div>
      )}

      {currentMessage && (
        <TextMessageModal
          key={currentMessage.id}
          opened
          onClose={() =>
            setMessages((queue) => queue.filter((m) => m.id !== currentMessage.id))
          }
          senderAlias={currentMessage.senderAlias}
          content={currentMessage.content}
          waiting={messages.length - 1}
        />
      )}

      {currentRequest && (
        <FileTransferConfirmModal
          key={currentRequest.id}
          opened
          onClose={() => undefined}
          onAccept={handleAcceptTransfer}
          onReject={handleRejectTransfer}
          files={currentRequest.files}
          senderAlias={currentRequest.senderAlias}
          senderIp={currentRequest.senderIp}
          waiting={requests.length - 1}
          timeoutSeconds={60}
        />
      )}
    </>
  );
}
