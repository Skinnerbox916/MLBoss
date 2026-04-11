import clsx, { type ClassValue } from 'clsx';

/**
 * Utility function for concatenating and conditionally applying CSS classes.
 * 
 * This is a common pattern in React applications, especially when using Tailwind CSS.
 * It combines clsx functionality for conditional classes.
 * 
 * @param classes - Class values to concatenate
 * @returns A string of concatenated class names
 * 
 * @example
 * ```tsx
 * cn('base-class', condition && 'conditional-class', 'another-class')
 * // Result: 'base-class conditional-class another-class' (if condition is true)
 * ```
 */
export function cn(...classes: ClassValue[]) {
  return clsx(classes);
} 