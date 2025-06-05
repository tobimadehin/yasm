/**
 * YASM Persistence
 *
 * Enhanced persistence with localStorage/sessionStorage integration
 * and automatic fallback handling.
 */

import { useData, useCached, preload, clear } from "../core/use-data";
import { YasmStorage } from "../core/storage";
import type {
  UseDataResult,
  UseDataOptions,
  Fetcher,
  TimeInterval,
} from "../types";

// Storage type options
export type StorageType = "localStorage" | "sessionStorage" | "memory";

interface PersistenceOptions extends UseDataOptions {
  /** Storage type to use */
  storageType?: StorageType;
  /** Prefix for storage keys */
  prefix?: string;
  /** Maximum number of items to cache */
  maxSize?: number;
  /** Enable cross-tab synchronization */
  syncAcrossTabs?: boolean;
}

// Global storage instances for different types
const storageInstances = new Map<string, YasmStorage>();

function getStorageInstance(options: PersistenceOptions = {}): YasmStorage {
  const {
    storageType = "localStorage",
    prefix = "yasm_persist_",
    maxSize = 100,
  } = options;

  const key = `${storageType}_${prefix}_${maxSize}`;

  if (!storageInstances.has(key)) {
    const storage = new YasmStorage({
      prefix,
      persist: storageType !== "memory",
      maxSize,
    });

    // Override storage methods for sessionStorage
    if (storageType === "sessionStorage") {
      const originalStorage = storage as any;

      // Patch the storage methods to use sessionStorage
      originalStorage.isSupported = (() => {
        try {
          if (typeof sessionStorage === "undefined") return false;
          const test = "__yasm_session_test__";
          sessionStorage.setItem(test, test);
          sessionStorage.removeItem(test);
          return true;
        } catch {
          return false;
        }
      })();

      const originalSaveToStorage = originalStorage.saveToStorage;
      originalStorage.saveToStorage = function (key: string, item: any) {
        if (!this.persist || !this.isSupported) return;
        try {
          sessionStorage.setItem(this.buildKey(key), JSON.stringify(item));
        } catch (error) {
          // Handle storage quota
          console.warn("SessionStorage quota exceeded");
        }
      };

      const originalLoadFromStorage = originalStorage.loadFromStorage;
      originalStorage.loadFromStorage = function () {
        if (!this.isSupported) return;
        try {
          for (let i = 0; i < sessionStorage.length; i++) {
            const storageKey = sessionStorage.key(i);
            if (!storageKey?.startsWith(this.prefix)) continue;

            const key = storageKey.replace(this.prefix, "");
            const stored = sessionStorage.getItem(storageKey);
            if (!stored) continue;

            const item = JSON.parse(stored);
            const now = Date.now();

            if (now >= item.expiresAt) {
              sessionStorage.removeItem(storageKey);
              continue;
            }

            this.cache.set(key, item);
          }
        } catch (error) {
          console.warn("Failed to load from sessionStorage:", error);
        }
      };
    }

    storageInstances.set(key, storage);
  }

  return storageInstances.get(key)!;
}

/**
 * Enhanced useData hook with configurable persistence
 *
 * @param key - Cache key
 * @param fetcher - Data fetching function
 * @param refreshInterval - Auto-refresh interval
 * @param options - Persistence and configuration options
 */
export function usePersistentData<T>(
  key: string,
  fetcher: Fetcher<T>,
  refreshInterval: TimeInterval = false,
  options: PersistenceOptions = {}
): UseDataResult<T> {
  const storage = getStorageInstance(options);

  return useData(key, fetcher, refreshInterval, {
    ...options,
    storage,
  });
}

/**
 * Backward compatibility alias with persistence
 */
export function useCachedPersist<T>(
  key: string,
  fetcher: Fetcher<T>,
  ttl: TimeInterval = "5m",
  options: PersistenceOptions = {}
): UseDataResult<T> {
  return usePersistentData(key, fetcher, ttl, options);
}

/**
 * Configure persistence settings globally
 */
export function configurePersistence(options: {
  /** Default storage type */
  defaultStorageType?: StorageType;
  /** Default key prefix */
  prefix?: string;
  /** Default max cache size */
  maxSize?: number;
  /** Enable compression for large items */
  enableCompression?: boolean;
}) {
  // Store global config for new storage instances
  const globalConfig = { ...options };

  // Apply to future storage instances
  (globalThis as any).__yasmPersistConfig = globalConfig;

  console.log("YASM persistence configured:", globalConfig);
}

/**
 * Preload data with persistence
 */
export async function preloadPersistent<T>(
  key: string,
  fetcher: Fetcher<T>,
  ttl: TimeInterval = "5m",
  options: PersistenceOptions = {}
): Promise<T> {
  const storage = getStorageInstance(options);
  // Convert TimeInterval to number | string (preload doesn't support false)
  const normalizedTtl = ttl === false ? "5m" : ttl;
  return storage.preload(key, fetcher, normalizedTtl);
}

/**
 * Clear persistent cache
 */
export function clearPersistent(
  keyPattern?: string,
  options: PersistenceOptions = {}
): number {
  const storage = getStorageInstance(options);
  return storage.clear(keyPattern);
}

/**
 * Cross-tab synchronization using BroadcastChannel
 */
export function enableCrossTabSync(prefix = "yasm_sync_") {
  if (typeof BroadcastChannel === "undefined") {
    console.warn("BroadcastChannel not supported, cross-tab sync disabled");
    return;
  }

  const channel = new BroadcastChannel(prefix);

  channel.addEventListener("message", (event) => {
    const { type, key, data } = event.data;

    if (type === "cache_update") {
      // Update local cache when another tab updates
      storageInstances.forEach((storage) => {
        if (data) {
          storage.set(key, data.value, data.ttl);
        } else {
          storage.remove(key);
        }
      });
    }
  });

  // Broadcast cache updates to other tabs
  const originalSet = YasmStorage.prototype.set;
  YasmStorage.prototype.set = function (key, data, ttl) {
    const result = originalSet.call(this, key, data, ttl);
    if (result) {
      channel.postMessage({
        type: "cache_update",
        key,
        data: { value: data, ttl },
      });
    }
    return result;
  };

  const originalRemove = YasmStorage.prototype.remove;
  YasmStorage.prototype.remove = function (key) {
    const result = originalRemove.call(this, key);
    if (result) {
      channel.postMessage({
        type: "cache_update",
        key,
        data: null,
      });
    }
    return result;
  };

  return () => {
    channel.close();
    // Restore original methods
    YasmStorage.prototype.set = originalSet;
    YasmStorage.prototype.remove = originalRemove;
  };
}

/**
 * Get cache statistics for persistent storage
 */
export function getPersistentStats(options: PersistenceOptions = {}) {
  const storage = getStorageInstance(options);
  return storage.getStats();
}

// Export core functions with persistence defaults
export {
  useData as usePersistentDataCore,
  useCached as useCachedCore,
  preload as preloadCore,
  clear as clearCore,
} from "../core/use-data";
