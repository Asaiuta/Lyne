import { useEffect, useRef } from "react";
import { resolveWsUrl } from "./env";
import { parseWsEvent } from "./wsTypes";
import type { WsEvent } from "./wsTypes";

export interface EngineSocketOptions {
  url?: string;
  onEvent: (event: WsEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (event: Event) => void;
  onReconnect?: (attempt: number, delayMs: number) => void;
}

export const useEngineSocket = ({
  url = resolveWsUrl(),
  onEvent,
  onOpen,
  onClose,
  onError,
  onReconnect
}: EngineSocketOptions) => {
  const eventRef = useRef(onEvent);
  const openRef = useRef(onOpen);
  const closeRef = useRef(onClose);
  const errorRef = useRef(onError);
  const reconnectRef = useRef(onReconnect);

  useEffect(() => {
    eventRef.current = onEvent;
    openRef.current = onOpen;
    closeRef.current = onClose;
    errorRef.current = onError;
    reconnectRef.current = onReconnect;
  }, [onEvent, onOpen, onClose, onError, onReconnect]);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let reconnectAttempt = 0;

    const clearRetry = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || retryTimer !== null) {
        return;
      }

      reconnectAttempt += 1;
      const delayMs = Math.min(5_000, 400 * 2 ** Math.max(0, reconnectAttempt - 1));
      reconnectRef.current?.(reconnectAttempt, delayMs);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, delayMs);
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      socket = new WebSocket(url);

      socket.addEventListener("open", () => {
        reconnectAttempt = 0;
        clearRetry();
        openRef.current?.();
      });

      socket.addEventListener("close", () => {
        if (disposed) {
          return;
        }

        closeRef.current?.();
        scheduleReconnect();
      });

      socket.addEventListener("error", (event) => {
        errorRef.current?.(event);
        if (socket?.readyState !== WebSocket.OPEN) {
          scheduleReconnect();
        }
      });

      socket.addEventListener("message", (message) => {
        if (typeof message.data !== "string") {
          return;
        }

        try {
          const raw = JSON.parse(message.data) as unknown;
          const parsed = parseWsEvent(raw);
          if (parsed) {
            eventRef.current(parsed);
          }
        } catch {
          return;
        }
      });
    };

    connect();

    return () => {
      disposed = true;
      clearRetry();
      socket?.close();
    };
  }, [url]);
};
