"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AdminPage() {
  const router = useRouter();
  const [cacheStats, setCacheStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRecentKeys, setShowRecentKeys] = useState(false);

  useEffect(() => {
    // Check if user is authenticated before showing admin page
    if (typeof document !== 'undefined' && !document.cookie.includes('yahoo_client_access_token')) {
      router.push('/');
      return;
    }

    // Fetch cache statistics
    fetchCacheStats();
  }, [router]);

  const fetchCacheStats = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/cache-stats');
      if (!response.ok) {
        throw new Error('Failed to fetch cache statistics');
      }
      const data = await response.json();
      setCacheStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const clearCacheByCategory = async (category: string) => {
    try {
      const response = await fetch('/api/admin/cache-clear', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ category }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to clear ${category} cache`);
      }
      
      // Refresh stats after clearing
      fetchCacheStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const clearAllCache = async () => {
    try {
      const response = await fetch('/api/admin/cache-clear-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to clear all cache');
      }
      
      // Refresh stats after clearing
      fetchCacheStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="py-4 px-6 bg-white shadow-md">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-800">Admin Console</h1>
          <Link 
            href="/dashboard" 
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
      
      <div className="container mx-auto py-8 px-4">
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Cache Monitoring</h2>
          
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}
          
          {loading ? (
            <div className="flex justify-center items-center h-40">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
            </div>
          ) : cacheStats ? (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {/* Summary Cards */}
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                  <h3 className="text-sm font-medium text-blue-800 uppercase">Total Keys</h3>
                  <p className="text-2xl font-bold">{cacheStats.totalKeys || 0}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                  <h3 className="text-sm font-medium text-green-800 uppercase">Memory Usage</h3>
                  <p className="text-2xl font-bold">{cacheStats.memoryUsage || '0 MB'}</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
                  <h3 className="text-sm font-medium text-purple-800 uppercase">Hit Rate</h3>
                  <p className="text-2xl font-bold">{cacheStats.hitRate || '0%'}</p>
                </div>
              </div>
              
              {/* Cache Categories */}
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-medium">Cache Categories</h3>
                <button
                  onClick={clearAllCache}
                  className={`px-3 py-1 rounded text-sm ${
                    cacheStats?.totalKeys > 0 
                      ? "bg-blue-600 text-white hover:bg-blue-700" 
                      : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}
                  disabled={!cacheStats?.totalKeys || cacheStats.totalKeys === 0}
                >
                  Clear All Cache
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Key Count
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        TTL
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {cacheStats.categories ? (
                      Object.entries(cacheStats.categories).map(([category, data]: [string, any]) => (
                        <tr key={category}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{category}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">{data.count || 0}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">{data.ttl || 'N/A'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <button
                              onClick={() => clearCacheByCategory(category)}
                              className={`px-3 py-1 rounded text-sm ${
                                data.count > 0 
                                  ? "bg-blue-600 text-white hover:bg-blue-700" 
                                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
                              }`}
                              disabled={data.count === 0}
                            >
                              Clear
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-4 text-center text-sm text-gray-500">
                          No category data available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* Cache Keys Table - Optional, could be too large */}
              {cacheStats.keys && cacheStats.keys.length > 0 && (
                <>
                  <div className="flex justify-between items-center my-4">
                    <h3 className="text-lg font-medium">Recent Keys</h3>
                    <button 
                      onClick={() => setShowRecentKeys(!showRecentKeys)} 
                      className="text-sm px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded flex items-center"
                    >
                      {showRecentKeys ? 'Hide' : 'Show'} 
                      <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ml-1 transition-transform ${showRecentKeys ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  
                  {showRecentKeys && (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Key
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Category
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              TTL
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {cacheStats.keys.slice(0, 20).map((key: any) => ( // Show only recent 20 keys
                            <tr key={key.name}>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900 font-mono">{key.name}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-500">{key.category || 'N/A'}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-500">{key.ttl || 'N/A'}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No cache statistics available
            </div>
          )}
          
          <div className="mt-4 flex justify-end space-x-3">
            <button
              onClick={fetchCacheStats}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 