/**
 * Base transformer class for Yahoo Fantasy Sports API responses
 * Provides common utilities for parsing Yahoo's unique data structures
 */
export abstract class BaseYahooTransformer {
  /**
   * Helper to safely extract array element if it exists
   * @param arr Array to extract from
   * @param index Index to extract
   * @returns Element at index or undefined
   */
  protected static safeArrayElement<T>(arr: T[] | undefined, index: number): T | undefined {
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
  protected static getString(value: string[] | string | undefined): string | undefined {
    if (!value) return undefined;
    
    // Handle case where value is already a string (for flexibility)
    if (typeof value === 'string') return value;
    
    if (!Array.isArray(value) || value.length === 0) {
      return undefined;
    }
    return value[0];
  }
  
  /**
   * Helper to safely extract number value from Yahoo's array format
   * @param value Yahoo string array (e.g., ["123"])
   * @returns Number value or undefined
   */
  protected static getNumber(value: string[] | string | number | undefined): number | undefined {
    if (typeof value === 'number') return value;
    
    const str = this.getString(value as string[] | string | undefined);
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
  protected static getBoolean(value: string[] | string | boolean | undefined): boolean | undefined {
    if (typeof value === 'boolean') return value;
    
    const str = this.getString(value as string[] | string | undefined);
    if (str === undefined) {
      return undefined;
    }
    return str === '1' || str.toLowerCase() === 'true';
  }
  
  /**
   * Validate required fields and throw error if missing
   * @param data Object to validate
   * @param fields Required field names
   * @param context Context for error message
   */
  protected static validateRequired(data: any, fields: string[], context: string): void {
    const missing = fields.filter(field => !data[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required fields in ${context}: ${missing.join(', ')}`);
    }
  }
} 