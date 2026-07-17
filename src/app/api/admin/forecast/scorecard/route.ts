import { NextResponse } from 'next/server';
import { requireOperator } from '@/lib/auth';
import { buildScorecard, type ForecastEngine } from '@/lib/ledger';

const ENGINES: ForecastEngine[] = ['pitcher-start', 'points-pitcher-start', 'points-batter-day'];

/**
 * GET /api/admin/forecast/scorecard?engine=...&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Grade the ledger: per-engine bias/MAE, QS/W calibration, lead-day and
 * model-version segments, rank quality, worst per-player misses.
 * Operator only.
 */
export async function GET(request: Request) {
  const authz = await requireOperator();
  if (!authz.ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: authz.status });
  }
  try {
    const { searchParams } = new URL(request.url);
    const engineParam = searchParams.get('engine');
    const isDate = (s: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const cards = await buildScorecard(authz.userId, {
      engine: ENGINES.includes(engineParam as ForecastEngine) ? (engineParam as ForecastEngine) : undefined,
      from: isDate(from) ? (from as string) : undefined,
      to: isDate(to) ? (to as string) : undefined,
    });
    return NextResponse.json({ engines: cards });
  } catch (error) {
    console.error('/api/admin/forecast/scorecard failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Scorecard failed' },
      { status: 500 },
    );
  }
}
