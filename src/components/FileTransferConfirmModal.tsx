import { Modal, Text, Group, Button, Stack } from "@mantine/core";
import { IconFile, IconFileDownload } from "@tabler/icons-react";

interface FileTransferConfirmModalProps {
  opened: boolean;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
  fileName: string;
  fileSize?: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

export default function FileTransferConfirmModal({
  opened,
  onClose,
  onAccept,
  onReject,
  fileName,
  fileSize,
}: FileTransferConfirmModalProps) {
  const handleReject = () => {
    onReject();
    onClose();
  };

  const handleAccept = () => {
    onAccept();
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleReject}
      title={
        <div>
          <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
            Incoming Transfer
          </Text>
          <Text
            fw={700}
            size="1.5rem"
            style={{
              background:
                "linear-gradient(135deg, var(--accent-primary-light), var(--accent-primary))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            File Request
          </Text>
        </div>
      }
      centered
      radius="lg"
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
      overlayProps={{
        backgroundOpacity: 0.75,
        blur: 10,
      }}
      styles={{
        header: {
          background: "linear-gradient(to bottom, var(--bg-light), var(--bg))",
          borderBottom: "1px solid var(--border-subtle)",
          padding: "1.5rem",
        },
        content: {
          backgroundColor: "var(--bg)",
          border: "2px solid var(--accent-primary)",
          boxShadow: "var(--shadow-l), var(--glow-primary)",
        },
        body: {
          padding: "1.5rem",
        },
      }}
    >
      <Stack gap="xl">
        <div
          className="depth-card"
          style={{
            padding: "1.5rem",
            background: "linear-gradient(135deg, var(--bg-light), var(--bg))",
          }}
        >
          <Group gap="lg" wrap="nowrap" align="flex-start">
            <div
              style={{
                background:
                  "linear-gradient(135deg, var(--accent-primary-light), var(--accent-primary))",
                borderRadius: "16px",
                padding: "1rem",
                boxShadow: "var(--shadow-m), var(--glow-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <IconFileDownload size={40} color="white" stroke={2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text size="1.25rem" fw={600} mb="xs">
                Do you want to accept this file?
              </Text>
              <div
                style={{
                  padding: "0.75rem",
                  backgroundColor: "var(--bg-dark)",
                  borderRadius: "8px",
                  border: "1px solid var(--border-subtle)",
                  marginTop: "0.5rem",
                }}
              >
                <Group gap="xs" wrap="nowrap">
                  <IconFile size={20} color="var(--accent-primary-light)" />
                  <Text
                    size="1.1rem"
                    fw={500}
                    style={{
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fileName}
                  </Text>
                </Group>
                {fileSize !== undefined && (
                  <Text
                    size="1rem"
                    c="dimmed"
                    mt="xs"
                    style={{ fontFamily: "monospace" }}
                  >
                    Size: {formatFileSize(fileSize)}
                  </Text>
                )}
              </div>
            </div>
          </Group>
        </div>

        <Stack gap="sm">
          <Button
            onClick={handleAccept}
            size="lg"
            fullWidth
            style={{
              background:
                "linear-gradient(to bottom, var(--accent-success), oklch(0.55 0.18 145))",
              border: "1px solid oklch(0.55 0.18 145)",
              boxShadow: "var(--shadow-s), var(--glow-success)",
              color: "white",
              fontWeight: 600,
              height: "56px",
              fontSize: "1.15rem",
            }}
          >
            Accept Transfer
          </Button>
          <Button
            variant="light"
            onClick={handleReject}
            size="lg"
            fullWidth
            style={{
              backgroundColor: "var(--bg-light)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
              height: "52px",
              fontSize: "1.15rem",
            }}
          >
            Reject
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}
