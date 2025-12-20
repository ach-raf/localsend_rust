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
  IconArrowLeft,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
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
        const { transfer_id, file_name } = event.payload;
        notifications.update({
          id: transfer_id,
          title: "File Received",
          message: `Successfully received ${file_name}`,
          color: "green",
          loading: false,
          autoClose: 5000,
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
        setFileTransferRequest(event.payload);
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
    const unlistenFileTransferTimeout = listen(
      "file-transfer-timeout",
      (event) => {
        notifications.show({
          title: "Transfer Timeout",
          message: `File transfer timed out: ${event.payload}`,
          color: "orange",
          autoClose: 5000,
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
          for (let filePath of filePaths) {
            try {
              // On Windows, Tauri might provide file:/// URLs, normalize them
              if (filePath.startsWith("file:///")) {
                filePath = filePath.replace("file:///", "");
                // Decode URL encoding (e.g., %20 -> space)
                filePath = decodeURIComponent(filePath);
              }

              let fileName = filePath.split(/[\\/]/).pop() || filePath;

              // On Android content URIs, try to get better filename
              if (filePath.startsWith("content://")) {
                try {
                  // Try Android FS API first
                  if (isAndroid()) {
                    try {
                      fileName = await AndroidFs.getName(filePath);
                    } catch {
                      // Fallback to backend
                      fileName = await invoke<string>("get_file_name", {
                        filePath,
                      });
                    }
                  } else {
                    fileName = await invoke<string>("get_file_name", {
                      filePath,
                    });
                  }
                } catch (e) {
                  console.warn(
                    "Could not get proper filename from content URI:",
                    e
                  );
                  // Use a fallback name
                  const uriParts = filePath.split("/");
                  const lastPart = uriParts[uriParts.length - 1] || "";
                  fileName = lastPart.split("?")[0] || "file";
                }
              }

              console.log(`Attempting to send file: ${fileName} (${filePath})`);

              // Pass file path/URI directly to backend - it handles both content URIs and regular paths
              await invoke("send_file_to_peer", {
                peerIp: currentPeer.ip,
                peerPort: currentPeer.port,
                filePath: filePath,
              });

              console.log("File sent successfully");

              notifications.show({
                title: "Sent",
                message: `Sent ${fileName}`,
                color: "green",
              });
            } catch (e) {
              // Extract filename safely for error message
              let errorFileName: string = "file";
              if (typeof filePath === "string") {
                if (filePath.startsWith("content://")) {
                  const uriParts = filePath.split("/");
                  const lastPart = uriParts[uriParts.length - 1] || "";
                  errorFileName = lastPart.split("?")[0] || "file";
                } else {
                  errorFileName = filePath.split(/[\\/]/).pop() || filePath;
                }
              }

              const errorMsg =
                typeof e === "string" ? e : e?.toString() || String(e);
              console.error(`Failed to send ${errorFileName}:`, e);
              notifications.show({
                title: "Error",
                message: `Failed to send ${errorFileName}: ${errorMsg}`,
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
      for (const filePath of filePaths) {
        try {
          // Extract filename from path - handle both regular paths and content URIs
          let fileName = filePath.split(/[\\/]/).pop() || filePath;

          // On Android content URIs, get filename using Android FS API or backend
          if (filePath.startsWith("content://")) {
            try {
              // Try Android FS API first
              fileName = await AndroidFs.getName(filePath);
              console.log("Got filename from Android FS API:", fileName);
            } catch (e) {
              console.warn(
                "Could not get filename from Android FS API, trying backend:",
                e
              );
              // Fallback to backend
              try {
                fileName = await invoke<string>("get_file_name", {
                  filePath,
                });
                console.log("Got filename from backend:", fileName);
              } catch (backendError) {
                console.warn(
                  "Could not get filename from backend:",
                  backendError
                );
                // Use a generic name as last resort
                fileName = "file";
              }
            }
          }

          // Use a safe identifier for notifications (avoid [object Object])
          const notificationId = fileName || `file-${Date.now()}`;

          notifications.show({
            id: notificationId,
            title: `Sending ${fileName}`,
            message: "Starting...",
            loading: true,
            autoClose: false,
          });

          // On Android with content URIs, pass URI directly to Rust backend
          // The Rust backend already handles content URIs properly using Android FS API
          if (isAndroid() && filePath.startsWith("content://")) {
            try {
              console.log("Sending Android content URI to backend:", filePath);
              // Pass the content URI directly to the Rust backend
              // The backend will handle opening the file using Android FS API
              await invoke("send_file_to_peer", {
                peerIp: selectedPeer.ip,
                peerPort: selectedPeer.port,
                filePath: filePath,
              });
              console.log("File sent successfully via content URI");
            } catch (sendError) {
              console.error("Failed to send file via content URI:", sendError);
              throw new Error(`Failed to send file: ${sendError}`);
            }
          } else {
            // Desktop or regular file paths
            try {
              // Try direct path method first (Desktop optimization)
              await invoke("send_file_to_peer", {
                peerIp: selectedPeer.ip,
                peerPort: selectedPeer.port,
                filePath: filePath,
              });
            } catch (pathError) {
              // Fall back to reading file bytes
              try {
                console.log(
                  "Path method failed, trying bytes method with filename:",
                  fileName
                );
                // Try to read the file as bytes using the fs plugin
                const fileData = await readFile(filePath);

                // Send as bytes with the extracted/corrected filename
                await invoke("send_file_bytes_to_peer", {
                  peerIp: selectedPeer.ip,
                  peerPort: selectedPeer.port,
                  fileName: fileName,
                  fileData: Array.from(fileData),
                });
              } catch (readError) {
                throw new Error(
                  `Failed to send via path or bytes: ${pathError} / ${readError}`
                );
              }
            }
          }

          notifications.update({
            id: notificationId,
            title: "Sent",
            message: `Successfully sent ${fileName}`,
            color: "green",
            loading: false,
            autoClose: 2000,
          });
        } catch (e) {
          // Extract filename safely for error message (synchronous only)
          let errorFileName: string = "file";
          if (typeof filePath === "string") {
            if (filePath.startsWith("content://")) {
              // For content URIs, use a generic name or try to extract from URI
              // We can't use async operations here, so use a fallback
              const uriParts = filePath.split("/");
              const lastPart = uriParts[uriParts.length - 1] || "";
              // Remove query parameters
              const cleanPart = lastPart.split("?")[0];
              errorFileName = cleanPart || "file";
            } else {
              errorFileName = filePath.split(/[\\/]/).pop() || filePath;
            }
          }

          // Ensure we have a string, not an object
          const errorMsg =
            typeof e === "string" ? e : e?.toString() || String(e);

          notifications.show({
            title: "Error",
            message: `Failed to send ${errorFileName}: ${errorMsg}`,
            color: "red",
            autoClose: 5000,
          });
          console.error(`Failed to send ${errorFileName}:`, e);
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
        color: "green",
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
        color: "blue",
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
    if (!fileTransferRequest) return;

    try {
      await invoke("respond_to_file_transfer", {
        transferId: fileTransferRequest.transfer_id,
        accepted: true,
      });
      setTransferModalOpened(false);
      setFileTransferRequest(null);
    } catch (e) {
      notifications.show({
        title: "Error",
        message: `Failed to accept transfer: ${e}`,
        color: "red",
      });
    }
  };

  const handleRejectTransfer = async () => {
    if (!fileTransferRequest) return;

    try {
      await invoke("respond_to_file_transfer", {
        transferId: fileTransferRequest.transfer_id,
        accepted: false,
      });
      setTransferModalOpened(false);
      setFileTransferRequest(null);
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
        px={{ base: "sm", sm: "md", lg: "xl" }}
        pt={{ base: "md", sm: 0 }}
        className="animate-fade-in"
      >
        <Grid gutter={{ base: "sm", sm: "md", lg: "lg" }}>
          <Grid.Col
            span={{ base: 12, sm: 12, md: 5, lg: 4, xl: 3 }}
            className={selectedPeer ? "mobile-hide-when-selected" : ""}
          >
            <Paper
              shadow="md"
              p={{ base: "md", sm: "lg" }}
              withBorder
              h="100%"
              className="peers-panel-paper"
              style={{
                background:
                  "linear-gradient(135deg, var(--bg) 0%, var(--bg-dark) 100%)",
              }}
            >
              <Group
                justify="space-between"
                mb="lg"
                wrap="nowrap"
                className="responsive-header-group"
              >
                <Title
                  order={3}
                  className="responsive-title"
                  style={{
                    background:
                      "linear-gradient(135deg, var(--accent-primary-light), var(--accent-primary))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  Nearby Peers
                </Title>
                <Tooltip label="Refresh discovery">
                  <ActionIcon
                    variant="light"
                    color="blue"
                    onClick={handleRefreshPeers}
                    loading={refreshing}
                    size="lg"
                    className="depth-card-hover responsive-icon-button"
                  >
                    <IconRefresh size={18} className="responsive-icon" />
                  </ActionIcon>
                </Tooltip>
              </Group>

              {peers.length === 0 ? (
                <div
                  className="depth-inset responsive-empty-state"
                  style={{
                    minHeight: "min(200px, 40vh)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.75rem",
                    textAlign: "center",
                    padding: "clamp(1rem, 3vw, 2rem)",
                  }}
                >
                  <ThemeIcon
                    size={64}
                    variant="light"
                    color="gray"
                    radius="xl"
                    className="responsive-theme-icon"
                  >
                    <IconDeviceDesktop
                      size={36}
                      className="responsive-icon-large"
                    />
                  </ThemeIcon>
                  <div>
                    <Text fw={500} mb="xs" className="responsive-text-md">
                      No peers found
                    </Text>
                    <Text c="dimmed" className="responsive-text-sm">
                      Open the app on another device
                    </Text>
                  </div>
                </div>
              ) : (
                <Stack gap="sm">
                  {peers.map((peer) => (
                    <div
                      key={peer.ip + peer.port}
                      className={`depth-card-interactive ${
                        selectedPeer?.ip === peer.ip
                          ? "depth-card-selected"
                          : ""
                      }`}
                      onClick={() => setSelectedPeer(peer)}
                    >
                      <Group
                        gap="md"
                        wrap="nowrap"
                        align="flex-start"
                        className="responsive-peer-group"
                      >
                        <ThemeIcon
                          size={48}
                          variant="light"
                          color="blue"
                          radius="md"
                          className="responsive-peer-icon"
                          style={{
                            flexShrink: 0,
                            boxShadow:
                              selectedPeer?.ip === peer.ip
                                ? "var(--glow-primary)"
                                : "var(--shadow-s)",
                          }}
                        >
                          <IconDeviceDesktop size={24} />
                        </ThemeIcon>
                        <div
                          style={{ flex: 1, minWidth: 0, overflow: "hidden" }}
                        >
                          <Text
                            fw={600}
                            className="responsive-peer-name"
                            style={{
                              color:
                                selectedPeer?.ip === peer.ip
                                  ? "var(--accent-primary-light)"
                                  : "var(--text-primary)",
                              wordBreak: "break-word",
                              lineHeight: "1.3",
                            }}
                          >
                            {peer.alias}
                          </Text>
                          <Text
                            size="xs"
                            c="dimmed"
                            className="responsive-peer-ip"
                            style={{
                              fontFamily: "monospace",
                              marginTop: "0.25rem",
                            }}
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

          <Grid.Col
            span={{ base: 12, sm: 12, md: 7, lg: 8, xl: 9 }}
            className={!selectedPeer ? "mobile-hide-when-not-selected" : ""}
          >
            {selectedPeer ? (
              <Paper
                shadow="md"
                p={{ base: "md", sm: "lg" }}
                withBorder
                className="send-panel-paper"
                style={{
                  background:
                    "linear-gradient(135deg, var(--bg) 0%, var(--bg-dark) 100%)",
                }}
              >
                <Group
                  justify="space-between"
                  mb="lg"
                  wrap="nowrap"
                  align="flex-start"
                  className="responsive-header-group"
                >
                  <Group
                    gap="sm"
                    wrap="nowrap"
                    style={{ flex: 1, minWidth: 0, overflow: "hidden" }}
                  >
                    <Tooltip label="Back to peers">
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        onClick={() => setSelectedPeer(null)}
                        size="lg"
                        className="depth-card-hover mobile-back-button"
                      >
                        <IconArrowLeft size={18} />
                      </ActionIcon>
                    </Tooltip>
                    <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                      <Text size="sm" c="dimmed" tt="uppercase" fw={600} mb={4}>
                        Send to
                      </Text>
                      <Title
                        order={3}
                        className="responsive-title"
                        style={{
                          background:
                            "linear-gradient(135deg, var(--accent-primary-light), var(--accent-primary))",
                          WebkitBackgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                          backgroundClip: "text",
                          wordBreak: "break-word",
                          lineHeight: "1.2",
                        }}
                      >
                        {selectedPeer.alias}
                      </Title>
                    </div>
                  </Group>
                  <Tooltip label="Close">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => setSelectedPeer(null)}
                      size="lg"
                      className="depth-card-hover mobile-hide-close-button"
                    >
                      <IconX size={18} />
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

                  <Tabs.Panel value="files">
                    <div
                      className="depth-inset upload-area"
                      onClick={handleSelectFiles}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "1rem",
                        padding: "clamp(1rem, 3vw, 2rem)",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "scale(1.01)";
                        e.currentTarget.style.boxShadow =
                          "var(--shadow-l), var(--glow-primary)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "scale(1)";
                        e.currentTarget.style.boxShadow = "";
                      }}
                    >
                      <div
                        className="responsive-upload-icon-container"
                        style={{
                          background:
                            "linear-gradient(135deg, var(--accent-primary-light), var(--accent-primary))",
                          borderRadius: "clamp(12px, 3vw, 20px)",
                          padding: "clamp(1rem, 3vw, 1.5rem)",
                          boxShadow: "var(--shadow-m), var(--glow-primary)",
                        }}
                      >
                        <IconUpload
                          size={48}
                          color="white"
                          stroke={2}
                          className="responsive-upload-icon"
                        />
                      </div>
                      <div
                        style={{
                          textAlign: "center",
                          maxWidth: "100%",
                          padding: "0 0.5rem",
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
                        className="premium-button responsive-button"
                        style={{
                          minWidth: "clamp(160px, 40vw, 200px)",
                          height: "clamp(48px, 10vw, 56px)",
                          fontSize: "clamp(1.1rem, 2.5vw, 1.25rem)",
                        }}
                      >
                        Select Files
                      </Button>
                    </div>
                  </Tabs.Panel>

                  <Tabs.Panel value="text">
                    <Stack gap="md" className="responsive-stack">
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
                          },
                        }}
                      />
                      <Button
                        rightSection={<IconSend size={16} />}
                        onClick={handleSendMessage}
                        loading={sending}
                        disabled={!message.trim()}
                        size="lg"
                        className="premium-button responsive-button"
                        fullWidth
                        style={{
                          height: "clamp(48px, 10vw, 56px)",
                          fontSize: "clamp(1.1rem, 2.5vw, 1.25rem)",
                        }}
                      >
                        Send Message
                      </Button>
                    </Stack>
                  </Tabs.Panel>
                </Tabs>
              </Paper>
            ) : (
              <Paper
                shadow="md"
                p={{ base: "md", sm: "xl" }}
                withBorder
                h="100%"
                className="depth-inset empty-state-panel"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "1rem",
                }}
              >
                <ThemeIcon
                  size={80}
                  variant="light"
                  color="gray"
                  radius="xl"
                  className="responsive-theme-icon"
                >
                  <IconDeviceDesktop
                    size={44}
                    className="responsive-icon-large"
                  />
                </ThemeIcon>
                <div style={{ textAlign: "center", padding: "0 1rem" }}>
                  <Text fw={500} mb="xs" className="responsive-text-xl">
                    Select a peer to start sharing
                  </Text>
                  <Text c="dimmed" className="responsive-text-sm">
                    Choose a device from the nearby peers list
                  </Text>
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

      {fileTransferRequest && (
        <FileTransferConfirmModal
          opened={transferModalOpened}
          onClose={() => setTransferModalOpened(false)}
          onAccept={handleAcceptTransfer}
          onReject={handleRejectTransfer}
          fileName={fileTransferRequest.file_name}
          fileSize={fileTransferRequest.file_size}
        />
      )}
    </>
  );
}
