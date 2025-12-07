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
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

interface Peer {
  ip: string;
  port: number;
  alias: string;
  hostname: string;
}

export default function Home() {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [selectedPeer, setSelectedPeer] = useState<Peer | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
      notifications.show({
        title: `Message from ${event.payload.sender_alias}`,
        message: event.payload.content,
        color: "blue",
        autoClose: 10000,
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

    // Listen for Tauri's native file drop events
    const unlistenFileDrop = listen<string[]>(
      "tauri://drag-drop",
      async (event) => {
        const currentPeer = selectedPeerRef.current;
        if (!currentPeer) {
          notifications.show({
            title: "No Peer Selected",
            message: "Please select a peer before dropping files.",
            color: "yellow",
          });
          return;
        }

        const filePaths = event.payload;
        setSending(true);

        for (const filePath of filePaths) {
          try {
            const fileName = filePath.split(/[\\/]/).pop() || filePath;

            // Try direct path method first (Desktop optimization)
            try {
              await invoke("send_file_to_peer", {
                peerIp: currentPeer.ip,
                peerPort: currentPeer.port,
                filePath: filePath,
              });
            } catch (pathError) {
              // Fall back to reading file bytes (for mobile/content URIs)
              try {
                const fileData = await readFile(filePath);

                await invoke("send_file_bytes_to_peer", {
                  peerIp: currentPeer.ip,
                  peerPort: currentPeer.port,
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
        setSending(false);
      }
    );

    return () => {
      unlistenPeers.then((f) => f());
      unlistenFileStart.then((f) => f());
      unlistenFileComplete.then((f) => f());
      unlistenMessage.then((f) => f());
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

  return (
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
              <Title order={3} mb="md">
                Send to {selectedPeer.alias}
              </Title>
              <Tabs defaultValue="files">
                <Tabs.List mb="md">
                  <Tabs.Tab value="files" leftSection={<IconFile size={14} />}>
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
                      <Text size="xl">Send files to {selectedPeer.alias}</Text>
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
  );
}
