import React from 'react';
import { cn } from '@/lib/utils';

const variants = {
  body: 'font-body text-base leading-relaxed text-foreground',
  muted: 'font-body text-base leading-relaxed text-muted-foreground',
  small: 'font-body text-sm text-muted-foreground',
  caption: 'font-body text-xs text-muted-foreground opacity-80',
  mono: 'font-mono text-sm',
} as const;

export type TextVariant = keyof typeof variants;

interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /** HTML element to render */
  as?: 'p' | 'span' | 'div' | 'small';
  /** Text style variant */
  variant?: TextVariant;
}

/**
 * Flexible text component using Quicksand body font.
 * 
 * @example
 * // Standard paragraph
 * <Text>This is body text.</Text>
 * 
 * // Muted helper text
 * <Text variant="muted">This is secondary information.</Text>
 * 
 * // Inline monospace
 * <Text as="span" variant="mono">console.log()</Text>
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