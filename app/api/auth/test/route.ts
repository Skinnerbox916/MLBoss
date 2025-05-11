import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    // Test URLSearchParams
    const testParams = new URLSearchParams();
    testParams.append('test', 'value');
    testParams.append('another', 'param');
    
    // Return success response
    return NextResponse.json({
      success: true,
      message: 'URLSearchParams test successful',
      params: testParams.toString()
    });
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 });
  }
} 