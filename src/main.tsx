import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/notifications/styles.css";
import "./App.css";

const theme = createTheme({
  // Enhanced theme following depth design principles
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "'Fira Code', 'Consolas', monospace",
  headings: {
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontWeight: "700",
    sizes: {
      h1: { fontSize: "2.5rem", lineHeight: "1.2" },
      h2: { fontSize: "2rem", lineHeight: "1.3" },
      h3: { fontSize: "1.5rem", lineHeight: "1.4" },
      h4: { fontSize: "1.25rem", lineHeight: "1.4" },
    },
  },
  primaryColor: "blue",
  defaultRadius: "md",
  cursorType: "pointer",
  spacing: {
    xs: "0.5rem",
    sm: "0.75rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
  },
  shadows: {
    xs: "0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.15)",
    sm: "0 2px 4px rgba(0, 0, 0, 0.4), 0 4px 8px rgba(0, 0, 0, 0.2)",
    md: "0 2px 4px rgba(0, 0, 0, 0.6), 0 4px 12px rgba(0, 0, 0, 0.3)",
    lg: "0 4px 8px rgba(0, 0, 0, 0.7), 0 8px 24px rgba(0, 0, 0, 0.4)",
    xl: "0 8px 16px rgba(0, 0, 0, 0.8), 0 12px 32px rgba(0, 0, 0, 0.5)",
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
      <Notifications position="top-right" zIndex={1000} />
      <App />
    </MantineProvider>
  </React.StrictMode>
);
