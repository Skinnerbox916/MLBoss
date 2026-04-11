import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getLeagueTransactions } from '@/lib/fantasy';

/**
 * GET /api/fantasy/transactions?leagueKey=458.l.123456&type=add
 * Returns league transactions. Optional type filter: add, drop, trade.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    const user = session.user!;
    const { searchParams } = new URL(request.url);
    const leagueKey = searchParams.get('leagueKey');
    const type = searchParams.get('type') as 'add' | 'drop' | 'trade' | null;

    if (!leagueKey) {
      return NextResponse.json({ error: 'leagueKey is required' }, { status: 400 });
    }

    const transactions = await getLeagueTransactions(user.id, leagueKey, type ?? undefined);

    return NextResponse.json({ league_key: leagueKey, transactions });
  } catch (error) {
    console.error('Transactions API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get transactions' },
      { status: 500 },
    );
  }
}
