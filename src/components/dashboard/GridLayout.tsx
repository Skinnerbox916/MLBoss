import { ReactNode } from 'react';

interface GridLayoutProps {
  children: ReactNode;
  className?: string;
}

export default function GridLayout({ children, className = '' }: GridLayoutProps) {
  return (
    <div 
      className={`grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-6 auto-rows-min ${className}`}
    >
      {children}
    </div>
  );
} 