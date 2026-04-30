const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = "63789";

const readEnv = (key: string): string | undefined => {
  const value = import.meta.env[key] as string | undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const trimTrailingSlash = (value: string) => value.replace(/\/$/, "");

export const resolveBaseUrl = () => {
  const direct = readEnv("VITE_AUDIO_SERVER_URL");
  if (direct) {
    return trimTrailingSlash(direct);
  }

  const host = readEnv("VITE_AUDIO_SERVER_HOST") ?? DEFAULT_HOST;
  const port = readEnv("VITE_AUDIO_SERVER_PORT") ?? DEFAULT_PORT;
  return `http://${host}:${port}`;
};

export const resolveWsUrl = () => {
  const direct = readEnv("VITE_AUDIO_SERVER_WS_URL");
  if (direct) {
    return trimTrailingSlash(direct);
  }

  const base = resolveBaseUrl();
  const wsBase = base.replace(/^http(s)?/i, (match) => (match.toLowerCase() === "https" ? "wss" : "ws"));
  return `${wsBase}/ws`;
};
