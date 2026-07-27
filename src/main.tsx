import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MantineProvider, createTheme } from "@mantine/core";
import { Toaster } from "sonner";
import AndroidNotificationBridge from "./components/AndroidNotificationBridge";
import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "sonner/dist/styles.css";
import "./App.css";

const theme = createTheme({
  // Depth System v2 — Obsidian + Phosphor · Space Grotesk + Inter + Fira Code
  fontFamily: "var(--font-body)",
  fontFamilyMonospace: "var(--font-mono)",
  headings: {
    fontFamily: "var(--font-display)",
    fontWeight: "700",
    sizes: {
      h1: { fontSize: "2.5rem", lineHeight: "1.2" },
      h2: { fontSize: "2rem", lineHeight: "1.3" },
      h3: { fontSize: "1.5rem", lineHeight: "1.4" },
      h4: { fontSize: "1.25rem", lineHeight: "1.4" },
    },
  },
  primaryColor: "phosphor",
  defaultRadius: "md",
  cursorType: "pointer",
  colors: {
    phosphor: [
      "oklch(0.95 0.05 145)",
      "oklch(0.9 0.1 145)",
      "oklch(0.86 0.12 145)",
      "oklch(0.82 0.14 145)",
      "oklch(0.8 0.15 145)",
      "oklch(0.78 0.17 145)",
      "oklch(0.7 0.17 145)",
      "oklch(0.62 0.17 145)",
      "oklch(0.55 0.16 145)",
      "oklch(0.45 0.15 145)",
    ],
  },
  spacing: {
    xs: "0.5rem",
    sm: "0.75rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
  },
  shadows: {
    xs: "var(--shadow-s)",
    sm: "var(--shadow-s)",
    md: "var(--shadow-m)",
    lg: "var(--shadow-l)",
    xl: "var(--shadow-l)",
  },
  radius: {
    xs: "4px",
    sm: "6px",
    md: "8px",
    lg: "12px",
    xl: "16px",
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Toaster
        theme="dark"
        position="top-right"
        duration={5000}
        gap={8}
        offset={12}
        mobileOffset={12}
        closeButton
        swipeDirections={["left", "right"]}
        toastOptions={{ className: "depth-toast" }}
      />
      <AndroidNotificationBridge />
      <App />
    </MantineProvider>
  </React.StrictMode>
);
