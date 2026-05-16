export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

export const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isInteger = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value);

export const isString = (value: unknown): value is string => typeof value === "string";

export const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);

export const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isNumber(value);

export const isNullableInteger = (value: unknown): value is number | null =>
  value === null || isInteger(value);

export const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isString);
};

export const parseStatus = (value: unknown): "success" | "error" => {
  if (value === "success" || value === "error") {
    return value;
  }
  throw new Error("Invalid NCM response status");
};

export const parseStatusMessage = (value: unknown) => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM response shape");
  }

  return {
    status: parseStatus(value.status),
    message: typeof value.message === "string" ? value.message : null
  };
};

export const parseArray = <T>(
  value: unknown,
  parse: (item: unknown) => T | null,
  errorMessage: string
): T[] => {
  if (!Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  const parsed = value.map(parse);
  if (parsed.some((item) => item === null)) {
    throw new Error(errorMessage);
  }
  return parsed as T[];
};

export const parseStringItem = (value: unknown): string | null =>
  isString(value) ? value : null;
