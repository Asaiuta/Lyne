export const joinClassNames = (
  ...parts: ReadonlyArray<string | false | null | undefined>
): string => parts.filter(Boolean).join(" ");

export const toCssLength = (value: string | number | undefined): string | undefined => {
  if (value == null) return undefined;
  return typeof value === "number" ? `${value}px` : value;
};
