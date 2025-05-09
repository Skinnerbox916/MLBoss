import { NextRequest, NextResponse } from 'next/server';
import { clearAllCache } from '../../../utils/admin';

export async function POST(request: NextRequest) {
  try {
    const result = await clearAllCache();
    return NextResponse.json({ success: true, clearedKeys: result });
  } catch (error) {
    console.error('Error clearing all cache:', error);
    return NextResponse.json({ error: 'Failed to clear all cache' }, { status: 500 });
  }
} 