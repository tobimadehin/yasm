/**
 * YASM - Yet Another State Manager
 *
 * Comprehensive type definitions for advanced data fetching patterns
 */

// Core hook result interface
export interface UseDataResult<T> {
  /** The cached or fetched data */
  data: T | undefined;
  /** Whether a fetch is currently in progress */
  loading: boolean;
  /** Any error that occurred during fetching */
  error: Error | null;
  /** Function to manually refresh the data */
  refresh: () => Promise<void>;
  /** Function to clear the cached data */
  clear: () => void;
  /** Whether the data came from cache */
  isFromCache: boolean;
}

// Fetcher function type - simple and flexible
export type Fetcher<T> = () => Promise<T>;

// Time interval type for human-readable durations
export type TimeInterval = string | number | false;

// Storage configuration options
export interface StorageOptions {
  /** Prefix for localStorage keys */
  prefix?: string;
  /** Enable/disable localStorage persistence */
  persist?: boolean;
  /** Maximum number of cached items */
  maxSize?: number;
}

// Hook configuration options
export interface UseDataOptions {
  /** Custom storage instance */
  storage?: any; // Avoid circular dependency
  /** Enable suspense mode (throw errors) */
  suspense?: boolean;
  /** Initial data before fetching */
  initialData?: any;
  /** Revalidate on window focus */
  revalidateOnFocus?: boolean;
  /** Revalidate on network reconnect */
  revalidateOnReconnect?: boolean;
}

// Cache statistics interface
export interface CacheStats {
  /** Number of cached items */
  itemCount: number;
  /** Total cache size in bytes */
  totalSize: number;
  /** Total cache hits */
  totalHits: number;
  /** Average item size */
  averageSize: number;
  /** Whether localStorage is supported */
  storageSupported: boolean;
  /** Whether persistence is enabled */
  persistenceEnabled: boolean;
}
