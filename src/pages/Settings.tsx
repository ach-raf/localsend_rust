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
      px={{ base: "xs", sm: "md", lg: "xl" }}
      className="animate-[fadeIn_250ms_ease-out]"
    >
      <Paper
        shadow="lg"
        p={{ base: "sm", sm: "lg", md: "xl" }}
        withBorder
        className="bg-gradient-to-br from-bg to-bg-dark max-w-[800px] mx-auto border-border-subtle rounded-xl shadow-depth-m transition-all duration-normal hover:-translate-y-[1px] hover:shadow-depth-l"
      >
        {/* Header Section: Added Tailwind margin-bottom (mb-8 md:mb-12) */}
        <div className="mb-8 md:mb-12">
          <Text size="sm" c="dimmed" tt="uppercase" fw={600} mb={4}>
            Configuration
          </Text>
          <Title
            order={2}
            className="responsive-title bg-gradient-to-br from-accent-primary-light to-accent-primary bg-clip-text text-transparent"
          >
            Settings
          </Title>
        </div>

        <Stack gap="xl" className="responsive-settings-stack">
          <div className="bg-bg border border-border-subtle rounded-xl p-6 shadow-depth-m transition-all duration-normal hover:-translate-y-[2px] hover:shadow-depth-l hover:border-border-strong responsive-settings-card">
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
                size="md"
                onClick={handleRandomize}
                leftSection={<IconDice size={20} />}
                className="w-full sm:w-auto text-sm sm:text-base font-medium transition-all duration-fast bg-bg-light border border-border-subtle rounded-lg shadow-depth-s hover:bg-bg-lighter hover:shadow-depth-m hover:-translate-y-[1px] active:shadow-depth-inset active:translate-y-0"
              >
                Generate Random Name
              </Button>
            </Group>
          </div>

          <div className="bg-bg border border-border-subtle rounded-xl p-6 shadow-depth-m transition-all duration-normal hover:-translate-y-[2px] hover:shadow-depth-l hover:border-border-strong responsive-settings-card">
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
            className="w-full mt-4 h-12 text-base md:h-14 md:text-lg bg-gradient-to-b from-accent-primary-light to-accent-primary border border-accent-primary-dark shadow-depth-s shadow-glow-primary text-white font-semibold transition-all duration-normal hover:-translate-y-[2px] hover:shadow-depth-m hover:shadow-glow-primary"
            fullWidth
          >
            Save Settings
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
