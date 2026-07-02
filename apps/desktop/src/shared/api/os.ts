import { invoke } from "@tauri-apps/api/core";

const normalizeInvokeError = (error: unknown, fallbackMessage: string): Error => {
  if (error instanceof Error) {
    return error;
  }
  const message = String(error).trim();
  return new Error(message.length > 0 ? message : fallbackMessage);
};

export const revealPathInFolder = async (sourcePath: string): Promise<void> => {
  const trimmedPath = sourcePath.trim();
  if (!trimmedPath) {
    throw new Error("Cannot reveal an empty path");
  }
  try {
    await invoke<void>("reveal_path_in_folder", { path: trimmedPath });
  } catch (error) {
    throw normalizeInvokeError(error, "Cannot reveal path in folder");
  }
};
