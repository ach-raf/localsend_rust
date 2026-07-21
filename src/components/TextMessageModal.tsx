import {
  Modal,
  Textarea,
  Button,
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
        <div>
          <div className="t-mono text-[0.7rem] tracking-[0.1em] uppercase text-text-tertiary">
            Message received
          </div>
          <Text fw={700} size="1.5rem" className="t-display text-text-primary">
            From {senderAlias}
          </Text>
        </div>
      }
      centered
      size="lg"
      radius="lg"
      overlayProps={{ backgroundOpacity: 0.7 }}
      styles={{
        header: {
          background: "linear-gradient(to bottom, var(--bg-light), var(--bg))",
          borderBottom: "1px solid var(--border-subtle)",
          padding: "1.5rem",
          boxShadow: "inset 0 1px 2px oklch(0.6 0.02 150 / 0.15)",
        },
        content: {
          backgroundColor: "var(--bg-light)",
          backgroundImage: "var(--brushed-soft)",
          border: "1px solid var(--border-subtle)",
          boxShadow: "var(--shadow-l)",
        },
        body: {
          padding: "1.5rem",
          background: "var(--bg-light)",
        },
      }}
    >
      <Stack gap="lg">
        <div className="depth-card" style={{ padding: "1rem" }}>
          <Textarea
            value={content}
            readOnly
            autosize
            minRows={4}
            maxRows={12}
            styles={{
              input: {
                fontFamily: "var(--font-mono)",
                fontSize: "1.05rem",
                lineHeight: "1.6",
                background: "var(--bg)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "8px",
                cursor: "text",
                userSelect: "text",
                padding: "1rem",
                boxShadow: "var(--shadow-inset)",
              },
            }}
          />
        </div>

        <Stack gap="sm">
          <CopyButton value={content} timeout={2000}>
            {({ copied, copy }) => (
              <Button
                leftSection={
                  copied ? <IconCheck size={18} /> : <IconCopy size={18} />
                }
                variant="filled"
                onClick={copy}
                size="lg"
                fullWidth
                className="depth-button-primary"
              >
                {copied ? "Copied!" : "Copy text"}
              </Button>
            )}
          </CopyButton>
          {isUrl && (
            <Button
              leftSection={<IconExternalLink size={18} />}
              variant="filled"
              onClick={handleOpenUrl}
              size="lg"
              fullWidth
              className="depth-button-secondary"
            >
              Open URL
            </Button>
          )}
          <Button
            variant="light"
            onClick={onClose}
            size="lg"
            fullWidth
            className="depth-button-secondary"
          >
            Close
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}
