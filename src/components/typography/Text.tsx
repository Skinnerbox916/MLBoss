import React from 'react';
import { cn } from '@/lib/utils';

// Variants defined in `globals.css` line up with these defaults — Quicksand
// body font is already applied to <p> via the base layer, so we only need to
// override size/color when stepping away from default body text.
const variants = {
  body: 'text-base leading-relaxed text-foreground',
  muted: 'text-base leading-relaxed text-muted-foreground',
  small: 'text-sm text-muted-foreground',
  caption: 'text-xs text-muted-foreground',
  mono: 'font-mono text-sm',
} as const;

export type TextVariant = keyof typeof variants;

interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /** HTML element to render. Defaults to `<p>`. */
  as?: 'p' | 'span' | 'div' | 'small';
  /** Style variant. Defaults to `body`. */
  variant?: TextVariant;
}

/**
 * Body text component using the Quicksand body font (inherited from globals).
 *
 * @example
 *   <Text>Standard paragraph copy.</Text>
 *   <Text variant="small">Secondary helper text.</Text>
 *   <Text variant="caption">Fine-print metadata.</Text>
 *   <Text as="span" variant="mono">console.log()</Text>
 */
export function Text({
  as = 'p',
  variant = 'body',
  className,
  ...rest
}: TextProps) {
  const Tag = as as React.ElementType;

  return (
    <Tag
      className={cn(variants[variant], className)}
      {...rest}
    />
  );
}
