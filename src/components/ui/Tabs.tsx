'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  /** Optional badge/count rendered after the label (e.g. "Batters · 12"). */
  meta?: ReactNode;
}

interface TabsProps<T extends string = string> {
  /**
   * `segment`: pill-style mode switch. Use when the user's task changes
   *   between tabs (e.g. Batters vs Pitchers — different decisions).
   * `underline`: peer-view tabs. Use when the tabs show the same shape of
   *   data sliced differently (e.g. Batting vs Pitching category tables).
   */
  variant: 'segment' | 'underline';
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}

export default function Tabs<T extends string = string>({
  variant,
  items,
  value,
  onChange,
  className,
  ariaLabel,
}: TabsProps<T>) {
  if (variant === 'segment') {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn('flex space-x-1 bg-secondary rounded-lg p-1', className)}
      >
        {items.map(item => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(item.id)}
              className={cn(
                'flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                {item.label}
                {item.meta && (
                  <span className="text-caption text-muted-foreground">{item.meta}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex gap-1 border-b border-border', className)}
    >
      {items.map(item => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              'px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              active
                ? 'border-accent text-accent'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {item.label}
              {item.meta && (
                <span className="text-caption text-muted-foreground">{item.meta}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
