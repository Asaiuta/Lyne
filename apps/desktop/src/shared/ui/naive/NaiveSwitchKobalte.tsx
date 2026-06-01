import { Switch as KobalteSwitch } from "@kobalte/core/switch";
import { createSignal, type JSX } from "solid-js";
import type { NaiveSwitchProps } from "./switch.shared";
import {
  NaiveSwitchRail,
  naiveSwitchCheckedValue,
  naiveSwitchClass,
  naiveSwitchResolvedChecked,
  naiveSwitchRootClass,
  naiveSwitchUncheckedValue
} from "./switch.shared";

export function NaiveSwitchKobalte(props: NaiveSwitchProps): JSX.Element {
  const [pressed, setPressed] = createSignal<boolean>(false);
  const [focused, setFocused] = createSignal<boolean>(false);
  const controlledChecked = (): boolean | undefined => {
    if (props.checked !== undefined) return props.checked;
    if (props.value !== undefined) return props.value === naiveSwitchCheckedValue(props);
    return undefined;
  };
  const defaultChecked = (): boolean | undefined => {
    if (props.defaultChecked !== undefined) return props.defaultChecked;
    if (props.defaultValue !== undefined) {
      return props.defaultValue === naiveSwitchCheckedValue(props);
    }
    return undefined;
  };
  const blocked = () => props.disabled || props.loading || props.readOnly;

  const endPress = (): void => {
    setPressed(false);
  };

  const emitChecked = (nextChecked: boolean): void => {
    if (blocked()) return;
    const value = nextChecked ? naiveSwitchCheckedValue(props) : naiveSwitchUncheckedValue(props);
    props["onUpdate:value"]?.(value);
    props.onUpdateValue?.(value);
    props.onChange?.(nextChecked);
  };

  const handlePointerDown = (): void => {
    if (!blocked()) setPressed(true);
  };
  const handleClick = (event: MouseEvent): void => {
    if (!blocked()) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== " ") return;
    if (blocked()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    setPressed(true);
  };
  return (
    <KobalteSwitch
      class={naiveSwitchRootClass(props)}
      id={props.id}
      checked={controlledChecked()}
      defaultChecked={defaultChecked()}
      onChange={emitChecked}
      disabled={props.disabled}
      readOnly={props.readOnly || props.loading}
      required={props.required}
      name={props.name}
      value={String(naiveSwitchCheckedValue(props))}
    >
      {(state) => {
        const checked = () => state.checked() ?? naiveSwitchResolvedChecked(props);
        const handleKeyUp = (event: KeyboardEvent): void => {
          if (event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            (event.currentTarget as HTMLInputElement).click();
          }
          endPress();
        };

        return (
          <>
            <KobalteSwitch.Input
              aria-label={props.ariaLabel}
              aria-labelledby={props.ariaLabelledBy}
              aria-describedby={props.ariaDescribedBy}
              title={props.title}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                endPress();
              }}
            />
            <KobalteSwitch.Control
              class={naiveSwitchClass(props, pressed(), checked())}
              title={props.title}
              onPointerDown={handlePointerDown}
              onPointerUp={endPress}
              onPointerCancel={endPress}
              onPointerLeave={endPress}
              onClick={handleClick}
            >
              <NaiveSwitchRail {...props} checked={checked()} focused={focused()} />
            </KobalteSwitch.Control>
          </>
        );
      }}
    </KobalteSwitch>
  );
}
