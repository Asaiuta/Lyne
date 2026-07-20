import { createContext, useContext, type Accessor } from "solid-js";

export const NaiveSelectFocusHandoffContext = createContext<Accessor<boolean> | null>(null);

export const useNaiveSelectFocusHandoff = (): Accessor<boolean> | null =>
  useContext(NaiveSelectFocusHandoffContext);
