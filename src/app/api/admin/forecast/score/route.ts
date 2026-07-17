import { NextResponse } from 'next/server';
import { requireOperator } from '@/lib/auth';
import { scorePendingActuals } from '@/lib/ledger';

/**
 * POST /api/admin/forecast/score
 *
 * Materialize actual game lines for every snapshot whose game date has
 * passed. Idempotent — anything that fails stays pending. Operator only.
 */
export async function POST() {
  const authz = await requireOperator();
  if (!authz.ok) {
    return NextResponse.json({ error: 'Forbidden' }, { status: authz.status });
  }
  try {
    const result = await scorePendingActuals();
    return NextResponse.json(result);
  } catch (error) {
    console.error('/api/admin/forecast/score failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Scoring failed' },
      { status: 500 },
    );
  }
}
