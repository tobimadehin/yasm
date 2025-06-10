import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/**
 * YASM - Yet Another State Manager
 *
 * A lightweight caching solution for React with automatic persistence.
 * If you know useState, you know YASM.
 */

// ============================================================================
// Types
// ============================================================================

interface UseDataResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  clear: () => void;
  isFromCache: boolean;
}

type Fetcher<T> = () => Promise<T>;

interface UseDataOptions {
  storage?: YasmStore;
  suspense?: boolean;
  initialData?: any;
  revalidateOnFocus?: boolean;
  revalidateOnReconnect?: boolean;
  ttl?: number | string;
  refreshInterval?: number | string | false;
}

interface CacheItem<T> {
  data: T | undefined;
  lastAccess: number;
  ttl: number;
  expiresAt: number;
  hits: number;
  size: number;
  promise?: Promise<T>;
}

class ListNode {
  key: string;
  next: ListNode | null = null;
  prev: ListNode | null = null;

  constructor(key: string) {
    this.key = key;
  }
}

// Type guard to check if cache item has data
function hasData<T>(item: CacheItem<T>): item is CacheItem<T> & { data: T } {
  return item.data !== undefined;
}

// Type for cache stats
interface CacheStats {
  itemCount: number;
  totalSize: number;
  totalHits: number;
  averageSize: number;
  storageSupported: boolean;
  persistenceEnabled: boolean;
}

interface StorageOptions {
  prefix?: string;
  persist?: boolean;
  maxSize?: number;
  maxItemSize?: number; // Max size for individual items in bytes
}

// Export CacheItem type for advanced usage
interface CacheItemInfo<T> {
  data: T | undefined;
  timestamp: number;
  ttl: number;
  expiresAt: number;
  hits: number;
  lastAccess: number;
  size: number;
  hasPromise: boolean;
}

// ============================================================================
// Constants & Utilities
// ============================================================================

const TIME_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

