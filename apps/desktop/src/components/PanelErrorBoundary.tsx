import { ErrorBoundary, type JSX } from "solid-js";
import { NaiveAlert } from "../shared/ui/naive";

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
        <section class={`panel-error-boundary${props.class ? ` ${props.class}` : ""}`}>
          <div class="status-stack">
            <NaiveAlert title={props.title ?? "Panel unavailable"} type="error">
              <span class="status-error">{readErrorMessage(error)}</span>
            </NaiveAlert>
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
