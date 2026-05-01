import { ReactNode } from 'react';

interface GridLayoutProps {
  children: ReactNode;
  className?: string;
}

export default function GridLayout({ children, className = '' }: GridLayoutProps) {
  // `grid-flow-dense` lets mixed 2×1 / 2×2 cards backfill empty cells
  // instead of leaving ragged gaps on the right edge when the natural
  // placement order leaves holes (e.g. a 2×1 follows a tall 2×2).
  return (
    <div
      className={`grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-6 auto-rows-min grid-flow-dense ${className}`}
    >
      {children}
    </div>
  );
} 