import React from 'react';
import { render, screen } from '@testing-library/react';
import Reasoning from '../Reasoning';
import Part from '../../Part';
import { MessageContext } from '~/Providers';

/**
 * `stageLabel` is additive: a THINK part without it must render exactly as
 * before ("Gândesc…" while streaming, "Gânduri" once done). When present —
 * e.g. a "Caut în legislație…" querying step — it replaces that generic
 * header so a search stage can look visually distinct from plain reasoning,
 * without a new content type or transport
 * (docs/integration/2026-07-29-answer-event-envelope-PROPOSAL.md).
 */

const renderReasoning = (
  props: React.ComponentProps<typeof Reasoning>,
  context: { isSubmitting?: boolean; isLatestMessage?: boolean } = {},
) =>
  render(
    <MessageContext.Provider
      value={{
        messageId: 'm1',
        isExpanded: true,
        isSubmitting: context.isSubmitting,
        isLatestMessage: context.isLatestMessage,
      }}
    >
      <Reasoning {...props} />
    </MessageContext.Provider>,
  );

describe('Reasoning stage label', () => {
  it('falls back to the generic thoughts label when idle and no stageLabel is given', () => {
    renderReasoning({ reasoning: 'analiză simplă', isLast: true });

    expect(screen.getByText('Thoughts')).toBeInTheDocument();
  });

  it('falls back to the generic thinking label while submitting and no stageLabel is given', () => {
    renderReasoning(
      { reasoning: 'analiză simplă', isLast: true },
      { isSubmitting: true, isLatestMessage: true },
    );

    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('shows stageLabel instead of the generic label while submitting', () => {
    renderReasoning(
      { reasoning: 'Caut Legea nr. 50/1991…', isLast: true, stageLabel: 'Caut în legislație…' },
      { isSubmitting: true, isLatestMessage: true },
    );

    expect(screen.getByText('Caut în legislație…')).toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });

  it('keeps stageLabel once the segment is done streaming, instead of reverting to "Thoughts"', () => {
    renderReasoning({
      reasoning: 'Caut Legea nr. 50/1991…',
      isLast: true,
      stageLabel: 'Caut în legislație…',
    });

    expect(screen.getByText('Caut în legislație…')).toBeInTheDocument();
    expect(screen.queryByText('Thoughts')).not.toBeInTheDocument();
  });

  it('renders nothing for an empty reasoning string, stageLabel notwithstanding', () => {
    const { container } = renderReasoning({
      reasoning: '',
      isLast: true,
      stageLabel: 'Caut în legislație…',
    });

    expect(container).toBeEmptyDOMElement();
  });
});

describe('Part dispatch: THINK -> Reasoning stage_label', () => {
  it('passes part.stage_label through to the rendered label', () => {
    render(
      <MessageContext.Provider
        value={{ messageId: 'm1', isExpanded: true, isSubmitting: true, isLatestMessage: true }}
      >
        <Part
          part={
            {
              type: 'think',
              think: 'caut in Legea 50/1991',
              stage_label: 'Caut în legislație…',
            } as unknown as React.ComponentProps<typeof Part>['part']
          }
          isSubmitting={true}
          isLast={true}
          showCursor={true}
          isCreatedByUser={false}
        />
      </MessageContext.Provider>,
    );

    expect(screen.getByText('Caut în legislație…')).toBeInTheDocument();
  });

  it('renders the generic label when the THINK part carries no stage_label', () => {
    render(
      <MessageContext.Provider
        value={{ messageId: 'm1', isExpanded: true, isSubmitting: true, isLatestMessage: true }}
      >
        <Part
          part={
            { type: 'think', think: 'ceva' } as unknown as React.ComponentProps<
              typeof Part
            >['part']
          }
          isSubmitting={true}
          isLast={true}
          showCursor={true}
          isCreatedByUser={false}
        />
      </MessageContext.Provider>,
    );

    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });
});
