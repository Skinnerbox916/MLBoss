import React from 'react';
import { cn } from '@/lib/utils';

const sizes = {
  h1: 'text-4xl lg:text-5xl',
  h2: 'text-3xl lg:text-4xl',
  h3: 'text-2xl',
  h4: 'text-xl',
  h5: 'text-lg',
  h6: 'text-base',
} as const;

export type HeadingLevel = keyof typeof sizes;

interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Semantic heading level (affects HTML element) */
  as?: HeadingLevel;
  /** Visual heading size (affects styling only) */
  size?: HeadingLevel;
}

/**
 * Flexible heading component using Berkshire Swash display font.
 * 
 * @example
 * // Semantic h1 with h1 styling
 * <Heading as="h1">Page Title</Heading>
 * 
 * // Semantic h3 but styled like h1
 * <Heading as="h3" size="h1">Section Title</Heading>
 */
export function Heading({ 
  as = 'h2', 
  size, 
  className, 
  ...rest 
}: HeadingProps) {
  const Tag = as as React.ElementType;
  const variant = size ?? as;
  
  return (
    <Tag
      className={cn(
        'font-display text-foreground font-normal leading-tight',
        sizes[variant],
        className
      )}
      {...rest}
    />
  );
} 