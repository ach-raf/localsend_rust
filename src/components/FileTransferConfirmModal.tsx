import { Modal, Button } from "@mantine/core";
import {
  IconAlertTriangle,
  IconFile,
  IconFileDownload,
} from "@tabler/icons-react";
import { formatFileSize, type IncomingFile } from "../lib/incomingRequests";

interface FileTransferConfirmModalProps {
  opened: boolean;
  onClose: () => void;
  onAccept: () => void;
  onReject: () => void;
  files: IncomingFile[];
  /** Self-declared by the sender (spoofable) — shown, but the IP is the proof. */
  senderAlias?: string | null;
  senderIp?: string;
  /** How many more prompts are queued behind this one. */
  waiting?: number;
  /** Visual countdown: how long the sender will wait for an answer. */
  timeoutSeconds?: number;
}

// Things that run code when opened. Not blocked — just called out.
const RISKY = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jse|jar|apk|lnk|dll|sh|appimage)$/i;

export default function FileTransferConfirmModal({
  opened,
  onClose,
  onAccept,
  onReject,
  files,
  senderAlias,
  senderIp,
  waiting = 0,
  timeoutSeconds,
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
  const risky = files.filter((f) => RISKY.test(f.name));

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
      <header className="ftc-header-inner">
        <div className="ftc-mark">
          <IconFileDownload size={20} stroke={2.5} />
        </div>
        <div className="ftc-headline">
          <span className="t-mono ftc-kicker">
            Incoming transfer
            {waiting > 0 && (
              <span className="ftc-queue"> · +{waiting} waiting</span>
            )}
          </span>
          <span className="t-display ftc-title">
            {totalFiles > 1
              ? `Accept ${totalFiles} files?`
              : "Accept this file?"}
          </span>
        </div>
      </header>

      {(senderAlias || senderIp) && (
        <div className="ftc-from">
          <span className="t-mono ftc-from-label">From</span>
          <span className="ftc-from-name" title={senderAlias ?? undefined}>
            {senderAlias ?? "Unknown device"}
          </span>
          {senderIp && <span className="t-mono ftc-from-ip">{senderIp}</span>}
        </div>
      )}

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

      {risky.length > 0 && (
        <div className="ftc-caution" role="alert">
          <IconAlertTriangle size={16} aria-hidden="true" />
          <span>
            {risky.length === 1 ? "This file" : `${risky.length} of these files`}{" "}
            can run code when opened. Accept only if you were expecting it.
          </span>
        </div>
      )}

      <footer className="ftc-actions">
        <div className="t-mono ftc-total">
          {totalFiles > 1 ? (
            <>
              {totalFiles} files · {formatFileSize(totalSize)}
            </>
          ) : (
            totalSize > 0 && formatFileSize(totalSize)
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
            data-autofocus
          >
            Accept
          </Button>
        </div>
      </footer>

      {timeoutSeconds && (
        <div className="ftc-countdown" aria-hidden="true">
          <i style={{ animationDuration: `${timeoutSeconds}s` }} />
        </div>
      )}
    </Modal>
  );
}
