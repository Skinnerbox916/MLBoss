import React from 'react';
import { cn } from '@/lib/utils';

// Sizes mirror the global element styling defined in `globals.css` (h1-h6
// base layer). Using fluid `clamp()` values so headings scale smoothly
// between mobile and desktop without hard breakpoints. Keep this map and
// the base layer in `globals.css` in lockstep.
const sizeClass = {
  h1: 'text-[clamp(2rem,5vw,3rem)]',
  h2: 'text-[clamp(1.25rem,2vw,1.625rem)]',
  h3: 'text-[clamp(1.0625rem,1.5vw,1.375rem)]',
  h4: 'text-[clamp(1rem,1.25vw,1.125rem)]',
  h5: 'text-[1rem]',
  h6: 'text-[0.875rem]',
} as const;

export type HeadingLevel = keyof typeof sizeClass;

interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Semantic heading level — controls the rendered HTML element. */
  as?: HeadingLevel;
  /**
   * Visual size override. Defaults to matching `as`. Use when the semantic
   * level needs to differ from the visual scale (e.g. an h3 styled like an h1).
   */
  size?: HeadingLevel;
}

/**
 * Page or section heading rendered with the Pacifico display font.
 *
 * The default look comes from `globals.css` — this component exists to
 * (1) enforce semantic-correct usage across the app and (2) allow visual
 * size overrides without sacrificing semantics.
 *
 * @example
 *   <Heading as="h1">Roster Optimizer</Heading>
 *   <Heading as="h2">Positional Depth</Heading>
 *   <Heading as="h3" size="h2">Visually larger h3</Heading>
 */
export function Heading({
  as = 'h2',
  size,
  className,
  ...rest
}: HeadingProps) {
  const Tag = as as React.ElementType;
  // Only emit a size class when overriding — otherwise rely on global element
  // styling. Avoids polluting the DOM with redundant classes.
  const sizeOverride = size && size !== as ? sizeClass[size] : undefined;

  return (
    <Tag
      className={cn(sizeOverride, className)}
      {...rest}
    />
  );
}
