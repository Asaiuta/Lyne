import { ErrorBoundary, type JSX } from "solid-js";

interface PanelErrorBoundaryProps {
  children: JSX.Element;
  title?: string;
  class?: string;
}

const readErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Unknown error";

export function PanelErrorBoundary(props: PanelErrorBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <section
          class={`panel-error-boundary${props.class ? ` ${props.class}` : ""}`}
          role="alert"
        >
          <div class="status-stack">
            <strong>{props.title ?? "Panel unavailable"}</strong>
            <span class="status-error">{readErrorMessage(error)}</span>
          </div>
          <button type="button" class="ghost-button" onClick={reset}>
            Retry
          </button>
        </section>
      )}
    >
      {props.children}
    </ErrorBoundary>
  );
}
