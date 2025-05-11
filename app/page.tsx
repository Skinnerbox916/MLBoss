'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { YAHOO_AUTH_URL, generateState, setClientCookie, getClientCookie } from './utils/auth';
import Image from 'next/image';

// Component that uses useSearchParams
function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // Add a small delay to simulate checking and make animation visible
    const checkAuth = setTimeout(() => {
      // Check if user already has a token and redirect to dashboard
      if (typeof document !== 'undefined' && document.cookie.includes('yahoo_client_access_token')) {
        router.push('/dashboard');
        return;
      }
      
      setCheckingAuth(false);
    }, 1000);
    
    const error = searchParams.get('error');
    const message = searchParams.get('message');
    
    if (error) {
      setShowError(true);
      setCheckingAuth(false);
      
      if (error === 'invalid_scope') {
        setErrorMessage(message || 'Yahoo API scope permission error. Please try again or contact support.');
      } else if (error === 'state_mismatch') {
        setErrorMessage('Authentication session error. Please try again.');
      } else if (error === 'token_expired') {
        setErrorMessage('Your session has expired. Please log in again.');
      } else {
        setErrorMessage(`Authentication error: ${error}. Please try again.`);
      }
    }
    
    return () => clearTimeout(checkAuth);
  }, [searchParams, router]);

  const handleLogin = async () => {
    console.log("Login button clicked");
    setIsLoggingIn(true);
    
    const state = generateState();
    console.log("Generated state:", state);
    
    // Set in client-side cookie first
    setClientCookie('yahoo_state', state, { path: '/', secure: true, sameSite: 'lax' });
    console.log("Client cookie set");
    
    try {
      // Create a server-side copy of the state for verification
      const stateResponse = await fetch('/api/auth/state', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state }),
      });
      
      if (!stateResponse.ok) {
        console.error('Failed to save state on server-side:', await stateResponse.text());
        setShowError(true);
        setErrorMessage('Failed to initialize authentication. Please try again.');
        setIsLoggingIn(false);
        return;
      }
      
      const stateData = await stateResponse.json();
      console.log('Server state response:', stateData);
      
      // Double-check we have the state value
      const storedState = getClientCookie('yahoo_state');
      console.log('State cookie verification:', storedState === state);
      
      const forceLogin = searchParams.get('forceLogin') === '1';
      const authUrl = YAHOO_AUTH_URL(state, forceLogin);
      console.log("Auth URL:", authUrl);
      
      // Navigate to Yahoo auth
      window.location.href = authUrl;
      
    } catch (err) {
      console.error("Error in login process:", err);
      setShowError(true);
      setErrorMessage('An error occurred starting authentication. Please try again.');
      setIsLoggingIn(false);
    }
  };

  if (!mounted) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
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
      </div>
    );
  }

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
        <div style={{ marginBottom: '1rem', color: '#e53e3e', fontSize: '0.9rem', maxWidth: '80%', textAlign: 'center' }}>
          {errorMessage}
        </div>
      )}
      
      {checkingAuth ? (
        <div style={{ position: 'relative', width: '200px', height: '54px', marginTop: '1rem', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '6px' }}>
          {[...Array(9)].map((_, i) => (
            <div 
              key={i} 
              className="equalizer-bar"
              style={{ 
                animationDelay: `${i * 0.1}s`,
                height: '40px', // Default height
                backgroundColor: '#430297'
              }}
            ></div>
          ))}
          <style jsx>{`
            .equalizer-bar {
              width: 6px;
              border-radius: 3px;
              animation: equalize 1.2s ease-in-out infinite;
            }
            
            @keyframes equalize {
              0% { height: 20px; }
              50% { height: 40px; }
              100% { height: 20px; }
            }
            
            /* Alternate animation heights for a more natural look */
            .equalizer-bar:nth-child(1) { animation-delay: 0.1s; }
            .equalizer-bar:nth-child(2) { animation-delay: 0.3s; }
            .equalizer-bar:nth-child(3) { animation-delay: 0.5s; }
            .equalizer-bar:nth-child(4) { animation-delay: 0.7s; }
            .equalizer-bar:nth-child(5) { animation-delay: 0.9s; }
            .equalizer-bar:nth-child(6) { animation-delay: 0.7s; }
            .equalizer-bar:nth-child(7) { animation-delay: 0.5s; }
            .equalizer-bar:nth-child(8) { animation-delay: 0.3s; }
            .equalizer-bar:nth-child(9) { animation-delay: 0.1s; }
          `}</style>
        </div>
      ) : (
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
            transition: 'background 0.2s',
            width: '200px'
          }}
        >
          Log in with Yahoo
        </button>
      )}
    </div>
  );
}

// Main component with Suspense boundary
export default function Home() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
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
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
} 