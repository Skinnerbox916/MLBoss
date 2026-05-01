import { ComponentType } from 'react';

// Card size is declared by each card component internally (via its
// DashboardCard `size` prop). The dashboard page config only orders cards;
// it does not override sizes. This keeps each card's visual footprint
// colocated with its content so card authors can tune density in one place.
export interface DashboardCardMeta {
  id: string;
  component: ComponentType;
  order?: number;
}

export interface DashboardLayout {
  cards: DashboardCardMeta[];
} 