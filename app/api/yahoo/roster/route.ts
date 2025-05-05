import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const accessToken = req.cookies.get('yahoo_access_token')?.value;
  if (!accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Example: Fetch user's teams (you may need to adjust the endpoint for your league/roster)
  const url = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=mlb/teams?format=json';
  const yahooRes = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!yahooRes.ok) {
    const error = await yahooRes.text();
    return NextResponse.json({ error: 'Failed to fetch Yahoo data', details: error }, { status: 500 });
  }

  const data = await yahooRes.json();
  return NextResponse.json(data);
} 