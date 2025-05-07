'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { YAHOO_AUTH_URL, generateState, setClientCookie } from './utils/auth';
import Image from 'next/image';

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

  const handleLogin = () => {
    const state = generateState();
    setClientCookie('yahoo_state', state, { path: '/', secure: true, sameSite: 'lax' });
    const forceLogin = searchParams.get('forceLogin') === '1';
    window.location.href = YAHOO_AUTH_URL(state, forceLogin);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div style={{ marginBottom: '2rem' }}>
        <Image
          src="/MLBoss Logo.png"
          alt="MLBoss Logo"
          width={200}
          height={0}
          style={{ height: 'auto' }}
          priority
        />
      </div>
      
      {showError && (
        <div style={{ marginBottom: '1rem', color: '#e53e3e', fontSize: '0.9rem' }}>
          Your session has expired. Please log in again.
        </div>
      )}
      
      <button 
        onClick={handleLogin} 
        style={{ 
          padding: '1rem 2rem', 
          fontSize: '1.2rem', 
          background: '#430297', 
          color: 'white', 
          border: 'none', 
          borderRadius: '8px',
          cursor: 'pointer',
          transition: 'background 0.2s'
        }}
      >
        Login with Yahoo
      </button>
    </div>
  );
} 