import { Modal, Text, Group, Button, Stack, ThemeIcon } from "@mantine/core";
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
      title="Incoming File"
      centered
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
    >
      <Stack>
        <Group>
          <ThemeIcon size={60} variant="light" color="blue">
            <IconFileDownload size={32} />
          </ThemeIcon>
          <div style={{ flex: 1 }}>
            <Text size="lg" fw={500}>
              Do you want to accept this file?
            </Text>
            <Text size="sm" c="dimmed" mt={4}>
              <Group gap={4}>
                <IconFile size={14} />
                {fileName}
              </Group>
            </Text>
            {fileSize !== undefined && (
              <Text size="xs" c="dimmed" mt={2}>
                Size: {formatFileSize(fileSize)}
              </Text>
            )}
          </div>
        </Group>

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={handleReject}>
            Reject
          </Button>
          <Button color="green" onClick={handleAccept}>
            Accept
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
