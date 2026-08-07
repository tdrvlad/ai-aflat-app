import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import DOMPurify from 'dompurify';
import { OGDialog, OGDialogContent, OGDialogTitle } from '@librechat/client';
import type { TAflatSource } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

type ArticleModalProps = {
  provision: TAflatSource;
  actTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Where the reader link points, split into the two things this modal needs.
 *
 * The URL is READ, never built. `viewer_url` arrives from the orchestrator already
 * resolved — act-level when the article label could not be pinned down in the blob
 * being served, article-level (a `#anchor` fragment) only when it could. Splitting
 * it is not composing it: the document to fetch is the same URL with the fragment
 * removed, and the fragment is the id to find inside that document. Nothing here
 * can invent an anchor, so nothing here can land on the wrong article.
 */
const readerTarget = (viewerUrl?: string) => {
  if (typeof viewerUrl !== 'string' || !/^https?:\/\//i.test(viewerUrl.trim())) {
    return null;
  }
  try {
    const url = new URL(viewerUrl.trim());
    const anchor = url.hash.length > 1 ? decodeURIComponent(url.hash.slice(1)) : null;
    const documentUrl = new URL(url.toString());
    documentUrl.hash = '';
    return { href: url.toString(), documentUrl: documentUrl.toString(), anchor };
  } catch {
    return null;
  }
};

/**
 * One in-flight fetch per act, shared by every provision of it.
 *
 * A single answer routinely cites four provisions of the Labour Code, and the blob
 * is ~200 kB — opening each of them in turn must not re-download it four times.
 */
const blobCache = new Map<string, Promise<Document>>();

const loadBlob = (documentUrl: string): Promise<Document> => {
  const cached = blobCache.get(documentUrl);
  if (cached != null) {
    return cached;
  }
  const pending = fetch(documentUrl, { credentials: 'omit' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`reader_${response.status}`);
      }
      return response.text();
    })
    .then((html) => new DOMParser().parseFromString(html, 'text/html'))
    .catch((error) => {
      /* A failed fetch must not poison the cache — the next open should try again. */
      blobCache.delete(documentUrl);
      throw error;
    });
  blobCache.set(documentUrl, pending);
  return pending;
};

type ArticleState =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'ready'; html: string };

/**
 * The full text of one cited article, read out of the document the reader itself serves.
 *
 * This exists because the citation boxes should not have to choose between being
 * scannable and being verifiable. The box names the act and the article and stops
 * there; this modal is where the actual legal text lives, one click away and without
 * leaving the answer.
 *
 * The text is never model output and never a stored copy — it is fetched, at open
 * time, from the same blob `legislatie.ai-aflat.ro` renders, and the article is cut
 * out of it by the anchor the orchestrator resolved. If the fetch fails or the anchor
 * is not in the document, this says so and falls back to the retrieval snippet; it
 * never renders an article it could not find, because a confidently-wrong article is
 * the one failure this product cannot afford.
 */
