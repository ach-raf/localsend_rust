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
              color: "var(--text-primary)",
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
      }}
      styles={{
        header: {
          background: "linear-gradient(to bottom, var(--bg-light), var(--bg))",
          borderBottom: "1px solid var(--border-subtle)",
          padding: "clamp(1rem, 4vw, 1.5rem)",
          boxShadow: "inset 0 1px 2px oklch(0.4 0 0 / 0.15)",
        },
        content: {
          backgroundColor: "var(--bg-light)",
          border: "1px solid var(--border-subtle)",
          maxWidth: "min(90vw, 500px)",
          boxShadow: "var(--shadow-l)",
        },
        body: {
          padding: "clamp(1rem, 4vw, 1.5rem)",
          background: "var(--bg-light)",
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
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "var(--shadow-m)",
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
            backgroundColor: "var(--bg)",
            borderRadius: "12px",
            border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-inset)",
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
            className="depth-button-primary"
            style={{
              background:
                "linear-gradient(to bottom, oklch(0.7 0.18 145), var(--accent-success))",
              border: "1px solid oklch(0.6 0.18 145)",
              color: "white",
              fontWeight: 600,
              height: "clamp(52px, 12vw, 56px)",
              fontSize: "clamp(1rem, 4vw, 1.15rem)",
              boxShadow: "var(--shadow-m)",
              transition: "var(--transition-normal)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "var(--shadow-l)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "var(--shadow-m)";
            }}
          >
            Accept Transfer
          </Button>
          <Button
            variant="light"
            onClick={handleReject}
            size="lg"
            fullWidth
            className="depth-button-secondary"
            style={{
              background:
                "linear-gradient(to bottom, var(--bg-lighter), var(--bg-light))",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
              height: "clamp(48px, 11vw, 52px)",
              fontSize: "clamp(0.95rem, 3.5vw, 1.15rem)",
              boxShadow: "var(--shadow-s)",
              transition: "var(--transition-normal)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "var(--shadow-m)";
              e.currentTarget.style.background =
                "linear-gradient(to bottom, var(--bg-lighter), var(--bg-lighter))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "var(--shadow-s)";
              e.currentTarget.style.background =
                "linear-gradient(to bottom, var(--bg-lighter), var(--bg-light))";
            }}
          >
            Reject
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}
