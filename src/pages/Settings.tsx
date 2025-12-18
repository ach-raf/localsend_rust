import { useState, useEffect } from "react";
import {
  Container,
  Title,
  Text,
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
    <Container
      size="100%"
      px={{ base: "sm", sm: "md", lg: "xl" }}
      className="animate-fade-in"
    >
      <Paper
        shadow="lg"
        p={{ base: "md", sm: "lg", md: "xl" }}
        withBorder
        style={{
          background:
            "linear-gradient(135deg, var(--bg) 0%, var(--bg-dark) 100%)",
          maxWidth: "800px",
          margin: "0 auto",
        }}
      >
        <div style={{ marginBottom: "clamp(1rem, 4vw, 2rem)" }}>
          <Text size="sm" c="dimmed" tt="uppercase" fw={600} mb={4}>
            Configuration
          </Text>
          <Title
            order={2}
            className="responsive-title"
            style={{
              background:
                "linear-gradient(135deg, var(--accent-primary-light), var(--accent-primary))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Settings
          </Title>
        </div>

        <Stack gap="xl" className="responsive-settings-stack">
          <div className="depth-card responsive-settings-card">
            <Text size="md" fw={600} mb="xs" c="dimmed" tt="uppercase">
              Device Identity
            </Text>
            <TextInput
              label="Alias"
              description="Your name visible to other devices on the network"
              value={config.alias}
              onChange={(event) =>
                setConfig({ ...config, alias: event.currentTarget.value })
              }
              size="md"
              styles={{
                label: {
                  fontWeight: 600,
                  fontSize: "1.15rem",
                  marginBottom: "0.5rem",
                },
                description: {
                  fontSize: "1.05rem",
                  marginTop: "0.5rem",
                },
                input: {
                  fontSize: "1.1rem",
                },
              }}
            />
            <Group mt="md">
              <Button
                variant="light"
                size="sm"
                onClick={handleRandomize}
                leftSection={<IconDice size={16} />}
                style={{
                  backgroundColor: "var(--bg-light)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                Generate Random Name
              </Button>
            </Group>
          </div>

          <div className="depth-card responsive-settings-card">
            <Text size="md" fw={600} mb="xs" c="dimmed" tt="uppercase">
              Network Configuration
            </Text>
            <NumberInput
              label="Port"
              description="Network port to listen on (requires app restart to take effect)"
              value={config.port}
              onChange={(val) => setConfig({ ...config, port: Number(val) })}
              allowNegative={false}
              min={1024}
              max={65535}
              size="md"
              styles={{
                label: {
                  fontWeight: 600,
                  fontSize: "1rem",
                  marginBottom: "0.5rem",
                },
                description: {
                  fontSize: "0.875rem",
                  marginTop: "0.5rem",
                  color: "var(--accent-warning)",
                },
              }}
            />
          </div>

          <Button
            loading={loading}
            onClick={handleSave}
            size="lg"
            className="premium-button responsive-button"
            fullWidth
            style={{
              height: "clamp(52px, 10vw, 60px)",
              fontSize: "clamp(1.15rem, 2.5vw, 1.25rem)",
              marginTop: "clamp(0.5rem, 2vw, 1rem)",
            }}
          >
            Save Settings
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
