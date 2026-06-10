'use client';

import Link from 'next/link';
import { FiArrowRight } from 'react-icons/fi';
import Panel from '@/components/ui/Panel';
import Icon from '@/components/Icon';
import { Heading, Text } from '@/components/typography';

/**
 * Placeholder shown when a points league is active on a page whose points
 * experience isn't built yet. Keeps the league switch consistent app-wide —
 * a points league never falls back to a categories UI rendered with
 * points-league data — and points the user at the surfaces that ARE live.
 */
export default function PointsComingSoon({ page }: { page: string }) {
  return (
    <div className="p-6">
      <Heading as="h1" className="text-primary">{page}</Heading>
      <Panel className="mt-4">
        <Text className="text-foreground font-medium">Points-league {page.toLowerCase()} view is coming.</Text>
        <Text variant="small" className="text-muted-foreground mt-1">
          The points engine is live — <Link href="/roster" className="text-accent hover:underline">Roster</Link> and{' '}
          <Link href="/dashboard" className="text-accent hover:underline">Dashboard</Link> are ready. This page still
          shows the categories layout, so it&apos;s parked here until its points view ships.
        </Text>
        <Link
          href="/roster"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          Go to Roster <Icon icon={FiArrowRight} size={14} />
        </Link>
      </Panel>
    </div>
  );
}
