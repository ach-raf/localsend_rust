import { useState, useEffect, useRef } from "react";
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
import { notifications } from "@mantine/notifications";
import {
  IconUpload,
  IconFile,
  IconDeviceDesktop,
  IconSend,
  IconRefresh,
  IconX,
  IconClipboard,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { AndroidFs, isAndroid } from "tauri-plugin-android-fs-api";
import TextMessageModal from "../components/TextMessageModal";
import FileTransferConfirmModal from "../components/FileTransferConfirmModal";

interface Peer {
  ip: string;
  port: number;
  alias: string;
  hostname: string;
}

interface ReceivedMessage {
  senderAlias: string;
  content: string;
}

interface FileTransferRequest {
  transfer_id: string;
  file_name: string;
  file_size?: number;
}

interface BatchTransferRequest {
  session_id: string;
  sender_alias: string;
  files: { name: string; size: number }[];
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function Home() {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<Peer | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [receivedMessage, setReceivedMessage] =
    useState<ReceivedMessage | null>(null);
  const [messageModalOpened, setMessageModalOpened] = useState(false);
  const [fileTransferRequest, setFileTransferRequest] =
    useState<FileTransferRequest | null>(null);
  const [batchTransferRequest, setBatchTransferRequest] =
    useState<BatchTransferRequest | null>(null);
  const [transferModalOpened, setTransferModalOpened] = useState(false);

  // Use ref to access current selectedPeer in event handlers without re-subscribing
  const selectedPeerRef = useRef<Peer | null>(null);

  useEffect(() => {
    selectedPeerRef.current = selectedPeer;
  }, [selectedPeer]);

  useEffect(() => {
    // Trigger initial discovery on mount
    invoke("refresh_peers").catch((e) => {
      console.error("Failed to trigger initial discovery:", e);
    });

    // Listen for peer updates
    const unlistenPeers = listen<Peer[]>("peers-update", (event) => {
      // Deduplicate peers by IP address (in case multiple mDNS entries exist)
      const uniquePeers = event.payload.reduce((acc, peer) => {
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
    });

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
        const { transfer_id, file_name, file_path } = event.payload;

        // Check if we're on Windows and have a file path
        const isWindows = navigator.platform.toLowerCase().includes("win");
        const hasFilePath = file_path && typeof file_path === "string";

        // Create message with button if on Windows and file path is available
        const messageContent =
          isWindows && hasFilePath ? (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <div>Successfully received {file_name}</div>
              <Button
                size="xs"
                variant="light"
                onClick={async () => {
                  try {
                    await invoke("open_file_location", { filePath: file_path });
                  } catch (error) {
                    console.error("Failed to open file location:", error);
                    notifications.show({
                      title: "Error",
                      message: "Failed to open file location",
                      color: "red",
                    });
                  }
                }}
                style={{ alignSelf: "flex-start", marginTop: "4px" }}
              >
                Open File Location
              </Button>
            </div>
          ) : (
            `Successfully received ${file_name}`
          );

        notifications.update({
          id: transfer_id,
          title: "File Received",
          message: messageContent,
          color: "phosphor",
          loading: false,
          autoClose: 10000, // Close after 10 seconds, even if button is available
        });
      }
    );

    const unlistenMessage = listen("message-received", (event: any) => {
      setReceivedMessage({
        senderAlias: event.payload.sender_alias,
        content: event.payload.content,
      });
      setMessageModalOpened(true);
    });

    // Listen for file transfer requests
    const unlistenFileTransferRequest = listen<FileTransferRequest>(
      "file-transfer-request",
      (event) => {
        console.log("File transfer request:", event.payload);
        setBatchTransferRequest(null);
        setFileTransferRequest(event.payload);
        setTransferModalOpened(true);
      }
    );

    // Listen for batch transfer requests
    const unlistenBatchTransferRequest = listen<BatchTransferRequest>(
      "batch-transfer-request",
      (event) => {
        console.log("Batch transfer request:", event.payload);
        setFileTransferRequest(null);
        setBatchTransferRequest(event.payload);
        setTransferModalOpened(true);
      }
    );

    // Listen for file transfer rejection
    const unlistenFileTransferRejected = listen(
      "file-transfer-rejected",
      (event) => {
        notifications.show({
          title: "Transfer Rejected",
          message: `File transfer rejected: ${event.payload}`,
          color: "yellow",
        });
      }
    );

    // Listen for file transfer timeout
    const unlistenFileTransferTimeout = listen<string>(
      "file-transfer-timeout",
      (event) => {
        // Try to update existing progress notification if it exists
        notifications.update({
          id: event.payload,
          title: "Transfer Timeout",
          message: `File transfer timed out: ${event.payload}`,
          color: "orange",
          autoClose: 5000,
          loading: false,
        });

        // Close the modal if it's still open for this transfer
        if (fileTransferRequest?.transfer_id === event.payload) {
          setTransferModalOpened(false);
          setFileTransferRequest(null);
        }
      }
    );

    // Listen for file transfer errors
    const unlistenFileTransferError = listen("file-receive-error", (event) => {
      notifications.show({
        title: "Transfer Error",
        message: `Failed to save file: ${event.payload}`,
        color: "red",
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

    // Listen for Tauri's native file drop events using the proper API
    const unlistenFileDrop = getCurrentWebview().onDragDropEvent(
      async (event) => {
        // Only handle 'drop' events, ignore 'over' and 'cancel'
        if (event.payload.type !== "drop") {
          return;
        }

        console.log("Drag-drop event received:", event.payload.paths);
        const currentPeer = selectedPeerRef.current;
        if (!currentPeer) {
          notifications.show({
            title: "No Peer Selected",
            message: "Please select a peer before dropping files.",
            color: "yellow",
          });
          return;
        }

        const filePaths = event.payload.paths;
        setSending(true);

        try {
          // 1. Get metadata for all files
          const filesMetadata = await Promise.all(
            filePaths.map(async (path) => {
              // On Windows, Tauri might provide file:/// URLs, normalize them
              let normalizedPath = path;
              if (normalizedPath.startsWith("file:///")) {
                normalizedPath = normalizedPath.replace("file:///", "");
                normalizedPath = decodeURIComponent(normalizedPath);
              }
              return await invoke<{ name: string; size: number }>(
                "get_file_metadata",
                { filePath: normalizedPath }
              );
            })
          );

          // 2. Request transfer for the whole batch
          const [accepted, sessionId] = await invoke<[boolean, string]>(
            "request_batch_transfer_to_peer",
            {
              peerIp: currentPeer.ip,
              peerPort: currentPeer.port,
              files: filesMetadata.map((f) => [f.name, f.size]),
            }
          );

          if (!accepted) {
            setSending(false);
            notifications.show({
              title: "Transfer Rejected",
              message: `The peer rejected the transfer of ${filesMetadata.length} files.`,
              color: "yellow",
            });
            return;
          }

          // 3. Send each file with the session ID
          for (let i = 0; i < filePaths.length; i++) {
            let filePath = filePaths[i];
            const fileName = filesMetadata[i].name;

            try {
              if (filePath.startsWith("file:///")) {
                filePath = filePath.replace("file:///", "");
                filePath = decodeURIComponent(filePath);
              }

              const notificationId = `${sessionId}-${i}`;

              notifications.show({
                id: notificationId,
                title: `Sending ${fileName}`,
                message: "Starting...",
                loading: true,
                autoClose: false,
              });

              await invoke("send_file_to_peer", {
                peerIp: currentPeer.ip,
                peerPort: currentPeer.port,
                filePath: filePath,
                sessionId: sessionId,
              });

              notifications.update({
                id: notificationId,
                title: "Sent",
                message: `Successfully sent ${fileName}`,
                color: "phosphor",
                loading: false,
                autoClose: 2000,
              });
            } catch (e) {
              const errorMsg =
                typeof e === "string" ? e : e?.toString() || String(e);
              console.error(`Failed to send ${fileName}:`, e);
              notifications.show({
                title: "Error",
                message: `Failed to send ${fileName}: ${errorMsg}`,
                color: "red",
              });
            }
          }
        } catch (e) {
          console.error("Unexpected error in drag-drop handler:", e);
          notifications.show({
            title: "Error",
            message: `Unexpected error: ${e}`,
            color: "red",
          });
        } finally {
          console.log("Drag-drop operation complete, resetting sending state");
          setSending(false);
        }
      }
    );

    return () => {
      unlistenPeers.then((f) => f());
      unlistenFileStart.then((f) => f());
      unlistenFileComplete.then((f) => f());
      unlistenMessage.then((f) => f());
      unlistenFileTransferRequest.then((f) => f());
      unlistenBatchTransferRequest.then((f) => f());
      unlistenFileTransferRejected.then((f) => f());
      unlistenFileTransferTimeout.then((f) => f());
      unlistenFileTransferError.then((f) => f());
      unlistenMediaScan.then((f) => f());
      unlistenFileDrop.then((f) => f());
      unlistenProgress.then((f) => f());
    };
  }, []); // Empty dependency array - only run on mount/unmount

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
      if (isAndroid()) {
        try {
          const uris = await AndroidFs.showOpenFilePicker({
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

      setSending(true);

      // 1. Get metadata for all files
      const filesMetadata = await Promise.all(
        filePaths.map(async (path) => {
          return await invoke<{ name: string; size: number }>(
            "get_file_metadata",
            { filePath: path }
          );
        })
      );

      // 2. Request transfer for the whole batch
      console.log("Requesting batch transfer for files:", filesMetadata);
      const [accepted, sessionId] = await invoke<[boolean, string]>(
        "request_batch_transfer_to_peer",
        {
          peerIp: selectedPeer.ip,
          peerPort: selectedPeer.port,
          files: filesMetadata.map((f) => [f.name, f.size]),
        }
      );
      console.log("Batch transfer request response:", { accepted, sessionId });

      if (!accepted) {
        setSending(false);
        notifications.show({
          title: "Transfer Rejected",
          message: `The peer rejected the transfer of ${filesMetadata.length} files.`,
          color: "yellow",
        });
        return;
      }

      // 3. Send each file with the session ID
      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        const fileName = filesMetadata[i].name;

        try {
          // Use a safe identifier for notifications
          const notificationId = `${sessionId}-${i}`;

          notifications.show({
            id: notificationId,
            title: `Sending ${fileName}`,
            message: "Starting...",
            loading: true,
            autoClose: false,
          });

          // Pass session_id to backend
          await invoke("send_file_to_peer", {
            peerIp: selectedPeer.ip,
            peerPort: selectedPeer.port,
            filePath: filePath,
            sessionId: sessionId,
          });

          notifications.update({
            id: notificationId,
            title: "Sent",
            message: `Successfully sent ${fileName}`,
            color: "phosphor",
            loading: false,
            autoClose: 2000,
          });
        } catch (e) {
          const errorMsg =
            typeof e === "string" ? e : e?.toString() || String(e);

          notifications.show({
            title: "Error",
            message: `Failed to send ${fileName}: ${errorMsg}`,
            color: "red",
            autoClose: 5000,
          });
          console.error(`Failed to send ${fileName}:`, e);
        }
      }
    } catch (e) {
      notifications.show({
        title: "Error",
        message: `Failed to open file dialog: ${e}`,
        color: "red",
      });
    } finally {
      setSending(false);
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

  const handleRefreshPeers = async () => {
    setRefreshing(true);
    try {
      await invoke("refresh_peers");
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
      // Keep spinning for a bit longer to show it's searching
      setTimeout(() => setRefreshing(false), 2000);
    }
  };

  const handleAcceptTransfer = async () => {
    if (!fileTransferRequest && !batchTransferRequest) return;

    try {
      const transferId = fileTransferRequest
        ? fileTransferRequest.transfer_id
        : batchTransferRequest!.session_id;

      await invoke("respond_to_file_transfer", {
        transferId: transferId,
        accepted: true,
      });
      setTransferModalOpened(false);
      setFileTransferRequest(null);
      setBatchTransferRequest(null);
    } catch (e) {
      notifications.show({
        title: "Error",
        message: `Failed to accept transfer: ${e}`,
        color: "red",
      });
    }
  };

  const handleRejectTransfer = async () => {
    if (!fileTransferRequest && !batchTransferRequest) return;

    try {
      const transferId = fileTransferRequest
        ? fileTransferRequest.transfer_id
        : batchTransferRequest!.session_id;

      await invoke("respond_to_file_transfer", {
        transferId: transferId,
        accepted: false,
      });
      setTransferModalOpened(false);
      setFileTransferRequest(null);
      setBatchTransferRequest(null);
      notifications.show({
        title: "Transfer Rejected",
        message: "File transfer rejected",
        color: "yellow",
      });
    } catch (e) {
      notifications.show({
        title: "Error",
        message: `Failed to reject transfer: ${e}`,
        color: "red",
      });
    }
  };

  return (
    <>
      <Container
        size="100%"
        px={{ base: "xs", sm: "md", lg: "xl" }}
        pt={{ base: "md", sm: 0 }}
        className="animate-[fadeIn_250ms_ease-out]"
      >
        <Grid gutter={{ base: "xs", sm: "md", lg: "lg" }}>
          {/* Mobile: Single column that switches content. Desktop: Side-by-side */}
          <Grid.Col
            span={{ base: 12, sm: 12, md: 5, lg: 4, xl: 3 }}
            className={
              selectedPeer ? "hidden sm:block" : "relative sm:relative"
            }
          >
            <Paper p={{ base: "sm", sm: "lg" }} h="100%" className="peers-panel-paper">
              <Group
                justify="space-between"
                mb="lg"
                wrap="nowrap"
                className="responsive-header-group"
              >
                <Title order={3} className="responsive-title text-text-primary">
                  Nearby Peers
                </Title>
                <Tooltip label="Refresh discovery">
                  <ActionIcon
                    variant="light"
                    color="phosphor"
                    onClick={handleRefreshPeers}
                    loading={refreshing}
                    size="xl"
                    className="responsive-icon-button"
                  >
                    <IconRefresh
                      size={24}
                      stroke={2}
                      className="responsive-icon"
                    />
                  </ActionIcon>
                </Tooltip>
              </Group>

              {peers.length === 0 ? (
                <div className="empty-listen">
                  <div className="signal">
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                  <h4>Listening for nearby devices</h4>
                  <p>
                    Waiting for devices on your network. Open Local Share on
                    another machine or phone.
                  </p>
                </div>
              ) : (
                <Stack gap="sm">
                  {peers.map((peer) => (
                    <div
                      key={peer.ip + peer.port}
                      className={`peer-card p-4 ${
                        selectedPeer?.ip === peer.ip ? "selected" : ""
                      }`}
                      onClick={() => setSelectedPeer(peer)}
                    >
                      <Group
                        gap="md"
                        wrap="nowrap"
                        align="flex-start"
                        className="responsive-peer-group"
                      >
                        <div style={{ position: "relative", flexShrink: 0 }}>
                          <ThemeIcon
                            size={48}
                            variant="light"
                            color="phosphor"
                            radius="md"
                            className="responsive-peer-icon"
                          >
                            <IconDeviceDesktop size={24} />
                          </ThemeIcon>
                          <div
                            className="absolute -top-1 -right-1 w-3 h-3 rounded-full"
                            style={{
                              zIndex: 10,
                              background: "var(--accent-success)",
                              boxShadow:
                                "0 0 0 3px color-mix(in oklch, var(--accent-success) 22%, transparent), 0 0 8px color-mix(in oklch, var(--accent-success) 55%, transparent)",
                            }}
                          />
                        </div>
                        <div
                          style={{ flex: 1, minWidth: 0, overflow: "hidden" }}
                        >
                          <Text
                            fw={600}
                            className={`responsive-peer-name break-words leading-[1.3] ${
                              selectedPeer?.ip === peer.ip
                                ? "text-accent-primary-light"
                                : "text-text-primary"
                            }`}
                          >
                            {peer.alias}
                          </Text>
                          <Text
                            size="xs"
                            c="dimmed"
                            className="responsive-peer-ip t-mono"
                            style={{ marginTop: "0.25rem" }}
                          >
                            {peer.ip}
                          </Text>
                        </div>
                      </Group>
                    </div>
                  ))}
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
                  className="responsive-header-group"
                >
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                    <Text size="sm" c="dimmed" tt="uppercase" fw={600} mb={4}>
                      Send to
                    </Text>
                    <Title
                      order={3}
                      className="responsive-title text-text-primary break-words leading-[1.2]"
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
                  <Tabs.List
                    mb="lg"
                    className="responsive-tabs-list"
                    style={{ gap: "0.5rem" }}
                  >
                    <Tabs.Tab
                      value="files"
                      leftSection={
                        <IconFile size={16} className="responsive-icon" />
                      }
                      className="responsive-tab"
                    >
                      Files
                    </Tabs.Tab>
                    <Tabs.Tab
                      value="text"
                      leftSection={
                        <IconSend size={16} className="responsive-icon" />
                      }
                      className="responsive-tab"
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
                      <div
                        className="responsive-upload-icon-container rounded-[clamp(8px,2vw,16px)] p-[clamp(0.5rem,2vw,0.75rem)]"
                        style={{
                          background:
                            "linear-gradient(135deg, var(--accent-primary-light), var(--accent-primary))",
                          boxShadow: "var(--shadow-m)",
                        }}
                      >
                        <IconUpload
                          size={24}
                          color="var(--on-accent)"
                          stroke={2}
                          className="responsive-upload-icon"
                        />
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
                          className="responsive-upload-title"
                          style={{ wordBreak: "break-word" }}
                        >
                          Send files to {selectedPeer.alias}
                        </Text>
                        <Text c="dimmed" className="responsive-upload-subtitle">
                          Drag & drop files here or click anywhere to select
                          files
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
                        className="depth-button-primary responsive-button min-w-[clamp(160px,40vw,200px)] h-[clamp(48px,10vw,56px)] text-[clamp(1.1rem,2.5vw,1.25rem)]"
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
                      className="responsive-stack"
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
                          className="responsive-textarea"
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
                            <IconClipboard
                              size={18}
                              className="responsive-icon"
                            />
                          </ActionIcon>
                        </Tooltip>
                      </div>
                      <Button
                        rightSection={<IconSend size={16} />}
                        onClick={handleSendMessage}
                        loading={sending}
                        disabled={!message.trim()}
                        size="lg"
                        className="depth-button-primary responsive-button h-[clamp(48px,10vw,56px)] text-[clamp(1.1rem,2.5vw,1.25rem)]"
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
                  <h4>Pick a device to start</h4>
                  <p>Choose a device from the nearby peers list.</p>
                </div>
              </Paper>
            )}
          </Grid.Col>
        </Grid>
      </Container>

      {receivedMessage && (
        <TextMessageModal
          opened={messageModalOpened}
          onClose={() => setMessageModalOpened(false)}
          senderAlias={receivedMessage.senderAlias}
          content={receivedMessage.content}
        />
      )}

      {(fileTransferRequest || batchTransferRequest) && (
        <FileTransferConfirmModal
          opened={transferModalOpened}
          onClose={() => setTransferModalOpened(false)}
          onAccept={handleAcceptTransfer}
          onReject={handleRejectTransfer}
          files={
            fileTransferRequest
              ? [
                  {
                    name: fileTransferRequest.file_name,
                    size: fileTransferRequest.file_size,
                  },
                ]
              : batchTransferRequest!.files
          }
        />
      )}
    </>
  );
}
