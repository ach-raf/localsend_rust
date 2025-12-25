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
  const [deviceName, setDeviceName] = useState<string>("LocalShare Rust");

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
      header={{ height: { base: 110, sm: 70 } }}
      navbar={{
        width: 280,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding={{ base: "xs", sm: "md", md: "lg" }}
    >
      <AppShell.Header className="pt-[max(env(safe-area-inset-top,0px),8px)] pb-3 mb-4 sm:mb-0 bg-bg border-b border-border-subtle z-[200] min-h-[80px] sm:min-h-[70px]">
        <Group
          h="100%"
          px={{ base: "md", sm: "lg" }}
          py={{ base: "xs", sm: 0 }}
          justify="space-between"
          align="flex-start"
        >
          <Group gap="md" align="flex-start" wrap="nowrap">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              className="text-text-primary mt-1 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <Text
                size="sm"
                c="dimmed"
                tt="uppercase"
                fw={600}
                className="tracking-[0.5px] text-[0.9rem] leading-tight"
              >
                LocalShare
              </Text>
              <Text
                size="xl"
                fw={700}
                className="text-text-primary text-[1.35rem] leading-tight break-words"
              >
                {deviceName}
              </Text>
            </div>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className="bg-bg border-r border-border-subtle">
        <div className="h-full flex flex-col p-4 sm:p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
          <div className="mb-4 sm:mb-6">
            <Text
              size="sm"
              c="dimmed"
              tt="uppercase"
              fw={600}
              className="text-[0.95rem] px-2 mb-3"
            >
              Navigation
            </Text>
          </div>
          <Stack gap="xs" className="flex-1">
            <NavLink
              label="Home"
              leftSection={<IconHome size="1.5rem" stroke={2} />}
              active={location.pathname === "/"}
              onClick={() => {
                navigate("/");
                toggle();
              }}
              className="rounded-lg px-5 py-4 font-medium text-[1.15rem] text-text-secondary transition-all duration-fast hover:bg-bg-light hover:text-text-primary data-[active=true]:bg-bg-light data-[active=true]:text-accent-primary-light data-[active=true]:font-semibold"
            />
            <NavLink
              label="Settings"
              leftSection={<IconSettings size="1.5rem" stroke={2} />}
              active={location.pathname === "/settings"}
              onClick={() => {
                navigate("/settings");
                toggle();
              }}
              className="rounded-lg px-5 py-4 font-medium text-[1.15rem] text-text-secondary transition-all duration-fast hover:bg-bg-light hover:text-text-primary data-[active=true]:bg-bg-light data-[active=true]:text-accent-primary-light data-[active=true]:font-semibold"
            />
          </Stack>
        </div>
      </AppShell.Navbar>

      <AppShell.Main
        pb="env(safe-area-inset-bottom, 0px)"
        className="bg-bg-darkest min-h-[calc(100vh-70px)]"
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