// Simple configuration check
const isDebugMode = (): boolean => {
  try {
    // Check explicit configuration first
    if (globalConfig.debug === true) {
      return true;
    }
    if (globalConfig.debug === false) {
      return false;
    }

    // Auto-detect development environment (works with most bundlers)
    if (
      typeof process !== "undefined" &&
      process.env?.NODE_ENV === "development"
    ) {
      return true;
    }
    // Check for explicit browser debug flag override
    if (typeof window !== "undefined" && (window as any).__YASM_DEBUG__) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

// Global configuration
interface YasmConfig {
  isDevelopment: boolean;
  debug?: boolean;
}

const defaultConfig: YasmConfig = {
  isDevelopment: false,
};

let globalConfig = { ...defaultConfig };

export function configureYasm(config: Partial<YasmConfig>) {
  globalConfig = { ...globalConfig, ...config };
}

export function getYasmConfig(): YasmConfig {
  return { ...globalConfig };
}

export function parseTime(input: string | number): number {
  if (typeof input === "number") return input;

  const match = input.match(/^(\d+)([a-z]+)$/i);
  if (!match) throw new Error(`Invalid time format: ${input}`);

  const [, value, unit] = match;
  const multiplier = TIME_UNITS[unit.toLowerCase()];

  if (!multiplier) {
    throw new Error(`Unknown time unit: ${unit}`);
  }

  return parseInt(value) * multiplier;
}

// ============================================================================
// Storage Class
// ============================================================================

export class YasmStore {
  private activeRequests = new Map<string, Promise<any>>();
  private refreshIntervals = new Map<string, NodeJS.Timeout>();
  private cache: Map<string, CacheItem<any>>;
  private prefix: string;
  private persist: boolean;
  private maxSize: number;
  private maxItemSize: number;
  private isClient: boolean;
  private lruHead: ListNode | null = null;
  private lruTail: ListNode | null = null;
  private lruMap = new Map<string, ListNode>();
  private revalidationCallbacks = new Map<string, Set<() => void>>();
  private focusListener: (() => void) | null = null;
  private onlineListener: (() => void) | null = null;

  constructor(options: StorageOptions = {}) {
    this.prefix = options.prefix || "yasm_";
    this.persist = options.persist ?? true;
    this.maxSize = options.maxSize || 100;
    this.maxItemSize = options.maxItemSize || 1024 * 1024; // 1MB default
    this.isClient =
      typeof window !== "undefined" && typeof localStorage !== "undefined";
    this.cache = new Map();

    if (this.persist && this.isClient) {
      this.loadFromStorage();
    }

    if (this.isClient) {
      this.setupGlobalListeners();
    }
  }

  private setupGlobalListeners(): void {
    if (this.focusListener || this.onlineListener) return;

    this.focusListener = () => {
      for (const callbacks of this.revalidationCallbacks.values()) {
        for (const callback of callbacks) {
          callback();
        }
      }
    };

    this.onlineListener = () => {
      for (const callbacks of this.revalidationCallbacks.values()) {
        for (const callback of callbacks) {
          callback();
        }
      }
    };

    window.addEventListener("focus", this.focusListener);
    window.addEventListener("online", this.onlineListener);
  }

  addRevalidationCallback(key: string, callback: () => void): void {
    if (!this.revalidationCallbacks.has(key)) {
      this.revalidationCallbacks.set(key, new Set());
    }
    this.revalidationCallbacks.get(key)!.add(callback);
  }

  removeRevalidationCallback(key: string, callback: () => void): void {
    const callbacks = this.revalidationCallbacks.get(key);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.revalidationCallbacks.delete(key);
      }
    }
  }

  private moveToHead(key: string) {
    const node = this.lruMap.get(key);
    if (!node || node === this.lruHead) return;

    // Remove from current position
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.lruTail) this.lruTail = node.prev;

    // Add to head
    node.next = this.lruHead;
    node.prev = null;
    if (this.lruHead) this.lruHead.prev = node;
    this.lruHead = node;
    if (!this.lruTail) this.lruTail = node;
  }

  private evictLRU(): void {
    if (!this.lruTail) return;

    // Remove tail node
    const keyToRemove = this.lruTail.key;
    this.remove(keyToRemove);
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key) as CacheItem<T> | undefined;
    if (!item) return null;

    const now = Date.now();
    if (now >= item.expiresAt) {
      this.remove(key);
      return null;
    }

    const throttleMs = isDebugMode() ? 0 : 5000;
    if (now - item.lastAccess > throttleMs) {
      item.hits++;
      item.lastAccess = now;
      this.saveToStorage(key, item);
    }

    this.moveToHead(key);

    return hasData(item) ? item.data : null;
  }

  set<T>(key: string, data: T, ttl: number | string): boolean {
    if (!key) return false;

    try {
      const parsedTTL = typeof ttl === "string" ? parseTime(ttl) : ttl;
      const now = Date.now();
      const size = this.estimateSize(data);

      if (size > this.maxItemSize) {
        if (isDebugMode()) {
          console.warn(
            `Cache item too large: ${key} (${Math.round(size / 1024)}KB)`
          );
        }
        return false;
      }

      const item: CacheItem<T> = {
        data,
        lastAccess: now,
        ttl: parsedTTL,
        expiresAt: now + parsedTTL,
        hits: 0,
        size,
      };

      if (!this.lruMap.has(key)) {
        // Add new node to head
        const node = new ListNode(key);
        this.lruMap.set(key, node);

        if (!this.lruHead) {
          this.lruHead = node;
          this.lruTail = node;
        } else {
          node.next = this.lruHead;
          this.lruHead.prev = node;
          this.lruHead = node;
        }

        // Evict if needed
        if (this.cache.size >= this.maxSize) {
          this.evictLRU();
        }
      } else {
        this.moveToHead(key);
      }

      this.cache.set(key, item as CacheItem<unknown>);
      this.saveToStorage(key, item);
      return true;
    } catch (error) {
      if (isDebugMode()) {
        console.warn("Failed to set cache item:", error);
      }
      return false;
    }
  }

  setRefreshInterval(key: string, interval: NodeJS.Timeout): void {
    this.clearRefreshInterval(key);
    this.refreshIntervals.set(key, interval);
  }

  clearRefreshInterval(key: string): void {
    const existing = this.refreshIntervals.get(key);
    if (existing) {
      clearInterval(existing);
      this.refreshIntervals.delete(key);
    }
  }

  getRefreshInterval(key: string): NodeJS.Timeout | undefined {
    return this.refreshIntervals.get(key);
  }

  clearAllRefreshIntervals(): void {
    for (const interval of this.refreshIntervals.values()) {
      clearInterval(interval);
    }
    this.refreshIntervals.clear();
  }

  remove(key: string): boolean {
    if (!key) return false;

    // Remove from LRU structures
    const node = this.lruMap.get(key);
    if (node) {
      if (node.prev) node.prev.next = node.next;
      if (node.next) node.next.prev = node.prev;
      if (node === this.lruHead) this.lruHead = node.next;
      if (node === this.lruTail) this.lruTail = node.prev;
      this.lruMap.delete(key);
    }

    this.cache.delete(key);
    this.activeRequests.delete(key);

    if (this.persist && this.isClient) {
      try {
        localStorage.removeItem(this.prefix + key);
      } catch (error) {
        if (isDebugMode()) {
          console.warn("LocalStorage remove failed:", error);
        }
      }
    }
    return true;
  }

  clear(pattern?: string): number {
    let removed = 0;

    if (pattern) {
      const regex = new RegExp(pattern);
      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          this.remove(key);
          removed++;
        }
      }
    } else {
      removed = this.cache.size;
      this.cache.clear();
      this.activeRequests.clear();
      this.clearAllRefreshIntervals();
      this.revalidationCallbacks.clear();

      if (this.isClient) {
        if (this.focusListener) {
          window.removeEventListener("focus", this.focusListener);
          this.focusListener = null;
        }
        if (this.onlineListener) {
          window.removeEventListener("online", this.onlineListener);
          this.onlineListener = null;
        }
      }

      if (this.persist && this.isClient) {
        try {
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(this.prefix)) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach((key) => localStorage.removeItem(key));
        } catch (error) {
          if (isDebugMode()) {
            console.warn("LocalStorage clear failed:", error);
          }
        }
      }
    }

    return removed;
  }

  // Promise management for deduplication
  setPromise<T>(key: string, promise: Promise<T>, ttl: number | string): void {
    const item = this.cache.get(key) as CacheItem<T> | undefined;
    if (item) {
      item.promise = promise;
    } else {
      const parsedTTL = typeof ttl === "string" ? parseTime(ttl) : ttl;
      const now = Date.now();

      const newItem: CacheItem<T> = {
        data: undefined,
        lastAccess: now,
        ttl: parsedTTL,
        expiresAt: now + parsedTTL,
        hits: 0,
        size: 0,
        promise,
      };

      this.cache.set(key, newItem as CacheItem<unknown>);
    }
  }

  getPromise<T>(key: string): Promise<T> | undefined {
    const item = this.cache.get(key) as CacheItem<T> | undefined;
    return item?.promise;
  }

  clearPromise(key: string): void {
    const item = this.cache.get(key);
    if (item && "promise" in item) {
      delete (item as any).promise;
    }
  }

  // Utility methods
  async preload<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number | string = "5m"
  ): Promise<T> {
    // Check for existing request
    if (this.hasActiveRequest(key)) {
      return this.getActiveRequest<T>(key)!;
    }

    const promise = fetcher();
    this.setActiveRequest(key, promise);
    this.setPromise(key, promise, ttl);

    try {
      const result = await promise;
      this.set(key, result, ttl);
      this.deleteActiveRequest(key);
      return result;
    } catch (error) {
      this.remove(key);
      this.deleteActiveRequest(key);
      throw error;
    }
  }

  getItemInfo<T = unknown>(key: string): CacheItemInfo<T> | null {
    const item = this.cache.get(key) as CacheItem<T> | undefined;
    if (!item) return null;

    // Return public info without exposing internal promise to protect data integrity
    return {
      data: item.data,
      timestamp: item.lastAccess,
      ttl: item.ttl,
      expiresAt: item.expiresAt,
      hits: item.hits,
      lastAccess: item.lastAccess,
      size: item.size,
      hasPromise: !!item.promise,
    };
  }

  getStats(): CacheStats {
    let totalSize = 0;
    let totalHits = 0;
    const itemCount = this.cache.size;

    for (const item of this.cache.values()) {
      totalSize += item.size;
      totalHits += item.hits;
    }

    return {
      itemCount,
      totalSize,
      totalHits,
      averageSize: itemCount > 0 ? totalSize / itemCount : 0,
      storageSupported: this.isClient,
      persistenceEnabled: this.persist,
    };
  }

  getKeys(): string[] {
    // Return all keys currently in the cache
    return Array.from(this.cache.keys());
  }

  hasActiveRequest(key: string): boolean {
    return this.activeRequests.has(key);
  }

  setActiveRequest<T>(key: string, promise: Promise<T>): void {
    this.activeRequests.set(key, promise);
  }

  getActiveRequest<T>(key: string): Promise<T> | undefined {
    return this.activeRequests.get(key) as Promise<T> | undefined;
  }

  deleteActiveRequest(key: string): void {
    this.activeRequests.delete(key);
  }

  // Private methods
  private loadFromStorage(): void {
    if (!this.isClient) return;

    try {
      const items: Array<{ key: string; lastAccess: number }> = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(this.prefix)) continue;

        const stored = localStorage.getItem(key);
        if (!stored) continue;

        try {
          const item = JSON.parse(stored) as CacheItem<unknown>;
          const cleanKey = key.replace(this.prefix, "");

          if (Date.now() < item.expiresAt) {
            this.cache.set(cleanKey, item);
            items.push({ key: cleanKey, lastAccess: item.lastAccess });
          } else {
            localStorage.removeItem(key);
          }
        } catch {}
      }

      // Sort items by lastAccess and rebuild LRU
      items.sort((a, b) => b.lastAccess - a.lastAccess);
      for (const { key } of items) {
        const node = new ListNode(key);
        this.lruMap.set(key, node);

        if (!this.lruHead) {
          this.lruHead = node;
          this.lruTail = node;
        } else {
          node.next = this.lruHead;
          this.lruHead.prev = node;
          this.lruHead = node;
        }
      }
    } catch {}
  }

  private saveToStorage<T>(key: string, item: CacheItem<T>): void {
    if (!this.persist || !this.isClient) return;

    try {
      const { promise, ...serializableItem } = item;
      localStorage.setItem(this.prefix + key, JSON.stringify(serializableItem));
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "QuotaExceededError"
      ) {
        this.evictLRU();
        try {
          const { promise, ...serializableItem } = item;
          localStorage.setItem(
            this.prefix + key,
            JSON.stringify(serializableItem)
          );
        } catch {}
      }
    }
  }

  private estimateSize(data: any): number {
    if (data === null || data === undefined) return 0;
    try {
      const serialized = JSON.stringify(data);
      // Account for UTF-16 encoding in JavaScript strings
      return serialized.length * 2;
    } catch (e) {
      if (isDebugMode()) {
        console.warn(
          "Failed to estimate size of cache item:",
          e instanceof Error ? e.message : "Unknown error",
          "\nThis may be due to circular references or non-serializable data."
        );
      }
      // Return a conservative estimate for non-serializable data
      return this.maxItemSize;
    }
  }
}

