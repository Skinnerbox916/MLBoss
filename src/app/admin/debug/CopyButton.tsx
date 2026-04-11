'use client';

import { useState } from 'react';

// Generic CopyButton so callers can preserve the type of `data`
export default function CopyButton<T = unknown>({
  data,
  className = '',
}: {
  data: T;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(data, null, 2),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`px-3 py-1 text-white text-sm rounded transition-colors ${
        copied 
          ? 'bg-green-600' 
          : 'bg-primary hover:bg-primary-600'
      } ${className}`}
    >
      {copied ? 'Copied!' : 'Copy JSON'}
    </button>
  );
} 