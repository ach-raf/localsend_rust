import {
  Modal,
  Textarea,
  Button,
  Group,
  Stack,
  Text,
  CopyButton,
} from "@mantine/core";
import { IconCopy, IconCheck, IconExternalLink } from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notifications } from "@mantine/notifications";

interface TextMessageModalProps {
  opened: boolean;
  onClose: () => void;
  senderAlias: string;
  content: string;
}

export default function TextMessageModal({
  opened,
  onClose,
  senderAlias,
  content,
}: TextMessageModalProps) {
  // Check if content is a URL (starts with http:// or https://)
  const isUrl =
    content.trim().startsWith("http://") ||
    content.trim().startsWith("https://");

  const handleOpenUrl = async () => {
    try {
      await openUrl(content.trim());
    } catch (e) {
      notifications.show({
        title: "Error",
        message: `Failed to open URL: ${e}`,
        color: "red",
      });
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Text fw={600} size="lg">
          Message from {senderAlias}
        </Text>
      }
      centered
      size="lg"
      overlayProps={{
        backgroundOpacity: 0.55,
        blur: 3,
      }}
      styles={{
        header: {
          backgroundColor: "var(--mantine-color-dark-7)",
        },
        content: {
          backgroundColor: "var(--mantine-color-dark-7)",
        },
      }}
    >
      <Stack gap="md">
        <Textarea
          value={content}
          readOnly
          autosize
          minRows={4}
          maxRows={12}
          styles={{
            input: {
              fontFamily: "monospace",
              fontSize: "14px",
              backgroundColor: "var(--mantine-color-dark-6)",
              color: "var(--mantine-color-gray-0)",
              border: "1px solid var(--mantine-color-dark-4)",
              cursor: "text",
              userSelect: "text",
              "&:focus": {
                borderColor: "var(--mantine-color-blue-5)",
              },
            },
          }}
        />

        <Group justify="space-between" gap="sm">
          <CopyButton value={content} timeout={2000}>
            {({ copied, copy }) => (
              <Button
                leftSection={
                  copied ? <IconCheck size={16} /> : <IconCopy size={16} />
                }
                color={copied ? "teal" : "blue"}
                variant="filled"
                onClick={copy}
                fullWidth
                style={{ flex: 1 }}
              >
                {copied ? "Copied!" : "Copy Text"}
              </Button>
            )}
          </CopyButton>
          {isUrl && (
            <Button
              leftSection={<IconExternalLink size={16} />}
              variant="filled"
              color="green"
              onClick={handleOpenUrl}
              fullWidth
              style={{ flex: 1 }}
            >
              Open in Browser
            </Button>
          )}
          <Button
            variant="light"
            onClick={onClose}
            fullWidth
            style={{ flex: 1 }}
          >
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