const defaultStore = new YasmStore();

// ============================================================================
// Main Hook
// ============================================================================

export function useData<T>(
  key: string,
  fetcher: Fetcher<T>,
  options: UseDataOptions = {}
): UseDataResult<T> {
  const {
    storage = defaultStore,
    suspense = false,
    initialData,
    revalidateOnFocus = true,
    revalidateOnReconnect = true,
    ttl,
    refreshInterval = false,
  } = options;

  // Parse TTL
  const ttlMs = useMemo(() => {
    if (ttl === undefined) return 5 * 60 * 1000; // Default 5 minutes
    try {
      return parseTime(ttl);
    } catch {
      return 5 * 60 * 1000; // Fallback to 5 minutes
    }
  }, [ttl]);

  // --- Suspense-compliant logic (runs during render) ---
  const cachedData = storage.get<T>(key);
  let pendingPromise = storage.getPromise<T>(key);

  // If we're in suspense mode and there's no cached data, we need to initiate the fetch
  if (suspense && !cachedData && key && fetcher) {
    if (!pendingPromise) {
      // Create and store the promise for suspense
      pendingPromise = fetcher().then(
        (result) => {
          if (result !== undefined) {
            storage.set(key, result, ttlMs);
          }
          storage.clearPromise(key); // Clear successful promise
          return result;
        },
        (error) => {
          // Store the error in a special error cache for suspense mode
          storage.set(`__error_${key}`, error, ttlMs);
          storage.clearPromise(key);
          // Re-throw to ensure the error boundary catches it
          throw error;
        }
      );
      storage.setPromise(key, pendingPromise, ttlMs);
    }

    // Check if there's a cached error for this key
    const cachedError = storage.get(`__error_${key}`);
    if (cachedError instanceof Error) {
      // Clear the error cache and throw the error
      storage.remove(`__error_${key}`);
      throw cachedError;
    }

    // In suspense mode, always throw the promise - React will handle it
    throw pendingPromise;
  }

  // State
  const [data, setData] = useState<T | undefined>(() =>
    initialData !== undefined ? initialData : cachedData || undefined
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isFromCache, setIsFromCache] = useState(!!cachedData);

  const mountedRef = useRef(true);

  // Parse refresh interval once
  const refreshMs = useMemo(() => {
    if (refreshInterval === false) return null;
    try {
      return parseTime(refreshInterval);
    } catch {
      return null;
    }
  }, [refreshInterval]);

  // Core fetcher with deduplication
  const executeFetch = useCallback(
    async (isBackgroundRefresh = false): Promise<T | undefined> => {
      if (!key || !fetcher) return undefined;

      // Check for existing request
      if (storage.hasActiveRequest(key)) {
        try {
          return await storage.getActiveRequest<T>(key);
        } catch (error) {
          const cached = storage.get<T>(key);
          if (cached) return cached;
          throw error;
        }
      }

      // Create new request
      const request = fetcher().then(
        (result) => {
          if (result !== undefined) {
            storage.set(key, result, ttlMs);
            if (mountedRef.current) {
              setData(result);
              setError(null);
              setIsFromCache(false);
            }
          }
          storage.deleteActiveRequest(key);
          return result;
        },
        (error) => {
          storage.deleteActiveRequest(key);
          if (mountedRef.current) {
            // Only set error if there's no cached data to show
            if (!storage.get(key)) {
              setError(error);
            }
          }
          // Re-throw to propagate the error for suspense or manual awaits
          throw error;
        }
      );

      storage.setActiveRequest(key, request);
      storage.setPromise(key, request, ttlMs); // Store promise for suspense
      return request;
    },
    [key, fetcher, ttlMs, storage]
  );

  // Initial load and suspense handling
  useEffect(() => {
    if (!key || !fetcher) {
      setData(initialData);
      setLoading(false);
      setError(null);
      return;
    }

    if (!cachedData) {
      const load = async () => {
        setLoading(true);
        setIsFromCache(false);

        try {
          const fresh = await executeFetch(false);
          if (mountedRef.current) {
            setData(fresh);
            setIsFromCache(false);
            setError(null);
          }
        } catch (err) {
          if (!mountedRef.current) return;

          const error = err instanceof Error ? err : new Error(String(err));

          if (suspense) {
            // In suspense mode, set the error for error boundaries to catch
            setError(error);
            return;
          }

          // When fetch fails, we use the stale cache if it exists
          const staleCache = storage.get<T>(key);
          if (staleCache) {
            setData(staleCache);
            setIsFromCache(true);
          }
          setError(error);
        } finally {
          if (mountedRef.current) {
            setLoading(false);
          }
        }
      };

      load().catch((err) => {
        // Prevent unhandled rejection warnings for non-suspense mode
        if (suspense) {
          throw err;
        }
      });
    }
  }, [key, cachedData, executeFetch, suspense]);

  // Auto-refresh
  useEffect(() => {
    if (!key || !refreshMs) return;

    let timeoutId: NodeJS.Timeout;
    storage.clearRefreshInterval(key);

    const refreshLoop = async () => {
      if (!mountedRef.current) return;

      try {
        const fresh = await executeFetch(true);
        if (mountedRef.current) {
          setData(fresh);
          setIsFromCache(false);
          setError(null);
          // Schedule next refresh only after successful completion
          timeoutId = setTimeout(refreshLoop, refreshMs);
          storage.setRefreshInterval(key, timeoutId);
        }
      } catch (err) {
        if (mountedRef.current && !suspense) {
          setError(err instanceof Error ? err : new Error(String(err)));
          // Even on error, continue the refresh loop
          timeoutId = setTimeout(refreshLoop, refreshMs);
          storage.setRefreshInterval(key, timeoutId);
        }
      }
    };

    // Start the first refresh cycle
    timeoutId = setTimeout(refreshLoop, refreshMs);
    storage.setRefreshInterval(key, timeoutId);

    return () => {
      clearTimeout(timeoutId);
      storage.clearRefreshInterval(key);
    };
  }, [key, refreshMs, executeFetch, suspense]);

  // Revalidation handlers
  useEffect(() => {
    if ((!revalidateOnFocus && !revalidateOnReconnect) || !key || !fetcher)
      return;

    const handleRevalidate = () => {
      executeFetch(true).then(
        (fresh) => {
          if (mountedRef.current) {
            setData(fresh);
            setIsFromCache(false);
            setError(null);
          }
        },
        () => {} // Ignore errors on revalidation
      );
    };

    storage.addRevalidationCallback(key, handleRevalidate);
    return () => storage.removeRevalidationCallback(key, handleRevalidate);
  }, [key, fetcher, executeFetch, revalidateOnFocus, revalidateOnReconnect]);

  // Manual controls
  const refresh = useCallback(async () => {
    if (!key || !fetcher) return;

    setLoading(true);
    setError(null);

    try {
      const fresh = await executeFetch(false);
      if (mountedRef.current) {
        setData(fresh);
        setIsFromCache(false);
      }
    } catch (err) {
      if (!mountedRef.current) return;

      const error = err instanceof Error ? err : new Error(String(err));
      if (suspense) throw error;

      const cached = storage.get<T>(key);
      if (cached) {
        setData(cached);
        setIsFromCache(true);
      }
      setError(error);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [key, fetcher, executeFetch, storage, suspense]);

  const clear = useCallback(() => {
    if (!key) return;
    storage.remove(key);
    setData(undefined);
    setIsFromCache(false);
    setError(null);
  }, [key, storage]);

  // Cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clean up any pending requests on unmount
      const request = storage.getActiveRequest(key);
      if (request) storage.deleteActiveRequest(key);

      const interval = storage.getRefreshInterval(key);
      if (interval) {
        clearInterval(interval);
        storage.clearRefreshInterval(key);
      }
    };
  }, [key]);

  return { data, loading, error, refresh, clear, isFromCache };
}

// ============================================================================
// Exports
// ============================================================================

export const yasmStore = defaultStore;

export const preload = <T>(
  key: string,
  fetcher: Fetcher<T>,
  ttl: number | string = "5m"
): Promise<T> => defaultStore.preload(key, fetcher, ttl);

export const clear = (pattern?: string): number => defaultStore.clear(pattern);

export const getStats = (): CacheStats => defaultStore.getStats();

export const getItemInfo = <T = unknown>(
  key: string
): CacheItemInfo<T> | null => defaultStore.getItemInfo<T>(key);

// Export types
export type {
  CacheItem as InternalCacheItem,
  CacheItemInfo,
  Fetcher,
  UseDataResult,
  UseDataOptions,
};
