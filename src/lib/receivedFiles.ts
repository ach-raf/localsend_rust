import { invoke } from "@tauri-apps/api/core";
import { showViewFileAppChooser, type FsUri } from "tauri-plugin-android-fs-api";

// Injected by MainActivity (Android only): plain ACTION_VIEW -> native "Open with".
declare global {
  interface Window {
    LocalShareNative?: { openFile(uri: string): string };
  }
}

export interface ReceivedFileRef {
  file_path?: string;
  file_uri?: string;
}

export function hasOpenableFile(file: ReceivedFileRef): boolean {
  return Boolean(file.file_uri || file.file_path);
}

export async function openReceivedFile(file: ReceivedFileRef): Promise<void> {
  if (file.file_uri) {
    const native = window.LocalShareNative;
    if (native) {
      const error = native.openFile(file.file_uri);
      if (error) throw new Error(error);
      return;
    }
    // Fallback: plugin's chooser sheet.
    const uri: FsUri = {
      uri: file.file_uri,
      documentTopTreeUri: null,
    };
    await showViewFileAppChooser(uri);
    return;
  }

  if (file.file_path) {
    await invoke("open_file_location", { filePath: file.file_path });
    return;
  }

  throw new Error("No saved file reference is available");
}
