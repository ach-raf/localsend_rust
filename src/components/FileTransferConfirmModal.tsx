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
      size="auto"
      overlayProps={{
        backgroundOpacity: 0.75,
        blur: 10,
      }}
      styles={{
        header: {
          background: "linear-gradient(to bottom, var(--bg-light), var(--bg))",
          borderBottom: "1px solid var(--border-subtle)",
          padding: "clamp(1rem, 4vw, 1.5rem)",
        },
        content: {
          backgroundColor: "var(--bg)",
          border: "2px solid var(--accent-primary)",
          boxShadow: "var(--shadow-l), var(--glow-primary)",
          maxWidth: "min(90vw, 500px)",
        },
        body: {
          padding: "clamp(1rem, 4vw, 1.5rem)",
        },
      }}
    >
      <Stack gap="xl">
        {/* Icon and question - centered on mobile */}
        <Stack gap="md" align="center">
          <div
            style={{
              background:
                "linear-gradient(135deg, var(--accent-primary-light), var(--accent-primary))",
              borderRadius: "20px",
              padding: "clamp(1.25rem, 5vw, 1.5rem)",
              boxShadow: "var(--shadow-m), var(--glow-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconFileDownload size={48} color="white" stroke={2.5} />
          </div>
          <Text
            size="clamp(1.1rem, 4vw, 1.25rem)"
            fw={600}
            ta="center"
            style={{ lineHeight: "1.4" }}
          >
            Do you want to accept this file?
          </Text>
        </Stack>

        {/* File information - prominent display */}
        <div
          style={{
            padding: "clamp(1rem, 4vw, 1.25rem)",
            backgroundColor: "var(--bg-dark)",
            borderRadius: "12px",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <Stack gap="sm">
            <Group gap="sm" align="flex-start" wrap="nowrap">
              <IconFile
                size={24}
                color="var(--accent-primary-light)"
                style={{ flexShrink: 0, marginTop: "2px" }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text
                  size="clamp(1rem, 4vw, 1.1rem)"
                  fw={600}
                  style={{
                    color: "var(--text-primary)",
                    wordBreak: "break-word",
                    overflowWrap: "break-word",
                    lineHeight: "1.5",
                  }}
                >
                  {fileName}
                </Text>
              </div>
            </Group>
            {fileSize !== undefined && (
              <Text
                size="clamp(0.9rem, 3.5vw, 1rem)"
                c="dimmed"
                style={{
                  fontFamily: "monospace",
                  marginLeft: "32px",
                }}
              >
                Size: {formatFileSize(fileSize)}
              </Text>
            )}
          </Stack>
        </div>

        {/* Action buttons */}
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
              height: "clamp(52px, 12vw, 56px)",
              fontSize: "clamp(1rem, 4vw, 1.15rem)",
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
              height: "clamp(48px, 11vw, 52px)",
              fontSize: "clamp(0.95rem, 3.5vw, 1.15rem)",
            }}
          >
            Reject
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}
