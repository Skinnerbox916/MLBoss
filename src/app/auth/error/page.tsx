'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const yahooError = searchParams.get('yahoo_error');
  const yahooDescription = searchParams.get('yahoo_description');

  const getErrorDetails = () => {
    switch (error) {
      case 'oauth_error':
        return {
          title: 'Yahoo Authentication Error',
          message: 'There was an error with Yahoo\'s authentication service. Please try again.',
          suggestion: 'This could be a temporary issue with Yahoo\'s servers.'
        };
      case 'missing_parameters':
        return {
          title: 'Authentication Failed',
          message: 'Required authentication parameters were missing.',
          suggestion: 'Please start the sign-in process again.'
        };
      case 'invalid_state':
        return {
          title: 'Security Validation Failed',
          message: 'The authentication request could not be validated for security reasons.',
          suggestion: 'This may happen if you took too long to complete the sign-in process.'
        };
      case 'token_expired':
        return {
          title: 'Session Expired',
          message: 'Your authentication session has expired.',
          suggestion: 'Please sign in again to continue.'
        };
      case 'yahoo_oauth_error':
        return {
          title: 'Yahoo OAuth Error',
          message: 'Yahoo reported an error during authentication.',
          suggestion: 'Please check your Yahoo account status and try again.'
        };
      case 'token_exchange_failed':
        return {
          title: 'Token Exchange Failed',
          message: 'Unable to complete the authentication process with Yahoo.',
          suggestion: 'This is usually a temporary issue. Please try signing in again.'
        };
      case 'user_info_failed':
        return {
          title: 'Profile Access Error',
          message: 'Unable to retrieve your profile information from Yahoo.',
          suggestion: 'Please ensure your Yahoo account has the necessary permissions.'
        };
      case 'rate_limit':
        return {
          title: 'Too Many Requests',
          message: 'Too many authentication attempts. Please wait a moment.',
          suggestion: 'Try again in a few minutes.'
        };
      default:
        return {
          title: 'Authentication Error',
          message: 'An unexpected error occurred during sign-in.',
          suggestion: 'Please try signing in again or contact support if the issue persists.'
        };
    }
  };

  const errorDetails = getErrorDetails();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-surface-muted py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto h-12 w-auto flex items-center justify-center">
            <div className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              MLBoss
            </div>
          </div>
          <div className="mt-6">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-error-100 dark:bg-error-900/20">
              <svg className="h-8 w-8 text-error dark:text-error-light" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
            {errorDetails.title}
          </h2>
        </div>

        {/* Error Card */}
        <div className="bg-surface shadow-xl rounded-xl border border-border px-8 py-8">
          <div className="space-y-6">
            {/* Error Message */}
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-3">
                {errorDetails.message}
              </p>
              <p className="text-xs text-muted-foreground">
                {errorDetails.suggestion}
              </p>
            </div>

            {/* Error Code */}
            {error && (
              <div className="bg-primary-50 dark:bg-primary-700 rounded-lg p-3 space-y-2">
                <p className="text-xs text-muted-foreground text-center">
                  Error Code: <span className="font-mono text-error dark:text-error-light">{error}</span>
                </p>
                {yahooError && (
                  <p className="text-xs text-muted-foreground text-center">
                    Yahoo Error: <span className="font-mono text-error dark:text-error-light">{yahooError}</span>
                  </p>
                )}
                {yahooDescription && (
                  <p className="text-xs text-muted-foreground text-center">
                    Details: <span className="font-mono text-error dark:text-error-light">{yahooDescription}</span>
                  </p>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="space-y-3">
              <Link
                href="/"
                className="w-full flex justify-center items-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-gradient-to-r from-primary to-accent hover:from-primary-600 hover:to-accent-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring focus:ring-offset-background transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                Try Sign In Again
              </Link>
            </div>
          </div>
        </div>

        {/* Support Info */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground">
            If you continue to experience issues, please contact support
          </p>
        </div>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-surface-muted">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
        <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <AuthErrorContent />
    </Suspense>
  );
} 