const ArticleModal = memo(function ArticleModal({
  provision,
  actTitle,
  open,
  onOpenChange,
}: ArticleModalProps) {
  const localize = useLocalize();
  const target = useMemo(() => readerTarget(provision.viewer_url), [provision.viewer_url]);
  const [state, setState] = useState<ArticleState>({ status: 'idle' });
  const bodyRef = useRef<HTMLDivElement>(null);

  const officialHref =
    typeof provision.url === 'string' && /^https?:\/\//i.test(provision.url.trim())
      ? provision.url.trim()
      : undefined;

  useEffect(() => {
    if (!open || target == null || target.anchor == null) {
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void loadBlob(target.documentUrl)
      .then((doc) => {
        if (cancelled) {
          return;
        }
        const element = doc.getElementById(target.anchor as string);
        if (element == null) {
          setState({ status: 'unavailable' });
          return;
        }
        /**
         * The reader ships its own fold/unfold controls inside the article — a
         * `TAG_COLLAPSED` span rendering as a bare „+". They are inert without the
         * reader's script, so here they are just a stray plus sign in front of every
         * article title. Cloned first: the cached document is shared with every other
         * provision of this act and must not be mutated.
         */
        const article = element.cloneNode(true) as HTMLElement;
        for (const control of article.querySelectorAll('.TAG_COLLAPSED, .TAG_EXPANDED')) {
          control.remove();
        }
        setState({
          status: 'ready',
          html: DOMPurify.sanitize(article.outerHTML, { USE_PROFILES: { html: true } }),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'unavailable' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  /**
   * The act text cross-references other acts. Those links are real and worth keeping,
   * but they must leave this tab — a legislative document navigating the app away
   * from the answer it is a citation for would lose the conversation.
   */
  useEffect(() => {
    if (state.status !== 'ready' || bodyRef.current == null) {
      return;
    }
    for (const anchor of bodyRef.current.querySelectorAll('a[href]')) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  }, [state]);

  const heading = [provision.title, actTitle].filter(Boolean).join(' · ');

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent
        data-testid="aflat-article-modal"
        className="flex max-h-[85vh] w-11/12 max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:w-full"
      >
        <div className="aa-tricolor" aria-hidden="true" />

        <div className="flex flex-col gap-1 px-6 pb-3 pt-5">
          <OGDialogTitle className="text-base leading-snug">
            {provision.title ?? actTitle}
          </OGDialogTitle>
          {actTitle != null && provision.title != null && (
            <p className="m-0 text-xs leading-snug text-text-secondary">{actTitle}</p>
          )}
          {provision.path != null && provision.path !== '' && (
            <p className="m-0 text-xs text-text-tertiary">{provision.path}</p>
          )}
          <span className="sr-only">{heading}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
          {state.status === 'loading' && (
            <p className="m-0 text-sm text-text-tertiary">
              {localize('com_aflat_article_loading')}
            </p>
          )}

          {state.status === 'ready' && (
            <div
              ref={bodyRef}
              data-testid="aflat-article-text"
              className="aa-article text-sm leading-relaxed text-text-primary"
              /* Sanitised above; the reader's own markup carries the article's structure. */
              dangerouslySetInnerHTML={{ __html: state.html }}
            />
          )}

          {(state.status === 'unavailable' || target?.anchor == null) && (
            <div className="flex flex-col gap-2">
              {/**
               * Two different failures, deliberately given the same shape: the article
               * could not be pinned down in the act (a range like „art. 147^1–152" matches
               * no single anchor), or the reader could not be read just now. In both cases
               * the honest thing on screen is the excerpt retrieval actually returned,
               * plus the way through to the act itself.
               */}
              <p className="m-0 text-sm text-text-secondary">
                {target?.anchor == null
                  ? localize('com_aflat_article_act_level')
                  : localize('com_aflat_article_unavailable')}
              </p>
              {provision.snippet != null && provision.snippet !== '' && (
                <blockquote className="m-0 border-l-2 border-border-medium pl-3 text-sm leading-relaxed text-text-secondary">
                  {provision.snippet}
                </blockquote>
              )}
            </div>
          )}

          {provision.why != null && provision.why !== '' && (
            <p
              data-testid="aflat-article-why"
              className="mb-0 mt-4 text-[11.5px] leading-snug text-text-tertiary"
            >
              {provision.why}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border-light px-6 py-3">
          {target != null && (
            <a
              data-testid="aflat-article-open-act"
              href={target.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[12.5px] font-semibold text-link underline underline-offset-[3px] hover:text-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
            >
              {target.anchor != null
                ? localize('com_aflat_article_open_at')
                : localize('com_aflat_sources_open_law')}
              <ExternalLink aria-hidden="true" className="h-[13px] w-[13px] shrink-0" />
            </a>
          )}
          {officialHref != null && (
            <a
              data-testid="aflat-article-open-official"
              href={officialHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11.5px] text-text-tertiary underline underline-offset-[3px] transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
            >
              {localize('com_aflat_sources_open')}
              <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
            </a>
          )}
        </div>
      </OGDialogContent>
    </OGDialog>
  );
});

export default ArticleModal;
