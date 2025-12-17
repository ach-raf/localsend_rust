import { AppShell, Burger, Group, NavLink, Text } from "@mantine/core";
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
      header={{ height: 60 }}
      navbar={{
        width: 300,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Text size="lg" fw={700}>
            {deviceName}
          </Text>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <NavLink
          label="Home"
          leftSection={<IconHome size="1rem" />}
          active={location.pathname === "/"}
          onClick={() => {
            navigate("/");
            toggle();
          }}
        />
        <NavLink
          label="Settings"
          leftSection={<IconSettings size="1rem" />}
          active={location.pathname === "/settings"}
          onClick={() => {
            navigate("/settings");
            toggle();
          }}
        />
      </AppShell.Navbar>

      <AppShell.Main>
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
