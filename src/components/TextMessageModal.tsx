import { Modal, Textarea, Button, CopyButton } from "@mantine/core";
import { IconCopy, IconCheck, IconExternalLink, IconX } from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notifications } from "../lib/notifications";

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
      centered
      size="auto"
      radius="lg"
      withCloseButton={false}
      overlayProps={{ backgroundOpacity: 0.7 }}
      classNames={{ content: "rmsg", header: "rmsg-header", body: "rmsg-body" }}
    >
      {/* Header — tight single line, hairline under. No 1.5rem padding. */}
      <header className="rmsg-header-inner">
        <div className="rmsg-meta">
          <span className="t-mono rmsg-kicker">Message received</span>
          <span className="rmsg-dot" aria-hidden="true" />
          <span className="t-mono rmsg-sender" title={senderAlias}>
            {senderAlias}
          </span>
        </div>
        <Button
          variant="subtle"
          size="compact-md"
          onClick={onClose}
          className="rmsg-close"
          aria-label="Close"
        >
          <IconX size={18} />
        </Button>
      </header>

      {/* Preview — owns the room. Grows to fill, short content doesn't waste rows. */}
      <Textarea
        value={content}
        readOnly
        autosize
        minRows={3}
        maxRows={16}
        classNames={{ input: "rmsg-preview" }}
      />

      {/* Actions — one footer row, not three full-bleed banners. */}
      <footer className="rmsg-actions">
        <div className="rmsg-actions-primary">
          {isUrl && (
            <Button
              variant="light"
              onClick={handleOpenUrl}
              size="md"
              leftSection={<IconExternalLink size={18} />}
              className="depth-button-secondary rmsg-action"
            >
              Open URL
            </Button>
          )}
          <CopyButton value={content} timeout={2000}>
            {({ copied, copy }) => (
              <Button
                leftSection={
                  copied ? <IconCheck size={18} /> : <IconCopy size={18} />
                }
                onClick={copy}
                size="md"
                className="depth-button-primary rmsg-action"
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
          </CopyButton>
        </div>
        <Button
          variant="light"
          onClick={onClose}
          size="md"
          className="depth-button-secondary rmsg-action rmsg-close-text"
        >
          Close
        </Button>
      </footer>
    </Modal>
  );
}
