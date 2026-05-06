import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Heading } from '@/components/typography';

interface PanelProps {
  /** Optional section heading rendered in the panel header row. */
  title?: ReactNode;
  /** Optional content rendered on the right side of the header row (e.g. a badge or count). */
  action?: ReactNode;
  /** Optional helper text rendered directly under the header. */
  helper?: ReactNode;
  /** Disables the default padding — useful when the child needs full-bleed control (tables, grids). */
  noPadding?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Standard non-dashboard page section container.
 *
 * Replaces the hand-rolled `bg-surface rounded-lg shadow p-4` pattern used across
 * lineup, roster, league, streaming, and pitching surfaces. Dashboard tiles should
 * continue to use `DashboardCard` — that wraps this same visual language with grid
 * sizing and loading skeletons built in.
 */
export default function Panel({
  title,
  action,
  helper,
  noPadding = false,
  className,
  children,
}: PanelProps) {
  const hasHeader = title !== undefined || action !== undefined;
  return (
    <section
      className={cn(
        'bg-surface rounded-lg shadow',
        noPadding ? '' : 'p-4',
        className,
      )}
    >
      {hasHeader && (
        <div className={cn('flex items-center justify-between', helper ? 'mb-1' : 'mb-3')}>
          {title !== undefined ? (
            typeof title === 'string'
              ? <Heading as="h2">{title}</Heading>
              : title
          ) : <span />}
          {action}
        </div>
      )}
      {helper && (
        <p className="text-xs text-muted-foreground mb-3">{helper}</p>
      )}
      {children}
    </section>
  );
}
