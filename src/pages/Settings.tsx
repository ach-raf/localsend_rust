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
        className="max-w-[800px] mx-auto rounded-xl"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "16px",
          boxShadow: "var(--shadow-m)",
          transition: "var(--transition-normal)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = "var(--shadow-l)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = "var(--shadow-m)";
        }}
      >
        {/* Header Section */}
        <div
          className="mb-8 md:mb-12"
          style={{
            paddingBottom: "1.5rem",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <Text size="sm" c="dimmed" tt="uppercase" fw={600} mb={4}>
            Configuration
          </Text>
          <Title
            order={2}
            className="responsive-title text-text-primary"
            style={{
              background:
                "linear-gradient(to bottom, var(--text-primary), var(--text-secondary))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Settings
          </Title>
        </div>

        <Stack gap="xl" className="responsive-settings-stack">
          <div
            className="responsive-settings-card rounded-xl p-6"
            style={{
              background: "var(--bg-dark)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "12px",
              boxShadow: "var(--shadow-inset)",
              transition: "var(--transition-normal)",
            }}
          >
            <Text size="md" fw={600} mb="md" c="dimmed" tt="uppercase">
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
                  color: "var(--text-primary)",
                },
                description: {
                  fontSize: "1.05rem",
                  marginTop: "0.5rem",
                  color: "var(--text-secondary)",
                },
                input: {
                  fontSize: "1.1rem",
                  background:
                    "linear-gradient(to bottom, var(--bg-lighter), var(--bg-light))",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "8px",
                  boxShadow: "var(--shadow-s)",
                  transition: "var(--transition-fast)",
                  color: "var(--text-primary)",
                },
              }}
              onFocus={(e) => {
                e.currentTarget.style.boxShadow = "var(--shadow-m)";
                e.currentTarget.style.borderColor = "var(--accent-primary)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = "var(--shadow-s)";
                e.currentTarget.style.borderColor = "var(--border-subtle)";
              }}
            />
            <Group mt="md">
              <Button
                variant="light"
                size="md"
                onClick={handleRandomize}
                leftSection={<IconDice size={20} />}
                className="depth-button-secondary w-full sm:w-auto text-sm sm:text-base font-medium"
                style={{
                  background:
                    "linear-gradient(to bottom, var(--bg-lighter), var(--bg-light))",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "8px",
                  boxShadow: "var(--shadow-s)",
                  transition: "var(--transition-normal)",
                  color: "var(--text-primary)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "var(--shadow-m)";
                  e.currentTarget.style.background =
                    "linear-gradient(to bottom, var(--bg-lighter), var(--bg-lighter))";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "var(--shadow-s)";
                  e.currentTarget.style.background =
                    "linear-gradient(to bottom, var(--bg-lighter), var(--bg-light))";
                }}
              >
                Generate Random Name
              </Button>
            </Group>
          </div>

          <div
            className="responsive-settings-card rounded-xl p-6"
            style={{
              background: "var(--bg-dark)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "12px",
              boxShadow: "var(--shadow-inset)",
              transition: "var(--transition-normal)",
            }}
          >
            <Text size="md" fw={600} mb="md" c="dimmed" tt="uppercase">
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
                  color: "var(--text-primary)",
                },
                description: {
                  fontSize: "0.875rem",
                  marginTop: "0.5rem",
                  color: "var(--accent-warning)",
                },
                input: {
                  fontSize: "1.1rem",
                  background:
                    "linear-gradient(to bottom, var(--bg-lighter), var(--bg-light))",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "8px",
                  boxShadow: "var(--shadow-s)",
                  transition: "var(--transition-fast)",
                  color: "var(--text-primary)",
                },
                control: {
                  border: "1px solid var(--border-subtle)",
                  background: "var(--bg-light)",
                  color: "var(--text-primary)",
                  boxShadow: "var(--shadow-s)",
                  transition: "var(--transition-fast)",
                },
              }}
              onFocus={(e) => {
                e.currentTarget.style.boxShadow = "var(--shadow-m)";
                e.currentTarget.style.borderColor = "var(--accent-primary)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = "var(--shadow-s)";
                e.currentTarget.style.borderColor = "var(--border-subtle)";
              }}
            />
          </div>

          <Button
            loading={loading}
            onClick={handleSave}
            className="depth-button-primary w-full mt-4 h-12 text-base md:h-14 md:text-lg font-semibold"
            style={{
              background:
                "linear-gradient(to bottom, var(--accent-primary-light), var(--accent-primary))",
              border: "1px solid var(--accent-primary-dark)",
              color: "white",
              boxShadow: "var(--shadow-m)",
              transition: "var(--transition-normal)",
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "var(--shadow-l)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "var(--shadow-m)";
            }}
            fullWidth
          >
            Save Settings
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
