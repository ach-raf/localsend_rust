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
          <Text size="sm" c="dimmed" tt="uppercase" fw={600}>
            Received Message
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
            From {senderAlias}
          </Text>
        </div>
      }
      centered
      size="lg"
      radius="lg"
      overlayProps={{
        backgroundOpacity: 0.7,
        blur: 8,
      }}
      styles={{
        header: {
          background: "linear-gradient(to bottom, var(--bg-light), var(--bg))",
          borderBottom: "1px solid var(--border-subtle)",
          padding: "1.5rem",
        },
        content: {
          backgroundColor: "var(--bg)",
          border: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-l)",
        },
        body: {
          padding: "1.5rem",
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
                fontFamily: "'Fira Code', 'Consolas', monospace",
                fontSize: "1.1rem",
                lineHeight: "1.6",
                backgroundColor: "var(--bg-dark)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "8px",
                cursor: "text",
                userSelect: "text",
                boxShadow: "var(--shadow-inset)",
                padding: "1rem",
                "&:focus": {
                  borderColor: "var(--accent-primary)",
                  boxShadow:
                    "var(--shadow-s), 0 0 0 3px oklch(0.65 0.20 250 / 0.15)",
                },
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
                style={{
                  background: copied
                    ? "linear-gradient(to bottom, var(--accent-success), oklch(0.55 0.18 145))"
                    : "linear-gradient(to bottom, var(--accent-primary-light), var(--accent-primary))",
                  border: "1px solid",
                  borderColor: copied
                    ? "oklch(0.55 0.18 145)"
                    : "var(--accent-primary-dark)",
                  boxShadow: copied
                    ? "var(--shadow-s), var(--glow-success)"
                    : "var(--shadow-s), var(--glow-primary)",
                  height: "54px",
                  fontSize: "1.15rem",
                }}
              >
                {copied ? "Copied!" : "Copy Text"}
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
              style={{
                background:
                  "linear-gradient(to bottom, var(--accent-success), oklch(0.55 0.18 145))",
                border: "1px solid oklch(0.55 0.18 145)",
                boxShadow: "var(--shadow-s), var(--glow-success)",
                height: "54px",
                fontSize: "1.15rem",
              }}
            >
              Open URL
            </Button>
          )}
          <Button
            variant="light"
            onClick={onClose}
            size="lg"
            fullWidth
            style={{
              backgroundColor: "var(--bg-light)",
              border: "1px solid var(--border-subtle)",
              height: "54px",
              fontSize: "1.15rem",
            }}
          >
            Close
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}
