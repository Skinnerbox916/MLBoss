'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const YAHOO_CLIENT_ID = 'dj0yJmk9eUFSWTNWZW9GWFFVJmQ9WVdrOWRYVkVaazF3TWswbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTk5';
const YAHOO_REDIRECT_URI = 'https://e657-45-29-68-219.ngrok-free.app/api/auth/callback';
const YAHOO_AUTH_URL = `https://api.login.yahoo.com/oauth2/request_auth?client_id=${YAHOO_CLIENT_ID}&redirect_uri=${encodeURIComponent(YAHOO_REDIRECT_URI)}&response_type=code&language=en-us&scope=openid%20fspt-w`;

function getCookie(name: string) {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showError, setShowError] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    const error = searchParams.get('error');
    if (error === 'token_expired') {
      setShowError(true);
    }
  }, [searchParams]);

  // Only redirect to dashboard if token is present, there is no error, and not logging in
  useEffect(() => {
    const token = getCookie('yahoo_access_token');
    const error = searchParams.get('error');
    if (token && !error && !isLoggingIn) {
      router.replace('/dashboard');
    }
  }, [router, searchParams, isLoggingIn]);

  return (
    <div className="max-w-4xl mx-auto min-h-[60vh] flex flex-col items-center justify-center">
      <h1 className="text-3xl font-bold mb-8 text-center">MLB Lineup Manager</h1>
      <div className="flex flex-col items-center justify-center p-8 border rounded-lg">
        {showError && (
          <div className="text-red-600 mb-4">Your token has expired. Please log in again.</div>
        )}
        <button
          onClick={() => {
            setIsLoggingIn(true);
            window.location.href = YAHOO_AUTH_URL;
          }}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          Login with Yahoo
        </button>
      </div>
    </div>
  );
} 