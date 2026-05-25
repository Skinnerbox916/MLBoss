'use client';

import { FiCalendar } from 'react-icons/fi';
import MatchupProjectionCard from './MatchupProjectionCard';

export default function NextWeekCard() {
  return <MatchupProjectionCard targetWeek="next" titlePrefix="Next Week" icon={FiCalendar} />;
}
