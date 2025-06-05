import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { defaultStorage, parseTime, YasmStorage } from "./storage";
import type { UseDataResult, Fetcher } from "../types";

// Global request tracking to prevent duplicate requests
const activeRequests = new Map<string, Promise<any>>();
const refreshIntervals = new Map<string, NodeJS.Timeout>();

// Debug tracking functions (development only)
let trackCacheHit: ((key: string, size?: number) => void) | undefined;
let trackCacheMiss: ((key: string) => void) | undefined;
let trackCacheSet: ((key: string, size?: number) => void) | undefined;
let trackCacheError: ((key: string, error: string) => void) | undefined;
let markAsRevalidating: ((key: string) => void) | undefined;
let markAsNotRevalidating: ((key: string) => void) | undefined;

// Lazy load debug functions only in development
if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
  try {
    const debugModule = require("../debug");
    trackCacheHit = debugModule.trackCacheHit;
    trackCacheMiss = debugModule.trackCacheMiss;
    trackCacheSet = debugModule.trackCacheSet;
    trackCacheError = debugModule.trackCacheError;
    markAsRevalidating = debugModule.markAsRevalidating;
    markAsNotRevalidating = debugModule.markAsNotRevalidating;
  } catch {
    // Debug module not available or failed to load
  }
}

interface UseDataOptions {
  /** Custom storage instance to use instead of default */
  storage?: YasmStorage;
  /** Whether to throw errors instead of returning them in the error state */
  suspense?: boolean;
  /** Initial data to use before fetching */
  initialData?: any;
  /** Enable/disable auto-refresh on window focus */
  revalidateOnFocus?: boolean;
  /** Enable/disable auto-refresh on network reconnect */
  revalidateOnReconnect?: boolean;
}

/**
 * Advanced data fetching hook with caching, persistence, and auto-refresh
 *
 * Features:
 * - Stale-while-revalidate pattern
 * - Request deduplication
 * - Automatic persistence with localStorage
 * - Auto-refresh with human-readable intervals
 * - Graceful error handling with cached fallbacks
 * - Network status awareness
 *
 * @param key - Unique cache key
 * @param fetcher - Function that returns a Promise
 * @param refreshInterval - Auto-refresh interval ('5m', '30s', etc.) or false to disable
 * @param options - Advanced configuration options
 */
