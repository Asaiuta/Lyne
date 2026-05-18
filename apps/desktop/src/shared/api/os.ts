import { invoke } from "@tauri-apps/api/core";

export const revealPathInFolder = async (sourcePath: string): Promise<void> => {
  const trimmedPath = sourcePath.trim();
  if (!trimmedPath) {
    throw new Error("Cannot reveal an empty path");
  }
  await invoke<void>("reveal_path_in_folder", { path: trimmedPath });
};
