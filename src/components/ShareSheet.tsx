import { Badge, Button, Group, Loader, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconFile, IconMessage2, IconX } from "@tabler/icons-react";
import type { IncomingShare } from "tauri-plugin-android-share-target-api";
import { formatFileSize } from "../lib/incomingRequests";
import { monogram } from "../lib/peerDisplay";

export interface SharePeer {
  ip: string;
  port: number;
  alias: string;
}

interface ShareSheetProps {
  share: IncomingShare;
  queuedCount: number;
  text: string | null;
  peers: SharePeer[];
  /** `ip:port` of the peer currently being sent to, if any. */
  sendingKey: string | null;
  onSend(peer: SharePeer): void;
  onCancel(): void;
}

/**
 * Full-screen "send this to…" picker shown when another app shares into Local
 * Share. One job: pick a device, one tap sends. No second confirmation step.
 */
export default function ShareSheet({
  share,
  queuedCount,
  text,
  peers,
  sendingKey,
  onSend,
  onCancel,
}: ShareSheetProps) {
  const sending = sendingKey !== null;
  const fileCount = share.files.length;
  const firstFile = share.files[0];
  const totalSize = share.files.reduce((sum, f) => sum + (f.size ?? 0), 0);

  const title =
    fileCount === 1
      ? firstFile.displayName || "1 file"
      : fileCount > 1
        ? `${fileCount} files`
        : "Text";

  return (
    <div className="share-sheet">
      <Group justify="space-between" wrap="nowrap" mb="md">
        <Title order={3} className="text-text-primary">
          Send to…
        </Title>
        <Button
          variant="subtle"
          color="gray"
          size="compact-md"
          leftSection={<IconX size={16} />}
          onClick={onCancel}
          disabled={sending}
        >
          Cancel
        </Button>
      </Group>

      <div className="share-sheet-summary depth-inset">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" color="phosphor" size="lg">
            {fileCount > 0 ? <IconFile size={20} /> : <IconMessage2 size={20} />}
          </ThemeIcon>
          <div className="min-w-0 flex-1">
            <Text fw={600} truncate className="text-text-primary">
              {title}
            </Text>
            <Text size="xs" c="dimmed">
              {fileCount > 1 && totalSize > 0
                ? `${formatFileSize(totalSize)}`
                : null}
              {fileCount === 1 && firstFile.size != null
                ? formatFileSize(firstFile.size)
                : null}
              {fileCount > 0 && text ? " · with text" : null}
              {fileCount === 0 && text
                ? `${text.length} character${text.length === 1 ? "" : "s"}`
                : null}
            </Text>
          </div>
          {queuedCount > 1 ? (
            <Badge color="phosphor" variant="light" size="sm">
              +{queuedCount - 1} more
            </Badge>
          ) : null}
        </Group>
        {text ? (
          <Text size="sm" c="dimmed" lineClamp={3} mt="xs" className="share-sheet-text">
            {text}
          </Text>
        ) : null}
      </div>

      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mt="lg" mb="xs">
        Tap a device to send
      </Text>

      {peers.length === 0 ? (
        <div className="share-sheet-searching">
          <Loader size="sm" color="phosphor" />
          <Text size="sm" c="dimmed">
            Looking for devices on your network…
          </Text>
          <Text size="xs" c="dimmed">
            Make sure Local Share is open on the other device and both are on
            the same Wi-Fi.
          </Text>
        </div>
      ) : (
        <Stack gap="sm">
          {peers.map((peer) => {
            const key = `${peer.ip}:${peer.port}`;
            const isThis = sendingKey === key;
            return (
              <button
                key={key}
                type="button"
                className={`peer-card share-sheet-peer ${isThis ? "selected" : ""}`}
                disabled={sending}
                onClick={() => onSend(peer)}
              >
                <div className="peer-avatar" aria-hidden="true">
                  <span>{monogram(peer.alias)}</span>
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <Text fw={600} truncate className="text-text-primary">
                    {peer.alias}
                  </Text>
                  <Text size="xs" c="dimmed" className="t-mono">
                    {peer.ip}
                  </Text>
                </div>
                {isThis ? (
                  <Group gap={6} wrap="nowrap">
                    <Loader size="xs" color="phosphor" />
                    <Text size="xs" c="dimmed">
                      Sending…
                    </Text>
                  </Group>
                ) : null}
              </button>
            );
          })}
        </Stack>
      )}
    </div>
  );
}
