import { For } from "solid-js";
import type { JSX } from "solid-js";
import {
  NaiveDivider,
  NaiveFlex,
  NaivePopover,
  NaiveRadio,
  NaiveRadioGroup
} from "../../shared/ui/naive";
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
          <NaiveRadioGroup
            class="media-sort-radio-group"
            name="media-sort-field"
            orientation="vertical"
            value={props.sort?.field ?? "default"}
            onUpdateValue={(value) => {
              const field = props.fields.find((candidate) => candidate === value);
              if (field !== undefined) props.onFieldChange(field);
            }}
          >
            <NaiveFlex class="media-sort-radio-stack" vertical>
              <For each={props.fields}>
                {(field) => (
                  <NaiveRadio class="media-sort-radio" value={field}>
                    {props.sortLabel(field)}
                  </NaiveRadio>
                )}
              </For>
            </NaiveFlex>
          </NaiveRadioGroup>
        </NaiveFlex>
        <NaiveDivider class="media-sort-divider" vertical />
        <NaiveFlex class="media-sort-group" vertical>
          <div class="media-sort-label">{props.orderLabel}</div>
          <NaiveRadioGroup
            class="media-sort-radio-group"
            name="media-sort-order"
            orientation="vertical"
            value={props.sort?.order ?? "default"}
            onUpdateValue={(value) => {
              const order = props.orders.find((candidate) => candidate === value);
              if (order !== undefined) props.onOrderChange(order);
            }}
          >
            <NaiveFlex class="media-sort-radio-stack" vertical>
              <For each={props.orders}>
                {(order) => (
                  <NaiveRadio class="media-sort-radio" value={order}>
                    {props.sortOrderLabel(order)}
                  </NaiveRadio>
                )}
              </For>
            </NaiveFlex>
          </NaiveRadioGroup>
        </NaiveFlex>
      </div>
    </NaivePopover>
  );
}
