import { NextRequest, NextResponse } from 'next/server';
import { clearCacheCategory } from '../../../utils/admin';

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const { category } = data;
    
    if (!category) {
      return NextResponse.json({ error: 'Category is required' }, { status: 400 });
    }
    
    const result = await clearCacheCategory(category);
    return NextResponse.json({ success: true, clearedKeys: result });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return NextResponse.json({ error: 'Failed to clear cache' }, { status: 500 });
  }
} 