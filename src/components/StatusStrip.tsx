import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "react-router-dom";

interface Settings {
  alias: string;
  port: number;
  receiving_enabled?: boolean;
}

/**
 * One quiet line that answers "am I reachable, and who can reach me?" — the
 * thing a user should be able to see at a glance before sharing anything.
 */
export default function StatusStrip() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    invoke<Settings>("get_settings")
      .then((s) => alive && setSettings(s))
      .catch((e) => console.error("Failed to load settings:", e));
    const unlisten = listen<string>("alias-changed", (event) =>
      setSettings((s) => (s ? { ...s, alias: event.payload } : s)),
    );
    return () => {
      alive = false;
      unlisten.then((f) => f());
    };
  }, []);

  if (!settings) return null;
  const receiving = settings.receiving_enabled !== false;

  return (
    <div className={`status-strip${receiving ? "" : " is-paused"}`}>
      <span className="status-dot" aria-hidden="true" />
      <span className="status-text">
        {receiving ? (
          <>
            Visible as <b>{settings.alias}</b> · asks before saving anything
          </>
        ) : (
          <>
            Receiving is <b>off</b> · nobody can send to you
          </>
        )}
      </span>
      {!receiving && (
        <button
          type="button"
          className="status-link"
          onClick={() => navigate("/settings")}
        >
          Turn on
        </button>
      )}
    </div>
  );
}
