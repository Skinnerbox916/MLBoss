import { NextResponse } from 'next/server';
import { redisUtils } from '@/lib/redis';

export async function GET() {
  try {
    // Set the key 'hello' to 'world'
    const setResult = await redisUtils.set('hello', 'world');
    
    // Retrieve the key 'hello'
    const getValue = await redisUtils.get('hello');
    
    return NextResponse.json({
      success: true,
      operations: {
        set: {
          key: 'hello',
          value: 'world',
          result: setResult
        },
        get: {
          key: 'hello',
          value: getValue
        }
      },
      message: 'Redis test completed successfully'
    });
  } catch (error) {
    console.error('Redis test error:', error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to perform Redis operations',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 