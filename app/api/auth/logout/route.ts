import { NextRequest, NextResponse } from 'next/server';
import { clearYahooCookies } from '../../../utils/auth.server';

export async function GET(req: NextRequest) {
  // Clear all Yahoo-related cookies
  clearYahooCookies();
  
  // Create a JSON response indicating success
  const response = NextResponse.json({ success: true });
  
  // Also clear the client-side cookie
  response.cookies.delete('yahoo_client_access_token');
  
  return response;
} 