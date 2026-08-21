"use client";

import { useEffect, useRef } from "react";

/**
 * Thin wrapper around the browser's native `EventSource` against
 * `/api/events` (context.md §9's SSE endpoint). The native `EventSource`
 * already auto-reconnects on a dropped connection — this hook doesn't
 * fight that; it just distinguishes the FIRST successful connection from
 * every connection after it, so callers can tell "we just connected" apart
 * from "we just RE-connected after a drop".
 *
 * Why that distinction matters (architecture.md §11): SSE is a convenience
 * channel, not the source of truth. A live `onEvent` while connected is
 * applied directly (that's the whole point of realtime). A reconnect,
 * though, means some window of events may have been missed while
 * disconnected — so `onReconnect` is the caller's cue to re-fetch the
 * affected list/thread via the regular GET endpoints and reconcile, rather
 * than trusting the stream alone.
 */
export function useRealtimeEvents(onEvent: (raw: string) => void, onReconnect: () => void): void {
  const hasConnectedBefore = useRef(false);
  const onEventRef = useRef(onEvent);
  const onReconnectRef = useRef(onReconnect);

  // Keep the refs current without making them a render-time side effect —
  // React 19's compiler-oriented lint rules disallow writing to a ref
  // during render (`react-hooks/refs`); an effect (runs after commit,
  // every render since there's no dependency array) is the sanctioned way
  // to keep a ref in sync with the latest callback identity.
  useEffect(() => {
    onEventRef.current = onEvent;
    onReconnectRef.current = onReconnect;
  });

  useEffect(() => {
    hasConnectedBefore.current = false;
    const source = new EventSource("/api/events");

    source.onopen = () => {
      if (hasConnectedBefore.current) {
        onReconnectRef.current();
      }
      hasConnectedBefore.current = true;
    };

    source.onmessage = (event: MessageEvent<string>) => {
      onEventRef.current(event.data);
    };

    // onerror fires on a dropped connection; EventSource retries on its
    // own. Nothing to do here except let the next onopen decide whether
    // this was a reconnect.
    source.onerror = () => {
      /* no-op — native retry handles reconnection */
    };

    return () => {
      source.close();
    };
  }, []);
}
