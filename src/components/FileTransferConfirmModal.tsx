import { Modal, Text, Group, Button, Stack } from "@mantine/core";
import { IconFile, IconFileDownload } from "@tabler/icons-react";

interface FileTransferConfirmModalProps {
  opened: boolean;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
  files: { name: string; size?: number }[];
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
  files,
}: FileTransferConfirmModalProps) {
  const handleReject = () => {
    onReject();
    onClose();
  };

  const handleAccept = () => {
    onAccept();
    onClose();
  };

  const totalFiles = files.length;
  const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);

  return (
    <Modal
      opened={opened}
      onClose={handleReject}
      title={
        <div>
          <div className="t-mono text-[0.7rem] tracking-[0.1em] uppercase text-text-tertiary">
            Incoming transfer
          </div>
          <Text fw={700} size="1.5rem" className="t-display text-text-primary">
            {totalFiles > 1 ? `${totalFiles} files` : "File request"}
          </Text>
        </div>
      }
      centered
      radius="lg"
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
      size="md"
      overlayProps={{ backgroundOpacity: 0.75 }}
      styles={{
        header: {
          background: "linear-gradient(to bottom, var(--bg-light), var(--bg))",
          borderBottom: "1px solid var(--border-subtle)",
          padding: "clamp(1rem, 4vw, 1.5rem)",
          boxShadow: "inset 0 1px 2px oklch(0.6 0.02 150 / 0.15)",
        },
        content: {
          backgroundColor: "var(--bg-light)",
          backgroundImage: "var(--brushed-soft)",
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
              color: "var(--on-accent)",
            }}
          >
            <IconFileDownload size={48} stroke={2.5} />
          </div>
          <Text
            size="clamp(1.1rem, 4vw, 1.25rem)"
            fw={600}
            ta="center"
            className="t-display"
            style={{ lineHeight: "1.4" }}
          >
            {totalFiles > 1
              ? `Accept these ${totalFiles} files?`
              : "Accept this file?"}
          </Text>
          {totalFiles > 1 && (
            <Text size="sm" c="dimmed" className="t-mono">
              Total {formatFileSize(totalSize)}
            </Text>
          )}
        </Stack>

        <div
          style={{
            padding: "clamp(0.75rem, 3vw, 1rem)",
            backgroundColor: "var(--bg)",
            backgroundImage: "var(--brushed)",
            borderRadius: "12px",
            border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-inset)",
            maxHeight: "200px",
            overflowY: "auto",
          }}
        >
          <Stack gap="sm">
            {files.map((file, index) => (
              <Group key={index} gap="sm" align="flex-start" wrap="nowrap">
                <IconFile
                  size={20}
                  color="var(--accent-primary)"
                  style={{ flexShrink: 0, marginTop: "2px" }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    size="sm"
                    fw={600}
                    style={{
                      color: "var(--text-primary)",
                      wordBreak: "break-word",
                      overflowWrap: "break-word",
                      lineHeight: "1.4",
                    }}
                  >
                    {file.name}
                  </Text>
                  {file.size !== undefined && (
                    <Text size="xs" c="dimmed" className="t-mono">
                      {formatFileSize(file.size)}
                    </Text>
                  )}
                </div>
              </Group>
            ))}
          </Stack>
        </div>

        <Stack gap="sm">
          <Button
            onClick={handleAccept}
            size="lg"
            fullWidth
            className="depth-button-primary"
            style={{ height: "clamp(52px, 12vw, 56px)" }}
          >
            Accept transfer
          </Button>
          <Button
            variant="light"
            onClick={handleReject}
            size="lg"
            fullWidth
            className="depth-button-secondary"
            style={{ height: "clamp(48px, 11vw, 52px)" }}
          >
            Reject
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}
