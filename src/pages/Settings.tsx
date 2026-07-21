import { useState, useEffect } from "react";
import {
  Container,
  Title,
  TextInput,
  NumberInput,
  Button,
  Stack,
  Paper,
  Group,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
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
      <Paper p={{ base: "sm", sm: "lg", md: "xl" }} className="depth-panel max-w-[800px] mx-auto">
        {/* Header */}
        <div
          className="mb-8 md:mb-10"
          style={{ paddingBottom: "1.5rem", borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="t-mono text-[0.7rem] tracking-[0.14em] uppercase text-text-tertiary mb-1.5">
            configuration
          </div>
          <Title order={2} className="t-display text-text-primary">
            Settings
          </Title>
        </div>

        <Stack gap="xl">
          {/* Device identity */}
          <div className="depth-inset p-6">
            <div className="t-mono text-[0.7rem] tracking-[0.12em] uppercase text-text-tertiary mb-4">
              Device identity
            </div>
            <TextInput
              label="Alias"
              description="Your name visible to other devices on the network"
              value={config.alias}
              onChange={(event) =>
                setConfig({ ...config, alias: event.currentTarget.value })
              }
              size="md"
            />
            <Group mt="md">
              <Button
                variant="light"
                size="md"
                onClick={handleRandomize}
                leftSection={<IconDice size={20} />}
                className="depth-button-secondary w-full sm:w-auto"
              >
                Generate random name
              </Button>
            </Group>
          </div>

          {/* Network */}
          <div className="depth-inset p-6">
            <div className="t-mono text-[0.7rem] tracking-[0.12em] uppercase text-text-tertiary mb-4">
              Network
            </div>
            <NumberInput
              label="Port"
              description="Network port to listen on (requires app restart to take effect)"
              value={config.port}
              onChange={(val) => setConfig({ ...config, port: Number(val) })}
              allowNegative={false}
              min={1024}
              max={65535}
              size="md"
              styles={{ description: { color: "var(--accent-warning)" } }}
            />
          </div>

          <Button
            loading={loading}
            onClick={handleSave}
            className="depth-button-primary w-full mt-2 h-12 text-base md:h-14 md:text-lg"
            fullWidth
          >
            Save settings
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
