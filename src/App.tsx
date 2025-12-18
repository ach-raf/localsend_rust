import { AppShell, Burger, Group, NavLink, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconHome, IconSettings } from "@tabler/icons-react";
import {
  HashRouter,
  Routes,
  Route,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Home from "./pages/Home";
import Settings from "./pages/Settings";

interface AppConfig {
  alias: string;
  port: number;
}

function Layout() {
  const [opened, { toggle }] = useDisclosure();
  const navigate = useNavigate();
  const location = useLocation();
  const [deviceName, setDeviceName] = useState<string>("LocalSend Rust");

  useEffect(() => {
    // Fetch device name from backend
    invoke<AppConfig>("get_settings")
      .then((config) => {
        setDeviceName(config.alias);
      })
      .catch((error) => {
        console.error("Failed to fetch device name:", error);
      });

    // Listen for alias changes
    const unlistenAlias = listen<string>("alias-changed", (event) => {
      console.log("Alias changed to:", event.payload);
      setDeviceName(event.payload);
    });

    return () => {
      unlistenAlias.then((f) => f());
    };
  }, []);

  return (
    <AppShell
      header={{ height: { base: 60, sm: 70 } }}
      navbar={{
        width: 280,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding={{ base: "md", sm: "md", md: "lg" }}
    >
      <AppShell.Header
        style={{
          paddingTop: "max(env(safe-area-inset-top, 0px), 8px)",
          background: "linear-gradient(to bottom, var(--bg-light), var(--bg))",
          borderBottom: "1px solid var(--border-subtle)",
          boxShadow: "var(--shadow-m)",
          backdropFilter: "blur(10px)",
        }}
      >
        <Group h="100%" px="lg" justify="space-between">
          <Group gap="md">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              style={{ color: "var(--text-primary)" }}
            />
            <div>
              <Text
                size="sm"
                c="dimmed"
                tt="uppercase"
                fw={600}
                style={{ letterSpacing: "0.5px", fontSize: "0.9rem" }}
              >
                LocalSend
              </Text>
              <Text
                size="xl"
                fw={700}
                style={{
                  background:
                    "linear-gradient(135deg, var(--accent-primary-light), var(--accent-primary))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  fontSize: "1.35rem",
                }}
              >
                {deviceName}
              </Text>
            </div>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar
        p="lg"
        pb="calc(var(--mantine-spacing-lg) + env(safe-area-inset-bottom, 0px))"
        style={{
          backgroundColor: "var(--bg)",
          borderRight: "1px solid var(--border-subtle)",
          boxShadow: "var(--shadow-s)",
        }}
      >
        <Stack gap="xs">
          <Text
            size="sm"
            c="dimmed"
            tt="uppercase"
            fw={600}
            mb="xs"
            px="sm"
            style={{ fontSize: "0.95rem" }}
          >
            Navigation
          </Text>
          <NavLink
            label="Home"
            leftSection={<IconHome size="1.5rem" stroke={2} />}
            active={location.pathname === "/"}
            onClick={() => {
              navigate("/");
              toggle();
            }}
            styles={{
              root: {
                borderRadius: "8px",
                padding: "1rem 1.25rem",
                fontWeight: 500,
                fontSize: "1.15rem",
              },
            }}
          />
          <NavLink
            label="Settings"
            leftSection={<IconSettings size="1.5rem" stroke={2} />}
            active={location.pathname === "/settings"}
            onClick={() => {
              navigate("/settings");
              toggle();
            }}
            styles={{
              root: {
                borderRadius: "8px",
                padding: "1rem 1.25rem",
                fontWeight: 500,
                fontSize: "1.15rem",
              },
            }}
          />
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main
        pb="env(safe-area-inset-bottom, 0px)"
        style={{
          backgroundColor: "var(--bg-darkest)",
          minHeight: "calc(100vh - 70px)",
        }}
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}

function App() {
  return (
    <HashRouter>
      <Layout />
    </HashRouter>
  );
}

export default App;
