export const dynamic = 'force-dynamic';

import AppLayout from '@/components/layout/AppLayout';
import { Heading, Text } from '@/components/typography';
import ScorecardPanel from './ScorecardPanel';

export default async function AdminForecastPage() {
  return (
    <AppLayout>
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-7xl mx-auto py-4 px-4">
          <div className="mb-6">
            <Heading as="h1">Forecast Scorecard</Heading>
            <Text variant="caption">
              Snapshots graded against actual MLB game lines — bias, calibration, rank quality
            </Text>
          </div>
          <ScorecardPanel />
        </div>
      </main>
    </AppLayout>
  );
}
