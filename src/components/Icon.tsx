import React from 'react';
import { type IconBaseProps, type IconType } from 'react-icons';
import { cn } from '@/lib/utils';

/**
 * Icon wrapper component for consistent styling across the app.
 * 
 * Provides sensible defaults for size, color, and accessibility while allowing
 * full customization. Works with any react-icons library (Game Icons, Feather, etc.).
 * 
 * @example
 * ```tsx
 * import { GiBaseballBat } from 'react-icons/gi';
 * import { FiHome } from 'react-icons/fi';
 * 
 * // Basic usage with default size (20px)
 * <Icon icon={GiBaseballBat} />
 * 
 * // Custom size and styling
 * <Icon icon={FiHome} size={24} className="text-blue-600" />
 * 
 * // With accessibility label
 * <Icon icon={GiBaseballBat} aria-label="Baseball equipment" />
 * ```
 */

interface IconProps extends Omit<IconBaseProps, 'size'> {
  /** The react-icon component to render */
  icon: IconType;
  /** 
   * Icon size in pixels. Defaults to 20px for optimal readability.
   * Common sizes: 16 (small), 20 (default), 24 (medium), 32 (large)
   */
  size?: number;
  /** Additional CSS classes for styling */
  className?: string;
  /** 
   * Accessibility label. Highly recommended for interactive icons.
   * If not provided, icon will be marked as decorative (aria-hidden="true")
   */
  'aria-label'?: string;
}

/**
 * Unified icon component that wraps react-icons with consistent defaults.
 * 
 * Design decisions:
 * - Default size of 20px works well with most UI text (16px)
 * - Uses currentColor by default (inherits parent text color)
 * - Automatically handles accessibility attributes
 * - Supports all standard react-icons props via spread
 */
export default function Icon({ 
  icon: IconComponent, 
  size = 20, 
  className,
  'aria-label': ariaLabel,
  ...rest 
}: IconProps) {
  return (
    <IconComponent
      size={size}
      className={cn(
        // Base styles for consistent rendering
        'inline-block flex-shrink-0',
        className
      )}
      // Accessibility: if no label provided, mark as decorative
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      {...rest}
    />
  );
}

/**
 * Common icon collections used in this app:
 * 
 * Baseball/Sports specific:
 * - react-icons/gi (Game Icons) - GiBaseballBat, GiBaseballGlove, GiBaseballStadium, etc.
 * 
 * General UI:
 * - react-icons/fi (Feather) - FiHome, FiSettings, FiUser, FiList, etc.
 * 
 * Both collections use consistent outline styling that works well together.
 */ 