import type { ReactElement } from 'react';
import type { Notice } from '@tailwind/spec';

/**
 * The one way this app draws a notice.
 *
 * ADR-006's amendment makes the envelope the only CHANNEL for degradation; this is the
 * matching rule on the rendering side. It was already the pattern -- the truncation
 * notice above a chart -- and TW-156 needs the same treatment at dashboard level for
 * `partial_failure`, so it moves out of `Chart.tsx` rather than being reimplemented
 * twenty lines higher up the page. Two components that draw notices differently is how
 * one of them ends up quietly not drawing them at all.
 *
 * It sits ABOVE whatever it qualifies, deliberately: a caveat under a number is read
 * after the number has already been believed.
 *
 * Colours come from `theme.css` and only from there -- `--bad`, `--warn`, `--muted`,
 * `--rule`, `--ground`. A token this file invents renders as no colour at all, which
 * has already happened once in this repo with `var(--fg)`.
 */
export function NoticeList({ notices }: { notices: readonly Notice[] }): ReactElement | null {
  if (notices.length === 0) return null;
  return (
    <>
      {notices.map((n) => (
        <p
          key={n.code}
          // `alert` for an error, `status` for a warning: the first interrupts a screen
          // reader, the second waits its turn. A dashboard that is incomplete is worth
          // interrupting for.
          role={n.severity === 'error' ? 'alert' : 'status'}
          style={{
            fontSize: '.7rem',
            margin: '0 0 .5rem',
            padding: '.35rem .5rem',
            borderRadius: 4,
            border: '1px solid var(--rule)',
            color: n.severity === 'error' ? 'var(--bad)' : 'var(--warn)',
            background: 'var(--ground)',
          }}
        >
          {n.message}
        </p>
      ))}
    </>
  );
}
