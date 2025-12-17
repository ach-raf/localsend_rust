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
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
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
    // Initial fetch (if you had a command, but we rely on events mostly)
    // Listen for peer updates
    const unlistenPeers = listen<Peer[]>("peers-update", (event) => {
      setPeers(event.payload);
    });

    const unlistenFileStart = listen("file-receive-start", (event) => {
      notifications.show({
        title: "Receiving File",
        message: `Receiving ${event.payload}...`,
        loading: true,
        autoClose: false,
        id: "file-receive",
      });
    });

    const unlistenFileComplete = listen("file-receive-complete", (event) => {
      notifications.update({
        id: "file-receive",
        title: "File Received",
        message: `Successfully received ${event.payload}`,
        color: "green",
        loading: false,
        autoClose: 5000,
      });
    });

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

              const fileName = filePath.split(/[\\/]/).pop() || filePath;
              console.log(`Attempting to send file: ${fileName} (${filePath})`);

              // On desktop platforms, use direct path method
              // On mobile, would need the bytes method
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
              const fileName = filePath.split(/[\\/]/).pop() || filePath;
              console.error(`Failed to send ${fileName}:`, e);
              notifications.show({
                title: "Error",
                message: `Failed to send ${fileName}: ${e}`,
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
      // Open file dialog and get file paths
      const selected = await open({
        multiple: true,
        directory: false,
      });

      if (!selected) {
        return; // User cancelled
      }

      // Convert to array if single file selected
      const filePaths = Array.isArray(selected) ? selected : [selected];

      setSending(true);
      for (const filePath of filePaths) {
        try {
          // Extract filename from path
          const fileName = filePath.split(/[\\/]/).pop() || filePath;

          // Try direct path method first (Desktop optimization)
          try {
            await invoke("send_file_to_peer", {
              peerIp: selectedPeer.ip,
              peerPort: selectedPeer.port,
              filePath: filePath,
            });
          } catch (pathError) {
            // Fall back to reading file bytes (for mobile/content URIs)
            try {
              // Try to read the file as bytes using the fs plugin
              const fileData = await readFile(filePath);

              // Send as bytes
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

          notifications.show({
            title: "Sent",
            message: `Sent ${fileName}`,
            color: "green",
          });
        } catch (e) {
          const fileName = filePath.split(/[\\/]/).pop() || filePath;
          notifications.show({
            title: "Error",
            message: `Failed to send ${fileName}: ${e}`,
            color: "red",
          });
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
      <Container size="xl">
        <Grid>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Paper shadow="xs" p="md" withBorder h="100%">
              <Group justify="space-between" mb="md">
                <Title order={3}>Nearby Peers</Title>
                <Tooltip label="Refresh discovery">
                  <ActionIcon
                    variant="light"
                    color="blue"
                    onClick={handleRefreshPeers}
                    loading={refreshing}
                    size="lg"
                  >
                    <IconRefresh size={18} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              {peers.length === 0 ? (
                <Text c="dimmed">
                  No peers found. Open the app on another device.
                </Text>
              ) : (
                <Stack>
                  {peers.map((peer) => (
                    <Paper
                      key={peer.ip + peer.port}
                      withBorder
                      p="sm"
                      style={{
                        cursor: "pointer",
                        borderColor:
                          selectedPeer?.ip === peer.ip
                            ? "var(--mantine-color-blue-6)"
                            : undefined,
                      }}
                      onClick={() => setSelectedPeer(peer)}
                    >
                      <Group>
                        <ThemeIcon size="lg" variant="light">
                          <IconDeviceDesktop />
                        </ThemeIcon>
                        <div>
                          <Text fw={500}>{peer.alias}</Text>
                          <Text size="xs" c="dimmed">
                            {peer.ip}
                          </Text>
                        </div>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              )}
            </Paper>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 8 }}>
            {selectedPeer ? (
              <Paper shadow="xs" p="md" withBorder>
                <Group justify="space-between" mb="md">
                  <Title order={3}>Send to {selectedPeer.alias}</Title>
                  <Tooltip label="Close">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => setSelectedPeer(null)}
                      size="lg"
                    >
                      <IconX size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
                <Tabs defaultValue="files">
                  <Tabs.List mb="md">
                    <Tabs.Tab
                      value="files"
                      leftSection={<IconFile size={14} />}
                    >
                      Files
                    </Tabs.Tab>
                    <Tabs.Tab value="text" leftSection={<IconSend size={14} />}>
                      Text
                    </Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="files">
                    <Paper
                      withBorder
                      p="xl"
                      style={{
                        minHeight: 220,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "1rem",
                      }}
                    >
                      <ThemeIcon size={60} variant="light" color="blue">
                        <IconUpload size={32} />
                      </ThemeIcon>
                      <div style={{ textAlign: "center" }}>
                        <Text size="xl">
                          Send files to {selectedPeer.alias}
                        </Text>
                        <Text size="sm" c="dimmed" mt={7}>
                          Drag & drop files here or click the button below
                        </Text>
                      </div>
                      <Button
                        leftSection={<IconFile size={16} />}
                        onClick={handleSelectFiles}
                        loading={sending}
                        size="lg"
                        mt="md"
                      >
                        Select Files
                      </Button>
                    </Paper>
                  </Tabs.Panel>

                  <Tabs.Panel value="text">
                    <Stack>
                      <Textarea
                        placeholder="Type a message..."
                        minRows={4}
                        value={message}
                        onChange={(e) => setMessage(e.currentTarget.value)}
                      />
                      <Button
                        rightSection={<IconSend size={14} />}
                        onClick={handleSendMessage}
                        loading={sending}
                        disabled={!message.trim()}
                      >
                        Send Text
                      </Button>
                    </Stack>
                  </Tabs.Panel>
                </Tabs>
              </Paper>
            ) : (
              <Paper
                shadow="xs"
                p="xl"
                withBorder
                h="100%"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text c="dimmed">Select a peer to start sharing</Text>
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
