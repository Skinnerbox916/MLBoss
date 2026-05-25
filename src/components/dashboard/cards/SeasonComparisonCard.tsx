'use client';

import { FiBarChart } from 'react-icons/fi';
import MatchupProjectionCard from './MatchupProjectionCard';

export default function SeasonComparisonCard() {
  return <MatchupProjectionCard targetWeek="current" titlePrefix="This Week" icon={FiBarChart} />;
}
