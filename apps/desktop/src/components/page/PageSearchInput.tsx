import type { JSX } from "solid-js";
import { IconSearch } from "../icons";
import { NaiveInput } from "../../shared/ui/naive";
import "../../shared/styles/pages/page-search.css";

export interface PageSearchInputProps {
  readonly value: string;
  readonly placeholder: string;
  readonly onUpdateValue: (value: string) => void;
  readonly ariaLabel?: string;
  readonly class?: string;
}

const pageSearchInputClass = (className: string | undefined): string =>
  ["page-search-input", className]
    .filter((value): value is string => Boolean(value))
    .join(" ");

export function PageSearchInput(props: PageSearchInputProps): JSX.Element {
  return (
    <NaiveInput
      type="text"
      value={props.value}
      class={pageSearchInputClass(props.class)}
      placeholder={props.placeholder}
      clearable
      round
      autocomplete="off"
      inputProps={{ role: "searchbox" }}
      ariaLabel={props.ariaLabel ?? props.placeholder}
      prefix={<IconSearch />}
      onUpdateValue={props.onUpdateValue}
    />
  );
}
