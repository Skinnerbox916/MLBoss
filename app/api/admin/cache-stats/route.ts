import { NextResponse } from 'next/server';
import { getRedisInfo } from '../../../utils/admin';

export async function GET() {
  try {
    const cacheInfo = await getRedisInfo();
    return NextResponse.json(cacheInfo);
  } catch (error) {
    console.error('Error fetching cache stats:', error);
    return NextResponse.json({ error: 'Failed to fetch cache statistics' }, { status: 500 });
  }
} 