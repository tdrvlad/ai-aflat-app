import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * ai-aflat: whether Clerk's embedded widget is the active front door.
 *
 * Both the login page and its surrounding layout need this answer — the layout
 * must not render the old provider buttons underneath a widget that already
 * offers the same providers.
 *
 * `?redirect=false` forces the legacy fallback. It is read once, at mount, on
 * purpose: the login page strips the parameter from the URL immediately after
 * reading it, so a live read would flip back to `true` mid-session and make the
 * fallback page sprout the very buttons it exists to provide.
 */
export default function useEmbeddedClerk(publishableKey?: string | null): boolean {
  const [searchParams] = useSearchParams();
  const [forcedFallback] = useState(() => searchParams.get('redirect') === 'false');

  return Boolean(publishableKey) && !forcedFallback;
}
