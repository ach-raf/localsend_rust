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
        color: "blue",
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
        title: "Success",
        message: "Settings saved successfully",
        color: "green",
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
    <Container size="sm">
      <Paper shadow="xs" p="xl" withBorder>
        <Title order={2} mb="lg">
          Settings
        </Title>
        <Stack>
          <div>
            <TextInput
              label="Alias"
              description="Your name visible to others"
              value={config.alias}
              onChange={(event) =>
                setConfig({ ...config, alias: event.currentTarget.value })
              }
            />
            <Group mt="xs">
              <Button
                variant="light"
                size="xs"
                onClick={handleRandomize}
                leftSection={<IconDice size={16} />}
              >
                Randomize Name
              </Button>
            </Group>
          </div>
          <NumberInput
            label="Port"
            description="Port to listen on (requires restart)"
            value={config.port}
            onChange={(val) => setConfig({ ...config, port: Number(val) })}
            allowNegative={false}
            min={1024}
            max={65535}
          />
          <Button loading={loading} onClick={handleSave}>
            Save Settings
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