export function useData<T>(
  key: string,
  fetcher: Fetcher<T>,
  refreshInterval: string | number | false = false,
  options: UseDataOptions = {}
): UseDataResult<T> {
  const {
    storage = defaultStorage,
    suspense = false,
    initialData,
    revalidateOnFocus = true,
    revalidateOnReconnect = true,
  } = options;

  const [data, setData] = useState<T | undefined>(() => {
    if (initialData !== undefined) return initialData;
    return storage.get<T>(key) || undefined;
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isFromCache, setIsFromCache] = useState(false);
  const mountedRef = useRef(true);

  // Parse refresh interval
  const refreshMs = useMemo(() => {
    if (refreshInterval === false) return null;
    try {
      return parseTime(refreshInterval);
    } catch {
      console.warn(`Invalid refresh interval: ${refreshInterval}`);
      return null;
    }
  }, [refreshInterval]);

  // Enhanced fetcher with deduplication and caching
  const enhancedFetcher = useCallback(
    async (isBackgroundRefresh = false): Promise<T | undefined> => {
      if (!key || !fetcher) return undefined;

      // Check for existing request to prevent duplicates
      const existingRequest = activeRequests.get(key);
      if (existingRequest) {
        try {
          return await existingRequest;
        } catch (error) {
          // If request fails, try to return cached data
          const cached = storage.get<T>(key);
          if (cached) {
            trackCacheHit?.(key, JSON.stringify(cached).length);
            return cached;
          }
          throw error;
        }
      }

      const requestPromise = (async (): Promise<T> => {
        try {
          markAsRevalidating?.(key);

          const result = await fetcher();

          if (result !== undefined) {
            // Cache the result if refresh interval is set
            if (refreshMs) {
              storage.set(key, result, refreshMs);
              trackCacheSet?.(key, JSON.stringify(result).length);
            }
          }

          return result;
        } finally {
          activeRequests.delete(key);
          markAsNotRevalidating?.(key);
        }
      })();

      activeRequests.set(key, requestPromise);
      return requestPromise;
    },
    [key, fetcher, refreshMs, storage]
  );

  // Initial data loading effect
  useEffect(() => {
    if (!key || !fetcher) {
      setData(initialData);
      setIsFromCache(false);
      setLoading(false);
      setError(null);
      return;
    }

    let isMounted = true;

    const loadData = async () => {
      // First, check for cached data
      const cached = storage.get<T>(key);
      if (cached && isMounted) {
        setData(cached);
        setIsFromCache(true);
        setLoading(false);
        setError(null);
        trackCacheHit?.(key, JSON.stringify(cached).length);
      } else {
        setLoading(true);
        setIsFromCache(false);
        trackCacheMiss?.(key);
      }

      try {
        // Fetch fresh data (in background if we have cached data)
        const freshData = await enhancedFetcher(!!cached);

        if (isMounted && freshData !== undefined) {
          setData(freshData);
          setIsFromCache(false);
          setError(null);
        }
      } catch (err) {
        if (!isMounted) return;

        const error = err instanceof Error ? err : new Error(String(err));
        trackCacheError?.(key, error.message);

        if (suspense) {
          throw error;
        }

        // If we have cached data, show it with the error
        if (cached) {
          setData(cached);
          setIsFromCache(true);
          setError(error);
        } else {
          setData(undefined);
          setIsFromCache(false);
          setError(error);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [key, fetcher, enhancedFetcher, storage, suspense, initialData]);

  // Auto-refresh effect
  useEffect(() => {
    if (!key || !refreshMs || refreshMs <= 0) {
      return;
    }

    // Clear any existing interval for this key
    const existingInterval = refreshIntervals.get(key);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    const interval = setInterval(async () => {
      if (!mountedRef.current) return;

      try {
        const freshData = await enhancedFetcher(true);
        if (mountedRef.current && freshData !== undefined) {
          setData(freshData);
          setIsFromCache(false);
          setError(null);
        }
      } catch (err) {
        if (mountedRef.current) {
          const error = err instanceof Error ? err : new Error(String(err));
          trackCacheError?.(key, error.message);

          if (!suspense) {
            setError(error);
          }
        }
      }
    }, refreshMs);

    refreshIntervals.set(key, interval);

    return () => {
      clearInterval(interval);
      refreshIntervals.delete(key);
    };
  }, [key, refreshMs, enhancedFetcher, suspense]);

  // Window focus revalidation
  useEffect(() => {
    if (!revalidateOnFocus || !key || !fetcher) return;

    const handleFocus = async () => {
      if (!mountedRef.current) return;

      try {
        const freshData = await enhancedFetcher(true);
        if (mountedRef.current && freshData !== undefined) {
          setData(freshData);
          setIsFromCache(false);
          setError(null);
        }
      } catch (err) {
        // Silently fail for focus revalidation
        if (mountedRef.current && !suspense) {
          const error = err instanceof Error ? err : new Error(String(err));
          trackCacheError?.(key, error.message);
        }
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [key, fetcher, enhancedFetcher, revalidateOnFocus, suspense]);

  // Network reconnect revalidation
  useEffect(() => {
    if (!revalidateOnReconnect || !key || !fetcher) return;

    const handleOnline = async () => {
      if (!mountedRef.current) return;

      try {
        const freshData = await enhancedFetcher(true);
        if (mountedRef.current && freshData !== undefined) {
          setData(freshData);
          setIsFromCache(false);
          setError(null);
        }
      } catch (err) {
        // Silently fail for reconnect revalidation
        if (mountedRef.current && !suspense) {
          const error = err instanceof Error ? err : new Error(String(err));
          trackCacheError?.(key, error.message);
        }
      }
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [key, fetcher, enhancedFetcher, revalidateOnReconnect, suspense]);

  // Manual refresh function
  const refresh = useCallback(async (): Promise<void> => {
    if (!key || !fetcher) return;

    setLoading(true);
    setError(null);

    try {
      const freshData = await enhancedFetcher(false);
      if (mountedRef.current && freshData !== undefined) {
        setData(freshData);
        setIsFromCache(false);
      }
    } catch (err) {
      if (!mountedRef.current) return;

      const error = err instanceof Error ? err : new Error(String(err));
      trackCacheError?.(key, error.message);

      if (suspense) {
        throw error;
      }

      // Try to fallback to cached data
      const cached = storage.get<T>(key);
      if (cached) {
        setData(cached);
        setIsFromCache(true);
        trackCacheHit?.(key, JSON.stringify(cached).length);
      }
      setError(error);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [key, fetcher, enhancedFetcher, storage, suspense]);

  // Clear cache function
  const clear = useCallback((): void => {
    if (!key) return;
    storage.remove(key);
    setData(undefined);
    setIsFromCache(false);
    setError(null);
  }, [key, storage]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    data,
    loading,
    error,
    refresh,
    clear,
    isFromCache,
  };
}

// Backward compatibility alias
export const useCached = useData;

// Preload function for eager loading
export async function preload<T>(
  key: string,
  fetcher: Fetcher<T>,
  ttl: number | string = "5m",
  storage: YasmStorage = defaultStorage
): Promise<T> {
  return storage.preload(key, fetcher, ttl);
}

// Clear cache function
export function clear(
  key?: string,
  storage: YasmStorage = defaultStorage
): number {
  return storage.clear(key);
}
