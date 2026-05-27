import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { NaiveH1 } from "../../shared/ui/naive";

interface PageHeaderProps {
  title: string;
  meta?: JSX.Element;
  actions?: JSX.Element;
  tabs?: JSX.Element;
}

/**
 * PageHeader - large title + meta line up top, action row left + tabs right.
 * Reused by Library and queue/history-style pages.
 */
export function PageHeader(props: PageHeaderProps) {
  return (
    <header class="page-header flex flex-col gap-3">
      <div class="page-header-top flex items-start justify-between gap-3 min-w-0">
        <NaiveH1 class="page-header-title m-0 min-w-0 font-display text-3xl font-800 leading-tight tracking-[-0.02em]">
          {props.title}
        </NaiveH1>
        <Show when={props.meta}>
          {(meta) => (
            <div class="page-header-meta flex flex-wrap justify-end gap-1.5 min-w-0 text-[11px] text-muted">
              {meta()}
            </div>
          )}
        </Show>
      </div>
      <Show when={props.actions || props.tabs}>
        <div class="page-header-row flex items-center justify-between gap-2.5 flex-wrap">
          <Show when={props.actions}>
            {(actions) => (
              <div class="page-header-actions flex items-center gap-2 flex-wrap">{actions()}</div>
            )}
          </Show>
          <Show when={props.tabs}>
            {(tabs) => <div class="page-header-tabs ml-auto">{tabs()}</div>}
          </Show>
        </div>
      </Show>
    </header>
  );
}
