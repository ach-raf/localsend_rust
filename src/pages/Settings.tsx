import { useState, useEffect, useMemo } from "react";
import {
  Container,
  TextInput,
  NumberInput,
  Button,
  Switch,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { notifications } from "../lib/notifications";
import { detectAndroid } from "../lib/platform";
import { invoke } from "@tauri-apps/api/core";
import {
  IconDice,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";

interface AppConfig {
  alias: string;
  port: number;
  receiving_enabled: boolean;
  download_dir: string | null;
}

export default function Settings() {
  const [config, setConfig] = useState<AppConfig>({
    alias: "",
    port: 3030,
    receiving_enabled: true,
    download_dir: null,
  });
  const [loading, setLoading] = useState(false);
  const androidEnabled = useMemo(detectAndroid, []);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await invoke<AppConfig>("get_settings");
      setConfig(settings);
    } catch (e) {
      console.error(e);
      notifications.show({
        title: "Error",
        message: "Failed to load settings",
        color: "red",
      });
    }
  };

  const handleRandomize = async () => {
    try {
      const newName = await invoke<string>("generate_random_name");
      setConfig((prev) => ({ ...prev, alias: newName }));
      notifications.show({
        title: "Name Generated",
        message: `New name: ${newName}`,
        color: "phosphor",
      });
    } catch (e) {
      console.error(e);
      notifications.show({
        title: "Error",
        message: "Failed to generate random name: " + String(e),
        color: "red",
      });
    }
  };

  const aliasError =
    config.alias.trim().length === 0
      ? "Give this device a name"
      : config.alias.trim().length > 32
        ? "32 characters or fewer"
        : null;

  const handleBrowseFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string" && selected.trim()) {
        setConfig((prev) => ({ ...prev, download_dir: selected }));
      }
    } catch (e) {
      console.error(e);
      notifications.show({
        title: "Error",
        message: `Failed to open folder picker: ${String(e)}`,
        color: "red",
      });
    }
  };

  const handleSave = async () => {
    if (aliasError) return;
    setLoading(true);
    try {
      await invoke("save_settings", { newConfig: config });
      notifications.show({
        title: "Saved",
        message: "Settings saved successfully",
        color: "phosphor",
      });
    } catch (e) {
      console.error(e);
      notifications.show({
        title: "Error",
        message: "Failed to save settings: " + String(e),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container
      size="100%"
      px={{ base: "xs", sm: "md", lg: "xl" }}
      className="animate-[fadeIn_250ms_ease-out]"
    >
      <div className="settings-panel depth-panel max-w-[640px] mx-auto">
        <div className="settings-top">
          <h1 className="settings-title">Settings</h1>
        </div>

        {/* Ledger — four flat hairline rows; labels stay small, the
           values own the full row width so nothing truncates at 375px */}
        <div className="settings-ledger">
          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-row-label">Device name</div>
              <div className="settings-hint">What nearby devices see</div>
            </div>
            <div className="settings-value-zone">
              <TextInput
                variant="unstyled"
                value={config.alias}
                onChange={(event) =>
                  setConfig({ ...config, alias: event.currentTarget.value })
                }
                maxLength={40}
                error={aliasError}
                classNames={{
                  root: "settings-name-field",
                  input: "settings-name-input",
                }}
                aria-label="Device name"
              />
              <Tooltip label="Generate random name">
                <ActionIcon
                  variant="light"
                  color="phosphor"
                  onClick={handleRandomize}
                  size="sm"
                  aria-label="Generate random name"
                >
                  <IconDice size={16} stroke={2} />
                </ActionIcon>
              </Tooltip>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-row-label">Port</div>
              <div className="settings-hint">Needs an app restart</div>
            </div>
            <div className="settings-value-zone">
              <NumberInput
                variant="unstyled"
                value={config.port}
                onChange={(val) => setConfig({ ...config, port: Number(val) })}
                allowNegative={false}
                min={1024}
                max={65535}
                clampBehavior="strict"
                hideControls
                classNames={{ input: "settings-port-input" }}
                aria-label="Port"
              />
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-main">
              <div className="settings-row-label">Receive from others</div>
              <div className="settings-hint">
                {config.receiving_enabled
                  ? "Every file still needs your OK"
                  : "Paused — you stay visible, nothing gets in"}
              </div>
            </div>
            <div className="settings-value-zone">
              <Switch
                size="lg"
                checked={config.receiving_enabled}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    receiving_enabled: event.currentTarget.checked,
                  })
                }
                aria-label="Receive from others"
              />
            </div>
          </div>

          {/* Storage — desktop only; Android saves through MediaStore */}
          {!androidEnabled && (
            <div className="settings-row settings-row-storage">
              <div className="settings-row-line">
                <div className="settings-row-main">
                  <div className="settings-row-label">Save files to</div>
                  <div className="settings-hint">Applies immediately</div>
                </div>
                <Button
                  variant="subtle"
                  color="phosphor"
                  size="compact-sm"
                  onClick={handleBrowseFolder}
                  className="settings-link-btn"
                >
                  Change
                </Button>
              </div>
              <div
                className="settings-path-line"
                title={config.download_dir ?? undefined}
                onClick={handleBrowseFolder}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleBrowseFolder();
                  }
                }}
              >
                <span
                  className={`settings-path-text${
                    config.download_dir ? "" : " default"
                  }`}
                  title={config.download_dir ?? "Default — your Downloads folder"}
                >
                  {config.download_dir ?? "Downloads — system default"}
                </span>
                {config.download_dir && (
                  <button
                    type="button"
                    className="settings-path-clear"
                    aria-label="Reset to Downloads folder"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfig((prev) => ({
                        ...prev,
                        download_dir: null,
                      }));
                    }}
                  >
                    <IconX size={14} stroke={2} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* explicit save + one honest line instead of a bullet wall */}
        <div className="settings-foot">
          <Button
            loading={loading}
            onClick={handleSave}
            disabled={!!aliasError}
            fullWidth
            className="depth-button-primary settings-save-bar"
          >
            Save
          </Button>
          <div className="settings-sec" role="note">
            <IconShieldCheck size={14} aria-hidden="true" />
            <span>
              LAN-only · every transfer needs your OK · nothing opens
              automatically
            </span>
          </div>
        </div>
      </div>
    </Container>
  );
}
