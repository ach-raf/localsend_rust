import { AppShell, Burger, Group, NavLink, Stack } from "@mantine/core";
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

/** Local Share logotype — two nodes linked, in the phosphor gradient. */
function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      aria-hidden="true"
      style={{ flex: "none" }}
    >
      <defs>
        <linearGradient id="ls-mark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(0.88 0.13 145)" />
          <stop offset="1" stopColor="oklch(0.66 0.16 145)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="26" height="26" rx="8" fill="url(#ls-mark)" />
      <circle cx="10" cy="14" r="2.5" fill="#06120b" />
      <circle cx="18" cy="14" r="2.5" fill="#06120b" />
      <path
        d="M12.5 14h3"
        stroke="#06120b"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Layout() {
  const [opened, { toggle }] = useDisclosure();
  const navigate = useNavigate();
  const location = useLocation();
  const [deviceName, setDeviceName] = useState<string>("Local Share");
  const [port, setPort] = useState<number>(3030);

  useEffect(() => {
    invoke<AppConfig>("get_settings")
      .then((config) => {
        setDeviceName(config.alias);
        setPort(config.port);
      })
      .catch((error) => {
        console.error("Failed to fetch device name:", error);
      });

    const unlistenAlias = listen<string>("alias-changed", (event) => {
      setDeviceName(event.payload);
    });

    return () => {
      unlistenAlias.then((f) => f());
    };
  }, []);

  const navItem = (active: boolean) =>
    `rounded-lg px-4 py-2.5 font-medium text-[1.02rem] transition-all duration-fast hover:bg-bg hover:text-text-primary data-[active=true]:bg-bg-light data-[active=true]:text-accent-primary data-[active=true]:font-semibold ${
      active
        ? "bg-bg-light text-accent-primary font-semibold"
        : "text-text-secondary"
    }`;

  return (
    <AppShell
      header={{ height: { base: 64, sm: 56 } }}
      navbar={{
        width: 232,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding={{ base: "xs", sm: "md", md: "lg" }}
    >
      <AppShell.Header className="pt-[max(env(safe-area-inset-top,0px),8px)] pb-2 bg-bg-light bg-[linear-gradient(to_bottom,var(--bg-light),var(--bg))] border-b border-border-subtle z-[200]">
        <Group
          h="100%"
          px={{ base: "md", sm: "lg" }}
          justify="space-between"
          align="center"
        >
          <Group gap="sm" align="center" wrap="nowrap">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              className="text-text-primary flex-shrink-0"
            />
            <div className="wordmark">
              <Mark />
              <span className="name text-[1.02rem]">
                Local<em>Share</em>
              </span>
            </div>
          </Group>
          <div className="t-mono text-[0.72rem] text-text-tertiary hidden sm:block">
            this device <span className="text-text-secondary">{deviceName}</span>
          </div>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className="bg-bg-dark border-r border-border-subtle">
        <div className="h-full flex flex-col p-4 sm:p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
          <div className="t-mono text-[0.68rem] tracking-[0.14em] uppercase text-text-tertiary px-2 mb-2">
            Navigate
          </div>
          <Stack gap="xs" className="flex-1">
            <NavLink
              label="Home"
              leftSection={<IconHome size="1.3rem" stroke={2} />}
              active={location.pathname === "/"}
              onClick={() => {
                navigate("/");
                toggle();
              }}
              className={navItem(location.pathname === "/")}
            />
            <NavLink
              label="Settings"
              leftSection={<IconSettings size="1.3rem" stroke={2} />}
              active={location.pathname === "/settings"}
              onClick={() => {
                navigate("/settings");
                toggle();
              }}
              className={navItem(location.pathname === "/settings")}
            />
          </Stack>
          <div className="device-card mt-4">
            <div className="da">
              <Mark size={16} />
              <span className="truncate">{deviceName}</span>
            </div>
            <div className="dm">:{port}</div>
          </div>
        </div>
      </AppShell.Navbar>

      <AppShell.Main
        pb="env(safe-area-inset-bottom, 0px)"
        className="bg-bg-darkest min-h-[calc(100vh-56px)]"
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
