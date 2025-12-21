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
              color: "var(--text-primary)",
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
      }}
      styles={{
        header: {
          background: "linear-gradient(to bottom, var(--bg-light), var(--bg))",
          borderBottom: "1px solid var(--border-subtle)",
          padding: "1.5rem",
          boxShadow: "inset 0 1px 2px oklch(0.4 0 0 / 0.15)",
        },
        content: {
          backgroundColor: "var(--bg-light)",
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
                fontFamily: "'Fira Code', 'Consolas', monospace",
                fontSize: "1.1rem",
                lineHeight: "1.6",
                background: "var(--bg)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "8px",
                cursor: "text",
                userSelect: "text",
                padding: "1rem",
                boxShadow: "var(--shadow-inset)",
                "&:focus": {
                  borderColor: "var(--accent-primary)",
                  boxShadow: "var(--shadow-inset), 0 0 0 2px oklch(0.65 0.2 250 / 0.2)",
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
                className="depth-button-primary"
                style={{
                  background: copied
                    ? "linear-gradient(to bottom, oklch(0.7 0.18 145), var(--accent-success))"
                    : "linear-gradient(to bottom, var(--accent-primary-light), var(--accent-primary))",
                  border: "1px solid",
                  borderColor: copied
                    ? "oklch(0.6 0.18 145)"
                    : "var(--accent-primary-dark)",
                  height: "54px",
                  fontSize: "1.15rem",
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
              className="depth-button-primary"
              style={{
                background: "linear-gradient(to bottom, oklch(0.7 0.18 145), var(--accent-success))",
                border: "1px solid oklch(0.6 0.18 145)",
                height: "54px",
                fontSize: "1.15rem",
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
              Open URL
            </Button>
          )}
          <Button
            variant="light"
            onClick={onClose}
            size="lg"
            fullWidth
            className="depth-button-secondary"
            style={{
              background: "linear-gradient(to bottom, var(--bg-lighter), var(--bg-light))",
              border: "1px solid var(--border-subtle)",
              height: "54px",
              fontSize: "1.15rem",
              boxShadow: "var(--shadow-s)",
              transition: "var(--transition-normal)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "var(--shadow-m)";
              e.currentTarget.style.background = "linear-gradient(to bottom, var(--bg-lighter), var(--bg-lighter))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "var(--shadow-s)";
              e.currentTarget.style.background = "linear-gradient(to bottom, var(--bg-lighter), var(--bg-light))";
            }}
          >
            Close
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}
