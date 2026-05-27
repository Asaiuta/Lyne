import type { CloseAppMethod, UISettings } from "../shared/state/useUISettings";

export interface WindowCloseDecision {
  readonly action: CloseAppMethod;
  readonly remember: boolean;
}

export interface WindowCloseRuntime {
  readonly exitApp: () => Promise<void>;
  readonly hideApp: () => Promise<void>;
  readonly persistCloseChoice: (decision: WindowCloseDecision) => boolean;
  readonly promptForCloseChoice: () => Promise<WindowCloseDecision | null>;
}

export function shouldPromptForWindowClose(
  settings: Pick<UISettings, "showCloseAppTip">
): boolean {
  return settings.showCloseAppTip;
}

export function resolveWindowCloseAction(
  settings: Pick<UISettings, "closeAppMethod" | "showCloseAppTip">,
  decision: WindowCloseDecision | null
): CloseAppMethod | null {
  if (!shouldPromptForWindowClose(settings)) {
    return settings.closeAppMethod;
  }

  return decision?.action ?? null;
}

export async function applyWindowCloseAction(
  action: CloseAppMethod,
  runtime: Pick<WindowCloseRuntime, "exitApp" | "hideApp">
): Promise<void> {
  switch (action) {
    case "hide":
      await runtime.hideApp();
      return;
    case "exit":
      await runtime.exitApp();
      return;
    default: {
      const _exhaustive: never = action;
      throw new Error(`Unhandled close action: ${_exhaustive}`);
    }
  }
}

export async function requestWindowClose(
  settings: Pick<UISettings, "closeAppMethod" | "showCloseAppTip">,
  runtime: WindowCloseRuntime
): Promise<boolean> {
  const decision = shouldPromptForWindowClose(settings)
    ? await runtime.promptForCloseChoice()
    : null;
  const action = resolveWindowCloseAction(settings, decision);
  if (!action) {
    return false;
  }

  if (decision?.remember) {
    runtime.persistCloseChoice(decision);
  }

  await applyWindowCloseAction(action, runtime);
  return true;
}
