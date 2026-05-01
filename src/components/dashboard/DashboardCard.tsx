import { ReactNode } from 'react';
import { type IconType } from 'react-icons';
import Icon from '@/components/Icon';
import Skeleton from '@/components/ui/Skeleton';

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
      <div className="bg-surface rounded-lg shadow p-6 h-full flex flex-col">
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
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            children
          )}
        </div>

        {/* Footer */}
        {footer && (
          <div className="mt-4 pt-4 border-t border-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export { sizeToGridClass }; 