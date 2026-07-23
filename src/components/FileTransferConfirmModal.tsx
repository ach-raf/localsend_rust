import { Modal, Button } from "@mantine/core";
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
      centered
      radius="lg"
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
      size="auto"
      overlayProps={{ backgroundOpacity: 0.75 }}
      classNames={{ content: "ftc", header: "ftc-header", body: "ftc-body" }}
    >
      {/* Header — tight, hairline under. No nested padding. */}
      <header className="ftc-header-inner">
        <div className="ftc-mark">
          <IconFileDownload size={20} stroke={2.5} />
        </div>
        <div className="ftc-headline">
          <span className="t-mono ftc-kicker">Incoming transfer</span>
          <span className="t-display ftc-title">
            {totalFiles > 1
              ? `Accept ${totalFiles} files?`
              : "Accept this file?"}
          </span>
        </div>
      </header>

      {/* File list — recessed scrollable trough. No box-in-box. */}
      <div className="ftc-list" role="list">
        {files.map((file, index) => (
          <div className="ftc-file" key={index} role="listitem">
            <IconFile
              size={18}
              className="ftc-file-icon"
              style={{ color: "var(--accent-primary)" }}
            />
            <span className="ftc-file-name" title={file.name}>
              {file.name}
            </span>
            {file.size !== undefined && (
              <span className="t-mono ftc-file-size">
                {formatFileSize(file.size)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Summary + actions — one footer row, primary left / dismissive right. */}
      <footer className="ftc-actions">
        <div className="t-mono ftc-total">
          {totalFiles > 1 && (
            <>
              {totalFiles} files · {formatFileSize(totalSize)}
            </>
          )}
        </div>
        <div className="ftc-actions-buttons">
          <Button
            onClick={handleReject}
            variant="light"
            size="md"
            className="depth-button-secondary ftc-action ftc-reject"
          >
            Reject
          </Button>
          <Button
            onClick={handleAccept}
            size="md"
            className="depth-button-primary ftc-action ftc-accept"
          >
            Accept
          </Button>
        </div>
      </footer>
    </Modal>
  );
}
