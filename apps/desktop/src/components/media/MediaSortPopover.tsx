import { For } from "solid-js";
import type { JSX } from "solid-js";
import { NaiveDivider, NaiveFlex, NaivePopover } from "../../shared/ui/naive";
import type { MediaSortField, MediaSortOrder, MediaSortState } from "./mediaListTypes";

interface MediaSortPopoverProps {
  open: boolean;
  trigger: JSX.Element;
  sort?: MediaSortState;
  dialogLabel: string;
  fieldLabel: string;
  orderLabel: string;
  fields: readonly MediaSortField[];
  orders: readonly MediaSortOrder[];
  sortLabel: (field: MediaSortField) => string;
  sortOrderLabel: (order: MediaSortOrder) => string;
  onOpenChange: (open: boolean) => void;
  onFieldChange: (field: MediaSortField) => void;
  onOrderChange: (order: MediaSortOrder) => void;
}

export function MediaSortPopover(props: MediaSortPopoverProps) {
  return (
    <NaivePopover
      triggerMode="click"
      open={props.open}
      onOpenChange={props.onOpenChange}
      showArrow={false}
      raw
      placement="bottom-start"
      trigger={props.trigger}
      class="media-sort-popover"
      ariaLabel={props.dialogLabel}
      role="dialog"
    >
      <div class="media-sort-popover-body">
        <NaiveFlex class="media-sort-group" vertical>
          <div class="media-sort-label">{props.fieldLabel}</div>
          <div class="media-sort-radio-group">
            <NaiveFlex class="media-sort-radio-stack" vertical>
              <For each={props.fields}>
                {(field) => (
                  <label class="media-sort-radio">
                    <input
                      type="radio"
                      name="media-sort-field"
                      checked={(props.sort?.field ?? "default") === field}
                      onChange={() => props.onFieldChange(field)}
                    />
                    <span>{props.sortLabel(field)}</span>
                  </label>
                )}
              </For>
            </NaiveFlex>
          </div>
        </NaiveFlex>
        <NaiveDivider class="media-sort-divider" vertical />
        <NaiveFlex class="media-sort-group" vertical>
          <div class="media-sort-label">{props.orderLabel}</div>
          <div class="media-sort-radio-group">
            <NaiveFlex class="media-sort-radio-stack" vertical>
              <For each={props.orders}>
                {(order) => (
                  <label class="media-sort-radio">
                    <input
                      type="radio"
                      name="media-sort-order"
                      checked={(props.sort?.order ?? "default") === order}
                      onChange={() => props.onOrderChange(order)}
                    />
                    <span>{props.sortOrderLabel(order)}</span>
                  </label>
                )}
              </For>
            </NaiveFlex>
          </div>
        </NaiveFlex>
      </div>
    </NaivePopover>
  );
}
