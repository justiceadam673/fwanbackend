// Data hook with live refresh: replaces most onSnapshot() calls.
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeLive } from "./api";

// const { data, loading, error, reload } = useApi(() => api.offers.list({ status: "Paid" }), [], { live: true });
export function useApi(fetcher, deps = [], { live = false, pollMs = 30000 } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const ref = useRef(fetcher); ref.current = fetcher;

  const reload = useCallback(async () => {
    try { setState((s) => ({ ...s, error: null })); const data = await ref.current(); setState({ data, loading: false, error: null }); }
    catch (error) { setState((s) => ({ ...s, loading: false, error })); }
  }, []);

  useEffect(() => { setState((s) => ({ ...s, loading: true })); reload(); }, deps); // eslint-disable-line

  useEffect(() => {
    if (!live) return;
    const unsub = subscribeLive({ onNotification: reload, onTracking: reload }); // every offer/payment change creates a notification
    const t = setInterval(reload, pollMs);                                        // safety net if the stream drops
    return () => { unsub(); clearInterval(t); };
  }, [live, pollMs, reload]);

  return { ...state, reload };
}
