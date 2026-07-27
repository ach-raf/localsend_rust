import { invoke } from "@tauri-apps/api/core";
import {
  showViewFileAppChooser,
  type FsUri,
} from "tauri-plugin-android-fs-api";

export interface ReceivedFileRef {
  file_path?: string;
  file_uri?: string;
}

export function hasOpenableFile(file: ReceivedFileRef): boolean {
  return Boolean(file.file_uri || file.file_path);
}

export async function openReceivedFile(file: ReceivedFileRef): Promise<void> {
  if (file.file_uri) {
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
