import { ComponentType } from 'react';
import { CardSize } from './DashboardCard';

export interface DashboardCardMeta {
  id: string;
  component: ComponentType;
  size: CardSize;
  order?: number;
}

export interface DashboardLayout {
  cards: DashboardCardMeta[];
} 