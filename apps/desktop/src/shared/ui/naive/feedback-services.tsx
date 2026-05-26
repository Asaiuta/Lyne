import { For, Show, createSignal, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import {
  DEFAULT_MESSAGE_DURATION_MS,
  DEFAULT_NOTIFICATION_DURATION_MS,
  LOADING_BAR_HIDE_DELAY_MS,
  createLoadingBarState,
  normalizeFeedbackDuration,
  type NaiveLoadingBarState
} from "./feedback-services-logic";
import { joinClassNames } from "./utils";

export type NaiveFeedbackTone = "success" | "warning" | "error" | "info" | "loading";
export type NaiveFeedbackContent = JSX.Element;

export interface NaiveFeedbackHandle {
  destroy: () => void;
}

export interface NaiveFeedbackOptions {
  class?: string;
  closable?: boolean;
  duration?: number;
}

export interface NaiveNotificationOptions extends NaiveFeedbackOptions {
  content?: NaiveFeedbackContent;
  title: NaiveFeedbackContent;
}

export interface NaiveDialogOptions {
  class?: string;
  closable?: boolean;
  content: NaiveFeedbackContent;
  negativeText?: NaiveFeedbackContent;
  onNegativeClick?: () => boolean | void | Promise<boolean | void>;
  onPositiveClick?: () => boolean | void | Promise<boolean | void>;
  positiveText?: NaiveFeedbackContent;
  title?: NaiveFeedbackContent;
  type?: Exclude<NaiveFeedbackTone, "loading">;
}

export interface NaiveModalOptions {
  class?: string;
  closable?: boolean;
  content: NaiveFeedbackContent;
  footer?: NaiveFeedbackContent;
  title?: NaiveFeedbackContent;
}

export interface NaiveFeedbackProviderProps {
  children: JSX.Element;
}

interface MessageRecord {
  class?: string;
  closable: boolean;
  content: NaiveFeedbackContent;
  id: number;
  tone: NaiveFeedbackTone;
}

interface NotificationRecord extends MessageRecord {
  title: NaiveFeedbackContent;
}

interface DialogRecord extends Required<Pick<NaiveDialogOptions, "closable" | "type">> {
  class?: string;
  content: NaiveFeedbackContent;
  id: number;
  negativeText?: NaiveFeedbackContent;
  onNegativeClick?: () => boolean | void | Promise<boolean | void>;
  onPositiveClick?: () => boolean | void | Promise<boolean | void>;
  positiveText?: NaiveFeedbackContent;
  title?: NaiveFeedbackContent;
}

interface ModalRecord {
  class?: string;
  closable: boolean;
  content: NaiveFeedbackContent;
  footer?: NaiveFeedbackContent;
  id: number;
  title?: NaiveFeedbackContent;
}

interface FeedbackBridge {
  addDialog: (options: NaiveDialogOptions) => NaiveFeedbackHandle;
  addMessage: (
    tone: NaiveFeedbackTone,
    content: NaiveFeedbackContent,
    options?: NaiveFeedbackOptions
  ) => NaiveFeedbackHandle;
  addModal: (options: NaiveModalOptions) => NaiveFeedbackHandle;
  addNotification: (
    tone: Exclude<NaiveFeedbackTone, "loading">,
    options: NaiveNotificationOptions
  ) => NaiveFeedbackHandle;
  clearDialogs: () => void;
  clearMessages: () => void;
  clearModals: () => void;
  clearNotifications: () => void;
  loadingBarError: () => void;
  loadingBarFinish: () => void;
  loadingBarSet: (progress: number) => void;
  loadingBarStart: () => void;
}

let activeBridge: FeedbackBridge | null = null;
let nextFeedbackId = 0;

const noopHandle: NaiveFeedbackHandle = { destroy: () => undefined };
const nextId = (): number => {
  nextFeedbackId += 1;
  return nextFeedbackId;
};

const withBridge = <T,>(fallback: T, callback: (bridge: FeedbackBridge) => T): T =>
  activeBridge ? callback(activeBridge) : fallback;

const publishMessage = (
  tone: NaiveFeedbackTone,
  content: NaiveFeedbackContent,
  options?: NaiveFeedbackOptions
): NaiveFeedbackHandle =>
  withBridge(noopHandle, (bridge) => bridge.addMessage(tone, content, options));

const publishNotification = (
  tone: Exclude<NaiveFeedbackTone, "loading">,
  options: NaiveNotificationOptions
): NaiveFeedbackHandle =>
  withBridge(noopHandle, (bridge) => bridge.addNotification(tone, options));

export const message = {
  destroyAll: (): void => withBridge(undefined, (bridge) => bridge.clearMessages()),
  error: (content: NaiveFeedbackContent, options?: NaiveFeedbackOptions): NaiveFeedbackHandle =>
    publishMessage("error", content, options),
  info: (content: NaiveFeedbackContent, options?: NaiveFeedbackOptions): NaiveFeedbackHandle =>
    publishMessage("info", content, options),
  loading: (content: NaiveFeedbackContent, options?: NaiveFeedbackOptions): NaiveFeedbackHandle =>
    publishMessage("loading", content, options),
  success: (content: NaiveFeedbackContent, options?: NaiveFeedbackOptions): NaiveFeedbackHandle =>
    publishMessage("success", content, options),
  warning: (content: NaiveFeedbackContent, options?: NaiveFeedbackOptions): NaiveFeedbackHandle =>
    publishMessage("warning", content, options)
};

export const notification = {
  destroyAll: (): void => withBridge(undefined, (bridge) => bridge.clearNotifications()),
  error: (options: NaiveNotificationOptions): NaiveFeedbackHandle =>
    publishNotification("error", options),
  info: (options: NaiveNotificationOptions): NaiveFeedbackHandle =>
    publishNotification("info", options),
  success: (options: NaiveNotificationOptions): NaiveFeedbackHandle =>
    publishNotification("success", options),
  warning: (options: NaiveNotificationOptions): NaiveFeedbackHandle =>
    publishNotification("warning", options)
};

export const dialog = {
  create: (options: NaiveDialogOptions): NaiveFeedbackHandle =>
    withBridge(noopHandle, (bridge) => bridge.addDialog(options)),
  destroyAll: (): void => withBridge(undefined, (bridge) => bridge.clearDialogs()),
  error: (options: Omit<NaiveDialogOptions, "type">): NaiveFeedbackHandle =>
    dialog.create({ ...options, type: "error" }),
  info: (options: Omit<NaiveDialogOptions, "type">): NaiveFeedbackHandle =>
    dialog.create({ ...options, type: "info" }),
  success: (options: Omit<NaiveDialogOptions, "type">): NaiveFeedbackHandle =>
    dialog.create({ ...options, type: "success" }),
  warning: (options: Omit<NaiveDialogOptions, "type">): NaiveFeedbackHandle =>
    dialog.create({ ...options, type: "warning" })
};

export const modal = {
  create: (options: NaiveModalOptions): NaiveFeedbackHandle =>
    withBridge(noopHandle, (bridge) => bridge.addModal(options)),
  destroyAll: (): void => withBridge(undefined, (bridge) => bridge.clearModals())
};

export const loadingBar = {
  error: (): void => withBridge(undefined, (bridge) => bridge.loadingBarError()),
  finish: (): void => withBridge(undefined, (bridge) => bridge.loadingBarFinish()),
  set: (progress: number): void => withBridge(undefined, (bridge) => bridge.loadingBarSet(progress)),
  start: (): void => withBridge(undefined, (bridge) => bridge.loadingBarStart())
};

export function NaiveFeedbackProvider(props: NaiveFeedbackProviderProps): JSX.Element {
  const [messages, setMessages] = createSignal<readonly MessageRecord[]>([]);
  const [notifications, setNotifications] = createSignal<readonly NotificationRecord[]>([]);
  const [dialogs, setDialogs] = createSignal<readonly DialogRecord[]>([]);
  const [modals, setModals] = createSignal<readonly ModalRecord[]>([]);
  const [loadingBarState, setLoadingBarState] = createSignal<NaiveLoadingBarState>(
    createLoadingBarState("idle")
  );
  const timers = new Map<number, number>();
  let loadingBarHideTimer: number | null = null;

  const clearTimer = (id: number): void => {
    const timer = timers.get(id);
    if (timer == null) return;
    window.clearTimeout(timer);
    timers.delete(id);
  };

  const scheduleAutoDismiss = (id: number, duration: number, remove: () => void): void => {
    if (duration === 0) return;
    const timer = window.setTimeout(remove, duration);
    timers.set(id, timer);
  };

  const removeMessage = (id: number): void => {
    clearTimer(id);
    setMessages((current) => current.filter((item) => item.id !== id));
  };

  const removeNotification = (id: number): void => {
    clearTimer(id);
    setNotifications((current) => current.filter((item) => item.id !== id));
  };

  const removeDialog = (id: number): void => {
    setDialogs((current) => current.filter((item) => item.id !== id));
  };

  const removeModal = (id: number): void => {
    setModals((current) => current.filter((item) => item.id !== id));
  };

  const scheduleLoadingBarHide = (): void => {
    if (loadingBarHideTimer != null) window.clearTimeout(loadingBarHideTimer);
    loadingBarHideTimer = window.setTimeout(() => {
      loadingBarHideTimer = null;
      setLoadingBarState(createLoadingBarState("idle"));
    }, LOADING_BAR_HIDE_DELAY_MS);
  };

  const runDialogAction = (
    id: number,
    action: (() => boolean | void | Promise<boolean | void>) | undefined
  ): void => {
    const result = action?.();
    void Promise.resolve(result).then((shouldClose) => {
      if (shouldClose !== false) removeDialog(id);
    });
  };

  const bridge: FeedbackBridge = {
    addDialog: (options) => {
      const id = nextId();
      setDialogs((current) => [
        ...current,
        {
          class: options.class,
          closable: options.closable ?? true,
          content: options.content,
          id,
          negativeText: options.negativeText,
          onNegativeClick: options.onNegativeClick,
          onPositiveClick: options.onPositiveClick,
          positiveText: options.positiveText,
          title: options.title,
          type: options.type ?? "info"
        }
      ]);
      return { destroy: () => removeDialog(id) };
    },
    addMessage: (tone, content, options) => {
      const id = nextId();
      const duration = normalizeFeedbackDuration(options?.duration, DEFAULT_MESSAGE_DURATION_MS);
      setMessages((current) => [
        ...current,
        { class: options?.class, closable: options?.closable ?? true, content, id, tone }
      ]);
      scheduleAutoDismiss(id, duration, () => removeMessage(id));
      return { destroy: () => removeMessage(id) };
    },
    addModal: (options) => {
      const id = nextId();
      setModals((current) => [
        ...current,
        {
          class: options.class,
          closable: options.closable ?? true,
          content: options.content,
          footer: options.footer,
          id,
          title: options.title
        }
      ]);
      return { destroy: () => removeModal(id) };
    },
    addNotification: (tone, options) => {
      const id = nextId();
      const duration = normalizeFeedbackDuration(
        options.duration,
        DEFAULT_NOTIFICATION_DURATION_MS
      );
      setNotifications((current) => [
        ...current,
        {
          class: options.class,
          closable: options.closable ?? true,
          content: options.content,
          id,
          title: options.title,
          tone
        }
      ]);
      scheduleAutoDismiss(id, duration, () => removeNotification(id));
      return { destroy: () => removeNotification(id) };
    },
    clearDialogs: () => setDialogs([]),
    clearMessages: () => {
      messages().forEach((item) => clearTimer(item.id));
      setMessages([]);
    },
    clearModals: () => setModals([]),
    clearNotifications: () => {
      notifications().forEach((item) => clearTimer(item.id));
      setNotifications([]);
    },
    loadingBarError: () => {
      setLoadingBarState(createLoadingBarState("error", 100));
      scheduleLoadingBarHide();
    },
    loadingBarFinish: () => {
      setLoadingBarState(createLoadingBarState("success", 100));
      scheduleLoadingBarHide();
    },
    loadingBarSet: (progress) => {
      setLoadingBarState(createLoadingBarState("loading", progress));
    },
    loadingBarStart: () => {
      if (loadingBarHideTimer != null) {
        window.clearTimeout(loadingBarHideTimer);
        loadingBarHideTimer = null;
      }
      setLoadingBarState(createLoadingBarState("loading", 18));
    }
  };

  activeBridge = bridge;

  onCleanup(() => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    if (loadingBarHideTimer != null) window.clearTimeout(loadingBarHideTimer);
    if (activeBridge === bridge) activeBridge = null;
  });

  return (
    <>
      {props.children}
      <Show when={typeof document !== "undefined"}>
        <Portal mount={document.body}>
          <Show when={loadingBarState().visible}>
            <div class="n-loading-bar-container" aria-hidden="true">
              <div
                class={joinClassNames("n-loading-bar", `n-loading-bar--${loadingBarState().status}`)}
                style={{ width: `${loadingBarState().progress}%` }}
              />
            </div>
          </Show>

          <div class="n-message-container" aria-live="polite">
            <For each={messages()}>
              {(item) => (
                <div class="n-message-wrapper">
                  <div class={joinClassNames("n-message", `n-message--${item.tone}`, item.class)}>
                    <span class="n-message__content">{item.content}</span>
                    <Show when={item.closable}>
                      <button
                        type="button"
                        class="n-feedback-close"
                        aria-label="Close message"
                        onClick={() => removeMessage(item.id)}
                      />
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>

          <div class="n-notification-container" aria-live="polite">
            <For each={notifications()}>
              {(item) => (
                <section class={joinClassNames("n-notification", `n-notification--${item.tone}`, item.class)}>
                  <div class="n-notification__main">
                    <strong class="n-notification__title">{item.title}</strong>
                    <Show when={item.content}>
                      {(content) => <div class="n-notification__content">{content()}</div>}
                    </Show>
                  </div>
                  <Show when={item.closable}>
                    <button
                      type="button"
                      class="n-feedback-close"
                      aria-label="Close notification"
                      onClick={() => removeNotification(item.id)}
                    />
                  </Show>
                </section>
              )}
            </For>
          </div>

          <For each={dialogs()}>
            {(item) => (
              <div
                class="n-dialog-mask"
                role="presentation"
                onMouseDown={(event) => {
                  if (item.closable && event.target === event.currentTarget) removeDialog(item.id);
                }}
              >
                <section
                  class={joinClassNames("n-dialog", `n-dialog--${item.type}`, item.class)}
                  role="alertdialog"
                  aria-modal="true"
                >
                  <Show when={item.title}>
                    {(title) => <strong class="n-dialog__title">{title()}</strong>}
                  </Show>
                  <div class="n-dialog__content">{item.content}</div>
                  <div class="n-dialog__action">
                    <Show when={item.negativeText}>
                      {(negativeText) => (
                        <button
                          type="button"
                          class="naive-button n-feedback-action"
                          onClick={() => runDialogAction(item.id, item.onNegativeClick)}
                        >
                          {negativeText()}
                        </button>
                      )}
                    </Show>
                    <button
                      type="button"
                      class="naive-button naive-button--primary n-feedback-action"
                      onClick={() => runDialogAction(item.id, item.onPositiveClick)}
                    >
                      {item.positiveText ?? "OK"}
                    </button>
                  </div>
                </section>
              </div>
            )}
          </For>

          <For each={modals()}>
            {(item) => (
              <div
                class="n-modal-mask"
                role="presentation"
                onMouseDown={(event) => {
                  if (item.closable && event.target === event.currentTarget) removeModal(item.id);
                }}
              >
                <section
                  class={joinClassNames("n-modal", item.class)}
                  role="dialog"
                  aria-modal="true"
                >
                  <Show when={item.title || item.closable}>
                    <header class="n-modal__header">
                      <Show when={item.title}>
                        {(title) => <strong class="n-modal__title">{title()}</strong>}
                      </Show>
                      <Show when={item.closable}>
                        <button
                          type="button"
                          class="n-feedback-close"
                          aria-label="Close modal"
                          onClick={() => removeModal(item.id)}
                        />
                      </Show>
                    </header>
                  </Show>
                  <div class="n-modal__content">{item.content}</div>
                  <Show when={item.footer}>
                    {(footer) => <footer class="n-modal__footer">{footer()}</footer>}
                  </Show>
                </section>
              </div>
            )}
          </For>
        </Portal>
      </Show>
    </>
  );
}

export const MessageProvider = NaiveFeedbackProvider;
export const NotificationProvider = NaiveFeedbackProvider;
export const DialogProvider = NaiveFeedbackProvider;
export const ModalProvider = NaiveFeedbackProvider;
export const LoadingBarProvider = NaiveFeedbackProvider;
