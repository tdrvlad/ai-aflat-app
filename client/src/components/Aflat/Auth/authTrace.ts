/**
 * An attempt-scoped trace of the sign-in handoff, readable after the fact.
 *
 * Every bug in this flow so far was found in server or proxy logs, which see
 * one line per attempt and cannot tell "our guard destroyed it" from "the page
 * reloaded" from "the effect ran twice". This is the browser's half of that
 * story: one id per sign-in attempt, every step stamped, kept in
 * `localStorage` so it **survives the reloads it exists to detect**.
 *
 * Read it with `__aflatAuthTrace()` in the console; copy it out with
 * `copy(JSON.stringify(__aflatAuthTrace(), null, 2))`.
 *
 * Nothing here records the question, the email address or any other content —
 * only event names, timings and booleans. A trace that carried the user's
 * question would be a copy of the very thing we deliberately refuse to store
 * before consent.
 */

const TRACE_KEY = 'aflat_auth_trace';
const ATTEMPT_KEY = 'aflat_auth_attempt';
/** Enough for several attempts; old entries fall off the front. */
const MAX_EVENTS = 200;

export type TraceEvent = {
  /** Milliseconds since the epoch — absolute, so two page loads can be ordered. */
  t: number;
  /** The attempt this belongs to; constant across reloads within one attempt. */
  a: string;
  e: string;
  d?: Record<string, string | number | boolean | null>;
};

const read = (): TraceEvent[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(TRACE_KEY) ?? '[]');
    return Array.isArray(raw) ? (raw as TraceEvent[]) : [];
  } catch {
    return [];
  }
};

const write = (events: TraceEvent[]) => {
  try {
    localStorage.setItem(TRACE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    /* tracing must never break the flow it is watching */
  }
};

/**
 * The current attempt id, minted on first use and kept until
 * `startAuthAttempt` replaces it. It deliberately lives in `localStorage`
 * rather than page state: a reload mid-handshake must land in the *same*
 * attempt, or the trace cannot show that the page died and came back.
 */
const attemptId = (): string => {
  try {
    const existing = localStorage.getItem(ATTEMPT_KEY);
    if (existing) {
      return existing;
    }
  } catch {
    return 'no-storage';
  }
  const fresh = `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    localStorage.setItem(ATTEMPT_KEY, fresh);
  } catch {
    /* fall through — an unstored id still labels this page's events */
  }
  return fresh;
};

export const traceAuth = (event: string, data?: TraceEvent['d']): void => {
  try {
    write([...read(), { t: Date.now(), a: attemptId(), e: event, ...(data ? { d: data } : {}) }]);
  } catch {
    /* never throw from instrumentation */
  }
};

/** A new attempt begins: the visitor pressed send on a parked question. */
export const startAuthAttempt = (): void => {
  try {
    localStorage.removeItem(ATTEMPT_KEY);
  } catch {
    /* a reused id costs a confusing trace, nothing more */
  }
  traceAuth('attempt_start');
};

/**
 * Records the page load itself, which is the single most important line in the
 * trace: if a load appears in the *middle* of an attempt, something reloaded
 * the page mid-handshake — the failure mode that has cost the most time here,
 * and the one no server log can show. Also names the service worker in
 * control, because a retired-but-still-registered worker is how that happened
 * before (bug 7, and again on 2026-08-07).
 */
export const traceBoot = (): void => {
  const events = read();
  const last = events[events.length - 1];
  traceAuth('page_load', {
    mid_attempt: last != null && last.e !== 'handoff_submitted' && last.e !== 'attempt_start',
    prev_event: last?.e ?? null,
    ms_since_prev: last ? Date.now() - last.t : -1,
    sw_controller: navigator.serviceWorker?.controller?.scriptURL ?? null,
    has_parked_question: localStorage.getItem('aflat_anon_q') != null,
    url: window.location.pathname + window.location.hash,
  });
};

export const readAuthTrace = (): TraceEvent[] => read();

declare global {
  interface Window {
    __aflatAuthTrace?: () => TraceEvent[];
  }
}

if (typeof window !== 'undefined') {
  window.__aflatAuthTrace = readAuthTrace;
}
