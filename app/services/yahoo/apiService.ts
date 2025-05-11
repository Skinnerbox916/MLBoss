'use client';

import { fetchYahooApi } from '@/app/utils/yahoo-api-client';
import { YahooApiOptions, YahooBaseResponse } from '@/app/types/yahoo';

/**
 * Base URL for the Yahoo Fantasy Sports API
 */
const YAHOO_FANTASY_BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';

/**
 * Base service class for Yahoo Fantasy Sports API
 * Provides common functionality for all API services
 */
export class YahooApiService {
  /**
   * Make a GET request to the Yahoo Fantasy Sports API
   * @param resource API resource path
   * @param params URL parameters
   * @param options API options
   * @returns API response
   */
  protected async get<T extends YahooBaseResponse>(
    resource: string,
    params: Record<string, string> = {},
    options: YahooApiOptions = {}
  ): Promise<T> {
    // Build query string for parameters
    const queryString = this.buildQueryString(params);
    
    // Construct full URL
    const url = `${YAHOO_FANTASY_BASE_URL}${resource}${queryString}`;
    
    // Make API request
    return fetchYahooApi<T>(url, options);
  }
  
  /**
   * Build query string from parameters
   * @param params Key-value pairs for query parameters
   * @returns Formatted query string
   */
  private buildQueryString(params: Record<string, string>): string {
    // Add JSON format parameter by default
    const allParams = { ...params, format: 'json' };
    
    // Create query string
    const queryString = Object.entries(allParams)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    
    return queryString ? `?${queryString}` : '';
  }
  
  /**
   * Parse a response to extract fantasy content
   * This removes the outer shell of the response
   * @param response API response
   * @returns The fantasy_content object
   */
  protected extractContent<T>(response: YahooBaseResponse): T {
    return response.fantasy_content as unknown as T;
  }
  
  /**
   * Helper to safely extract array element if it exists
   * @param arr Array to extract from
   * @param index Index to extract
   * @returns Element at index or undefined
   */
  protected safeArrayElement<T>(arr: T[] | undefined, index: number): T | undefined {
    if (!arr || !Array.isArray(arr) || arr.length <= index) {
      return undefined;
    }
    return arr[index];
  }
  
  /**
   * Helper to safely extract string value from Yahoo's array format
   * @param value Yahoo string array (e.g., ["value"])
   * @returns String value or undefined
   */
  protected getString(value: string[] | undefined): string | undefined {
    if (!value || !Array.isArray(value) || value.length === 0) {
      return undefined;
    }
    return value[0];
  }
  
  /**
   * Helper to safely extract number value from Yahoo's array format
   * @param value Yahoo string array (e.g., ["123"])
   * @returns Number value or undefined
   */
  protected getNumber(value: string[] | undefined): number | undefined {
    const str = this.getString(value);
    if (str === undefined) {
      return undefined;
    }
    const num = Number(str);
    return isNaN(num) ? undefined : num;
  }
  
  /**
   * Helper to safely extract boolean value from Yahoo's array format
   * @param value Yahoo string array (e.g., ["1"])
   * @returns Boolean value or undefined
   */
  protected getBoolean(value: string[] | undefined): boolean | undefined {
    const str = this.getString(value);
    if (str === undefined) {
      return undefined;
    }
    return str === '1' || str.toLowerCase() === 'true';
  }
} 