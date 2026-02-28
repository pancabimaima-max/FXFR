import type { WsEvent } from "@fxfr/contracts";

function resolveApiBase() {
  if (typeof window !== "undefined") {
    const runtimeUrl = (window as Window & { __FXFR_ENGINE_URL?: string }).__FXFR_ENGINE_URL;
    if (runtimeUrl && runtimeUrl.trim().length > 0) {
      return runtimeUrl;
    }
  }
  return import.meta.env.VITE_ENGINE_URL ?? "http://127.0.0.1:8765";
}

export type EngineEventHandlers = {
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onEvent?: (event: WsEvent) => void;
};

export function buildEngineEventsUrl(sessionToken: string): string {
  const token = String(sessionToken || "").trim();
  const apiBase = resolveApiBase();
  try {
    const base = new URL(apiBase);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = "/ws/events";
    base.search = "";
    base.searchParams.set("token", token);
    return base.toString();
  } catch {
    return `ws://127.0.0.1:8765/ws/events?token=${encodeURIComponent(token)}`;
  }
}

function isWsEvent(value: unknown): value is WsEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.schema_version === "string"
    && typeof row.timestamp_utc === "string"
    && typeof row.trace_id === "string"
    && typeof row.event_name === "string"
    && typeof row.payload === "object"
    && row.payload !== null
  );
}

export function connectEngineEvents(sessionToken: string, handlers: EngineEventHandlers): WebSocket {
  const ws = new WebSocket(buildEngineEventsUrl(sessionToken));

  ws.onopen = () => handlers.onOpen?.();
  ws.onclose = (event) => handlers.onClose?.(event);
  ws.onerror = (event) => handlers.onError?.(event);
  ws.onmessage = (event) => {
    try {
      const parsed = JSON.parse(String(event.data ?? "")) as unknown;
      if (isWsEvent(parsed)) {
        handlers.onEvent?.(parsed);
      }
    } catch {
      // Ignore malformed frames.
    }
  };

  return ws;
}
