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
  /** Put your mantine theme override here */
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications />
      <App />
    </MantineProvider>
  </React.StrictMode>
);
