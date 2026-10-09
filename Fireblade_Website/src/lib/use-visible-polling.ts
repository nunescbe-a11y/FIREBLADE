"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const FIREBLADE_DETAIL_REFRESH_MS = 5_000;

/**
 * Fetches a protected report on mount and while its browser tab is visible.
 * Background updates never replace the table with a loading spinner.
 * An in-flight request is skipped rather than piling up requests every 5 seconds.
 * Changing filters aborts the previous response so old results cannot overwrite new ones.
 */
export function useVisiblePolling<T>(
  url: string,
  errorMessage: string,
  { enabled = true, intervalMs = FIREBLADE_DETAIL_REFRESH_MS }: {
    enabled?: boolean;
    intervalMs?: number;
  } = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const inFlight = useRef<AbortController | null>(null);

  const request = useCallback(async (showLoading = false) => {
    if (inFlight.current) {
      if (!showLoading) return; // Never overlap scheduled background requests.
      inFlight.current.abort(); // Explicit refresh or filter change supersedes it.
    }
    const controller = new AbortController();
    inFlight.current = controller;
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || errorMessage);
      if (controller.signal.aborted) return;
      setData(json as T);
      setError("");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : errorMessage);
      // Preserve the last successful data on a temporary network error.
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }, [url, errorMessage]);

  useEffect(() => {
    if (!enabled) return;
    void request(true);
    const timer = window.setInterval(() => {
      if (!document.hidden) void request();
    }, intervalMs);
    const onVisibilityChange = () => {
      if (!document.hidden) void request(); // Immediately catch up after returning.
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [enabled, intervalMs, request]);

  const refresh = useCallback(() => { void request(true); }, [request]);

  return { data, loading, error, refresh };
}
