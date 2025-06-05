/**
 * YASM Storage - Unified cache storage with persistence
 *
 * Supports both in-memory and localStorage with automatic fallback,
 * hit tracking, size monitoring, and TTL management.
 */

// Time parsing utility for human-readable intervals
const TIME_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

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

interface CacheItem<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  expiresAt: number;
  hits: number;
  lastAccess: number;
  size: number;
  promise?: Promise<T>;
}

interface StorageOptions {
  prefix?: string;
  persist?: boolean;
  maxSize?: number;
}

export class YasmStorage {
  private cache = new Map<string, CacheItem>();
  private prefix: string;
  private persist: boolean;
  private maxSize: number;
  private isSupported: boolean;

  constructor(options: StorageOptions = {}) {
    this.prefix = options.prefix || "yasm_";
    this.persist = options.persist ?? true;
    this.maxSize = options.maxSize || 100; // Max number of items
    this.isSupported = this.checkStorageSupport();

    // Load existing data from localStorage on initialization
    if (this.persist && this.isSupported) {
      this.loadFromStorage();
    }
  }

  private checkStorageSupport(): boolean {
    try {
      if (typeof localStorage === "undefined") return false;

      const test = "__yasm_test__";
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  private buildKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private loadFromStorage(): void {
    if (!this.isSupported) return;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const storageKey = localStorage.key(i);
        if (!storageKey?.startsWith(this.prefix)) continue;

        const key = storageKey.replace(this.prefix, "");
        const stored = localStorage.getItem(storageKey);
        if (!stored) continue;

        const item = JSON.parse(stored) as CacheItem;
        const now = Date.now();

        // Remove expired items during load
        if (now >= item.expiresAt) {
          localStorage.removeItem(storageKey);
          continue;
        }

        this.cache.set(key, item);
      }
    } catch (error) {
      console.warn("Failed to load cache from localStorage:", error);
    }
  }

  private saveToStorage<T>(key: string, item: CacheItem<T>): void {
    if (!this.persist || !this.isSupported) return;

    try {
      localStorage.setItem(this.buildKey(key), JSON.stringify(item));
    } catch (error) {
      // Handle storage quota exceeded
      if (
        error instanceof DOMException &&
        error.name === "QuotaExceededError"
      ) {
        this.evictLRU();
        try {
          localStorage.setItem(this.buildKey(key), JSON.stringify(item));
        } catch {
          console.warn("Failed to save to localStorage after LRU eviction");
        }
      }
    }
  }

  private evictLRU(): void {
    // Remove least recently used items
    const items = Array.from(this.cache.entries()).sort(
      ([, a], [, b]) => a.lastAccess - b.lastAccess
    );

    const toRemove = Math.ceil(items.length * 0.25); // Remove 25% of items

    for (let i = 0; i < toRemove && items[i]; i++) {
      const [key] = items[i];
      this.remove(key);
    }
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;

    const now = Date.now();

    // Check expiration
    if (now >= item.expiresAt) {
      this.remove(key);
      return null;
    }

    // Update access stats (throttled to every 5 seconds)
    if (now - item.lastAccess > 5000) {
      item.hits++;
      item.lastAccess = now;
      this.saveToStorage(key, item);
    }

    return item.data;
  }

  set<T>(key: string, data: T, ttl: number | string): boolean {
    if (!key) return false;

    try {
      const parsedTTL = typeof ttl === "string" ? parseTime(ttl) : ttl;
      const now = Date.now();
      const size = JSON.stringify(data).length * 2; // Rough byte estimate

      const item: CacheItem<T> = {
        data,
        timestamp: now,
        ttl: parsedTTL,
        expiresAt: now + parsedTTL,
        hits: 0,
        lastAccess: now,
        size,
      };

      // Enforce max size limit
      if (this.cache.size >= this.maxSize) {
        this.evictLRU();
      }

      this.cache.set(key, item);
      this.saveToStorage(key, item);

      return true;
    } catch (error) {
      console.warn("Failed to set cache item:", error);
      return false;
    }
  }

  setPromise<T>(key: string, promise: Promise<T>, ttl: number | string): void {
    const item = this.cache.get(key);
    if (item) {
      item.promise = promise;
    } else {
      const parsedTTL = typeof ttl === "string" ? parseTime(ttl) : ttl;
      const now = Date.now();

      this.cache.set(key, {
        data: undefined,
        timestamp: now,
        ttl: parsedTTL,
        expiresAt: now + parsedTTL,
        hits: 0,
        lastAccess: now,
        size: 0,
        promise,
      });
    }
  }

  getPromise<T>(key: string): Promise<T> | undefined {
    return this.cache.get(key)?.promise;
  }

  remove(key: string): boolean {
    if (!key) return false;

    try {
      this.cache.delete(key);
      if (this.persist && this.isSupported) {
        localStorage.removeItem(this.buildKey(key));
      }
      return true;
    } catch {
      return false;
    }
  }

  clear(keyPattern?: string): number {
    let removed = 0;

    if (keyPattern) {
      // Remove keys matching pattern
      const regex = new RegExp(keyPattern);
      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          this.remove(key);
          removed++;
        }
      }
    } else {
      // Clear all
      removed = this.cache.size;
      this.cache.clear();

      if (this.persist && this.isSupported) {
        try {
          const keys = this.getCacheKeys();
          keys.forEach((key) => {
            localStorage.removeItem(this.buildKey(key));
          });
        } catch {
          // Ignore errors during clear
        }
      }
    }

    return removed;
  }

  getCacheKeys(): string[] {
    if (!this.isSupported) return Array.from(this.cache.keys());

    const keys: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(this.prefix)) {
          keys.push(key.replace(this.prefix, ""));
        }
      }
    } catch {
      // Fallback to in-memory keys
      return Array.from(this.cache.keys());
    }

    return keys;
  }

  getItemInfo(key: string): CacheItem | null {
    return this.cache.get(key) || null;
  }

  getStats() {
    const items = Array.from(this.cache.values());
    const totalSize = items.reduce((sum, item) => sum + item.size, 0);
    const totalHits = items.reduce((sum, item) => sum + item.hits, 0);

    return {
      itemCount: this.cache.size,
      totalSize,
      totalHits,
      averageSize: items.length > 0 ? totalSize / items.length : 0,
      storageSupported: this.isSupported,
      persistenceEnabled: this.persist,
    };
  }

  // Preload utility
  async preload<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number | string = "5m"
  ): Promise<T> {
    const promise = fetcher();
    this.setPromise(key, promise, ttl);

    try {
      const result = await promise;
      this.set(key, result, ttl);
      return result;
    } catch (error) {
      this.remove(key);
      throw error;
    }
  }
}

// Create default storage instance
export const defaultStorage = new YasmStorage();
