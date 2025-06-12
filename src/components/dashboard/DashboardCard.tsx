import { ReactNode } from 'react';
import { type IconType } from 'react-icons';
import Icon from '@/components/Icon';

export type CardSize = 'sm' | 'md' | 'lg' | 'xl';

interface DashboardCardProps {
  title: string;
  icon?: IconType;
  size?: CardSize;
  isLoading?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const sizeToGridClass: Record<CardSize, string> = {
  sm: 'col-span-1 row-span-1',
  md: 'col-span-1 row-span-2 md:col-span-2 md:row-span-1',
  lg: 'col-span-1 row-span-2 md:col-span-2 md:row-span-2',
  xl: 'col-span-1 row-span-3 md:col-span-4 md:row-span-2',
};

export default function DashboardCard({
  title,
  icon,
  size = 'md',
  isLoading = false,
  children,
  footer,
  className = '',
}: DashboardCardProps) {
  return (
    <div className={`${sizeToGridClass[size]} ${className}`}>
      <div className="bg-white dark:bg-primary-900 rounded-lg shadow p-6 h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-foreground">
            {title}
          </h3>
          {icon && (
            <Icon
              icon={icon}
              size={24}
              className="text-accent"
              aria-label={`${title} icon`}
            />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="animate-pulse">
              <div className="h-4 bg-primary-100 dark:bg-primary-700 rounded w-3/4 mb-2"></div>
              <div className="h-4 bg-primary-100 dark:bg-primary-700 rounded w-1/2 mb-2"></div>
              <div className="h-4 bg-primary-100 dark:bg-primary-700 rounded w-2/3"></div>
            </div>
          ) : (
            children
          )}
        </div>

        {/* Footer */}
        {footer && (
          <div className="mt-4 pt-4 border-t border-primary-200 dark:border-primary-700">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export { sizeToGridClass }; 