import { Switch as KobalteSwitch } from "@kobalte/core/switch";
import { createSignal, type JSX } from "solid-js";
import type { NaiveSwitchProps } from "./switch";
import {
  NaiveSwitchRail,
  naiveSwitchClass,
  naiveSwitchRootClass
} from "./switch";

export function NaiveSwitchKobalte(props: NaiveSwitchProps): JSX.Element {
  const [pressed, setPressed] = createSignal<boolean>(false);
  const blocked = () => props.disabled || props.loading || props.readOnly;

  const endPress = (): void => {
    setPressed(false);
  };
  const handlePointerDown = (): void => {
    if (!blocked()) setPressed(true);
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!blocked() && event.key === " ") setPressed(true);
  };
  const handleKeyUp = (): void => {
    endPress();
  };

  return (
    <KobalteSwitch
      class={naiveSwitchRootClass(props)}
      checked={props.checked}
      onChange={props.onChange}
      disabled={props.disabled}
      readOnly={props.readOnly || props.loading}
      required={props.required}
      name={props.name}
      value={props.value}
    >
      <KobalteSwitch.Input
        aria-label={props.ariaLabel}
        aria-labelledby={props.ariaLabelledBy}
        title={props.title}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={endPress}
      />
      <KobalteSwitch.Control
        class={naiveSwitchClass(props, pressed())}
        title={props.title}
        onPointerDown={handlePointerDown}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onPointerLeave={endPress}
      >
        <NaiveSwitchRail {...props} />
      </KobalteSwitch.Control>
    </KobalteSwitch>
  );
}
