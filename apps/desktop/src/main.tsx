import { getCurrentWindow } from "@tauri-apps/api/window";

type RendererMount = (target: HTMLElement) => void;

function resolveWindowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

function renderBootstrapFailure(target: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown error";
  target.replaceChildren();
  const main = document.createElement("main");
  main.setAttribute("role", "alert");
  main.textContent = `Lyne failed to start: ${message}`;
  target.append(main);
}

async function loadRendererMount(windowLabel: string): Promise<RendererMount> {
  const runtime = await import("./shared/api/env");
  await runtime.initializeApiRuntime();

  if (windowLabel === "desktop-lyric") {
    const module = await import("./features/desktop-lyric/mountDesktopLyricWindow");
    return module.mountDesktopLyricWindow;
  }

  const [module, initialLocale] = await Promise.all([
    import("./app/mountMainWindow"),
    import("./shared/i18n/locale").then((locale) => locale.loadInitialLocale())
  ]);
  return (target) => module.mountMainWindow(target, initialLocale);
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

void loadRendererMount(resolveWindowLabel())
  .then((mount) => mount(root))
  .catch((error: unknown) => renderBootstrapFailure(root, error));
