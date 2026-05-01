import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BadgeColor = 'success' | 'error' | 'accent' | 'primary' | 'muted';

const colorStyles: Record<BadgeColor, string> = {
  success: 'bg-success/15 text-success',
  error: 'bg-error/15 text-error',
  accent: 'bg-accent/15 text-accent',
  primary: 'bg-primary/15 text-primary',
  muted: 'bg-surface-muted text-muted-foreground',
};

interface BadgeProps {
  color: BadgeColor;
  children: ReactNode;
  className?: string;
  title?: string;
}

export default function Badge({ color, children, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-caption font-semibold',
        colorStyles[color],
        className,
      )}
    >
      {children}
    </span>
  );
}
