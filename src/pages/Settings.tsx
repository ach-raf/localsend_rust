import { useState, useEffect } from "react";
import {
  Container,
  Title,
  TextInput,
  NumberInput,
  Button,
  Text,
} from "@mantine/core";
import { notifications } from "../lib/notifications";
import { invoke } from "@tauri-apps/api/core";
import { IconDice } from "@tabler/icons-react";

interface AppConfig {
  alias: string;
  port: number;
}

export default function Settings() {
  const [config, setConfig] = useState<AppConfig>({ alias: "", port: 3030 });
  const [loading, setLoading] = useState(false);

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
      setConfig({ ...config, alias: newName });
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

  const handleSave = async () => {
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
        {/* Header — tight: title + one purpose line, hairline under */}
        <header className="settings-header">
          <Title
            order={2}
            className="t-display text-text-primary text-[1.625rem] md:text-[1.875rem]"
          >
            Settings
          </Title>
          <Text className="t-mono settings-purpose">
            How this device appears and listens on the network
          </Text>
        </header>

        {/* Body — definition list of fields, hairline-separated */}
        <div className="settings-body">
          {/* Device */}
          <div className="settings-group-label">Device</div>
          <div className="settings-row">
            <div className="settings-row-label">
              <div className="settings-field-name">Alias</div>
              <div className="settings-field-desc">
                Name visible to nearby devices
              </div>
            </div>
            <div className="settings-row-control">
              <TextInput
                value={config.alias}
                onChange={(event) =>
                  setConfig({ ...config, alias: event.currentTarget.value })
                }
                size="md"
                placeholder="Your device name"
              />
              <Button
                variant="light"
                size="md"
                onClick={handleRandomize}
                leftSection={<IconDice size={18} />}
                className="depth-button-secondary settings-action"
              >
                Generate
              </Button>
            </div>
          </div>

          <div className="settings-divider" />

          {/* Network */}
          <div className="settings-group-label">Network</div>
          <div className="settings-row">
            <div className="settings-row-label">
              <div className="settings-field-name">Port</div>
              <div className="settings-field-desc settings-field-warning">
                Requires app restart to take effect
              </div>
            </div>
            <div className="settings-row-control">
              <NumberInput
                value={config.port}
                onChange={(val) => setConfig({ ...config, port: Number(val) })}
                allowNegative={false}
                min={1024}
                max={65535}
                clampBehavior="strict"
                size="md"
              />
            </div>
          </div>
        </div>

        {/* Footer — right-aligned primary action, not a full-bleed banner */}
        <footer className="settings-footer">
          <Button
            loading={loading}
            onClick={handleSave}
            className="depth-button-primary settings-save"
          >
            Save settings
          </Button>
        </footer>
      </div>
    </Container>
  );
}
