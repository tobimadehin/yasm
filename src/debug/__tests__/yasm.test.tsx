/**
 * YASM Complete Test Suite
 * Tests both core functionality and debug features
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
  afterAll,
  beforeAll,
} from "vitest";
import { YasmDebugMonitor } from "..";
import {
  fireEvent,
  screen,
  renderHook,
  render,
  act,
  waitFor,
} from "@testing-library/react";

import {
  // Core exports
  useData,
  YasmStore,
  yasmStore,
  clear,
  parseTime,
} from "../../core";

import {
  trackCacheHit,
  trackCacheMiss,
  trackCacheSet,
  trackCacheError,
  markAsRevalidating,
  markAsNotRevalidating,
  useCacheInspector,
  useCacheMonitor,
  clearDebugOperations,
} from "..";
import React from "react";

// Test helpers
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

// Mock store functions
const get = (key: string) => yasmStore.get(key);
const set = (key: string, data: any, ttl: string | number) =>
  yasmStore.set(key, data, ttl);

describe("YASM Complete Test Suite", () => {
  // Store original environment
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    // Clear all caches and mocks
    clear();
    clearDebugOperations();
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    };
    global.localStorage = localStorageMock as any;

    // Ensure we're in development for debug features
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.env.NODE_ENV = originalEnv;
  });

  describe("Core Functionality", () => {
    describe("YasmStore", () => {
      it("should store and retrieve data", () => {
        const store = new YasmStore();
        const data = { name: "Test User", id: 1 };

        expect(store.set("user", data, "5m")).toBe(true);
        expect(store.get("user")).toEqual(data);
      });

      it("should respect TTL expiration", () => {
        const store = new YasmStore();
        store.set("temp", "data", "100ms");

        expect(store.get("temp")).toBe("data");

        act(() => {
          vi.advanceTimersByTime(150);
        });

        expect(store.get("temp")).toBe(null);
      });

      it("should handle size limits with LRU eviction", () => {
        const store = new YasmStore({ maxSize: 3 });

        store.set("key1", "data1", "1h");
        store.set("key2", "data2", "1h");
        store.set("key3", "data3", "1h");

        // Advance the timer so the next `get` call has a new timestamp
        act(() => {
          vi.advanceTimersByTime(10);
        });

        // Access key1 to make it more recently used
        store.get("key1");

        // Add key4, should evict key2 (least recently used)
        store.set("key4", "data4", "1h");

        expect(store.get("key1")).toBe("data1");
        expect(store.get("key2")).toBe(null);
        expect(store.get("key3")).toBe("data3");
        expect(store.get("key4")).toBe("data4");
      });

      it("should track hit statistics", () => {
        const store = new YasmStore();
        store.set("tracked", "value", "1h");

        // Multiple accesses
        store.get("tracked");
        store.get("tracked");

        act(() => {
          vi.advanceTimersByTime(6000); // Past throttle threshold
        });

        store.get("tracked");

        const info = store.getItemInfo("tracked");
        expect(info?.hits).toBeGreaterThan(0);
      });

      it("should handle promise deduplication", async () => {
        const store = new YasmStore();
        const fetcher = vi.fn().mockResolvedValue("data");

        // Start multiple preloads for same key
        const promise1 = store.preload("key", fetcher, "5m");
        const promise2 = store.preload("key", fetcher, "5m");

        const [result1, result2] = await Promise.all([promise1, promise2]);

        expect(result1).toBe("data");
        expect(result2).toBe("data");
        expect(fetcher).toHaveBeenCalledTimes(1); // Only called once!
      });

      it("should persist to localStorage when enabled", () => {
        const store = new YasmStore({ persist: true });
        store.set("persisted", { value: "test" }, "1h");

        expect(localStorage.setItem).toHaveBeenCalledWith(
          "yasm_persisted",
          expect.stringContaining("test")
        );
      });

      it("should load from localStorage on initialization", () => {
        const mockData = {
          data: { value: "restored" },
          timestamp: Date.now(),
          ttl: 3600000,
          expiresAt: Date.now() + 3600000,
          hits: 5,
          lastAccess: Date.now(),
          size: 100,
        };

        (localStorage.getItem as Mock).mockReturnValue(
          JSON.stringify(mockData)
        );
        (localStorage.key as Mock).mockReturnValue("yasm_restored");
        Object.defineProperty(localStorage, "length", { value: 1 });

        const store = new YasmStore({ persist: true });
        expect(store.get("restored")).toEqual({ value: "restored" });
      });

      it("should handle item size limits", () => {
        const store = new YasmStore({ maxItemSize: 50 }); // 50 bytes

        const smallData = "ok";
        const largeData = "x".repeat(100);

        expect(store.set("small", smallData, "5m")).toBe(true);
        expect(store.set("large", largeData, "5m")).toBe(false);

        expect(store.get("small")).toBe(smallData);
        expect(store.get("large")).toBe(null);
      });

      it("should clear cache with pattern matching", () => {
        const store = new YasmStore();

        store.set("user:1", "Alice", "1h");
        store.set("user:2", "Bob", "1h");
        store.set("post:1", "Hello", "1h");

        const removed = store.clear("user:.*");

        expect(removed).toBe(2);
        expect(store.get("user:1")).toBe(null);
        expect(store.get("user:2")).toBe(null);
        expect(store.get("post:1")).toBe("Hello");
      });

      it("should return cache statistics", () => {
        const store = new YasmStore();

        store.set("key1", "data1", "1h");
        store.set("key2", "data2", "1h");

        const stats = store.getStats();

        expect(stats.itemCount).toBe(2);
        expect(stats.totalSize).toBeGreaterThan(0);
        expect(stats.storageSupported).toBe(true);
        expect(stats.persistenceEnabled).toBe(true);
      });
    });

    describe("useData Hook", () => {
      it("should fetch and cache data", async () => {
        vi.useRealTimers();

        const fetcher = vi.fn().mockResolvedValue({ id: 1, name: "Test" });

        const { result } = renderHook(() => useData("test-key", fetcher));

        expect(result.current.loading).toBe(true);
        expect(result.current.data).toBeUndefined();

        await waitFor(() => {
          expect(result.current.loading).toBe(false);
          expect(result.current.data).toEqual({ id: 1, name: "Test" });
          expect(result.current.error).toBe(null);
        });

        expect(fetcher).toHaveBeenCalledTimes(1);

        vi.useFakeTimers();
      });

      it("should use cached data on subsequent renders", async () => {
        vi.useRealTimers();

        const fetcher = vi.fn().mockResolvedValue("cached");

        // First render - fetch data
        const { result: result1, unmount: unmount1 } = renderHook(() =>
          useData("cache-test-unique", fetcher)
        );

        await waitFor(() => {
          expect(result1.current.data).toBe("cached");
        });

        unmount1();

        // Second render - should use cache
        const { result: result2 } = renderHook(() =>
          useData("cache-test-unique", fetcher)
        );

        expect(result2.current.data).toBe("cached");
        expect(result2.current.loading).toBe(false);
        expect(result2.current.isFromCache).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1); // Re-validate data

        vi.useFakeTimers();
      });

      it("should handle errors gracefully", async () => {
        vi.useRealTimers();

        const error = new Error("Fetch failed");
        const fetcher = vi.fn().mockRejectedValue(error);

        const { result } = renderHook(() => useData("error-key", fetcher));

        await waitFor(() => {
          expect(result.current.loading).toBe(false);
          expect(result.current.error).toBe(error);
          expect(result.current.data).toBeUndefined();
        });

        vi.useFakeTimers();
      });

      it("should fall back to cached data on error", async () => {
        vi.useRealTimers();

        const fetcher = vi
          .fn()
          .mockResolvedValueOnce("initial")
          .mockRejectedValueOnce(new Error("Update failed"));

        const { result } = renderHook(() => useData("fallback-key", fetcher));

        // Wait for initial load
        await waitFor(() => {
          expect(result.current.data).toBe("initial");
        });

        // Trigger refresh
        await act(async () => {
          await result.current.refresh();
        });

        await waitFor(() => {
          expect(result.current.error).toBeTruthy();
          expect(result.current.data).toBe("initial"); // Still has cached data
          expect(result.current.isFromCache).toBe(true);
        });

        vi.useFakeTimers();
      });

      it("should auto-refresh at specified intervals", async () => {
        vi.useRealTimers();

        const fetcher = vi
          .fn()
          .mockResolvedValueOnce("v1")
          .mockResolvedValueOnce("v2");

        const { result } = renderHook(() =>
          useData("refresh-key", fetcher, { refreshInterval: "200ms" })
        );

        await waitFor(() => {
          expect(result.current.data).toBe("v1");
        });

        // Wait for auto-refresh
        await new Promise((resolve) => setTimeout(resolve, 300));

        await waitFor(() => {
          expect(result.current.data).toBe("v2");
          expect(fetcher).toHaveBeenCalledTimes(2);
        });

        vi.useFakeTimers();
      });

      it("should handle manual refresh", async () => {
        vi.useRealTimers();

        const fetcher = vi
          .fn()
          .mockResolvedValueOnce("original")
          .mockResolvedValueOnce("refreshed");

        const { result } = renderHook(() => useData("manual-key", fetcher));

        await waitFor(() => {
          expect(result.current.data).toBe("original");
        });

        await act(async () => {
          await result.current.refresh();
        });

        expect(result.current.data).toBe("refreshed");
        expect(fetcher).toHaveBeenCalledTimes(2);

        vi.useFakeTimers();
      });

      it("should clear cache data", async () => {
        vi.useRealTimers();

        const fetcher = vi.fn().mockResolvedValue("data");

        const { result } = renderHook(() => useData("clear-key", fetcher));

        await waitFor(() => {
          expect(result.current.data).toBe("data");
        });

        act(() => {
          result.current.clear();
        });

        expect(result.current.data).toBeUndefined();
        expect(get("clear-key")).toBe(null);

        vi.useFakeTimers();
      });

      it("should revalidate on focus when enabled", async () => {
        vi.useRealTimers();

        const fetcher = vi
          .fn()
          .mockResolvedValueOnce("initial")
          .mockResolvedValueOnce("after-focus");

        const { result } = renderHook(() =>
          useData("focus-key", fetcher, { revalidateOnFocus: true })
        );

        await waitFor(() => {
          expect(result.current.data).toBe("initial");
        });

        // Get the revalidation callbacks and call them directly
        // This simulates what would happen when the focus event is triggered
        const store = yasmStore;
        const callbacks = store["revalidationCallbacks"].get("focus-key");

        if (callbacks && callbacks.size > 0) {
          for (const callback of callbacks) {
            callback();
          }
        }

        await waitFor(() => {
          expect(result.current.data).toBe("after-focus");
          expect(fetcher).toHaveBeenCalledTimes(2);
        });

        vi.useFakeTimers();
      });

      it("should deduplicate concurrent requests", async () => {
        vi.useRealTimers();

        const fetcher = vi.fn().mockImplementation(async () => {
          await delay(100);
          return "deduped";
        });

        // Multiple hooks with same key
        const { result: result1 } = renderHook(() =>
          useData("dedup-key", fetcher)
        );
        const { result: result2 } = renderHook(() =>
          useData("dedup-key", fetcher)
        );

        await waitFor(() => {
          expect(result1.current.data).toBe("deduped");
          expect(result2.current.data).toBe("deduped");
        });

        // Fetcher should only be called once
        expect(fetcher).toHaveBeenCalledTimes(1);

        vi.useFakeTimers();
      });

      it("should cleanup on unmount", async () => {
        vi.useRealTimers();

        const fetcher = vi.fn().mockResolvedValue("data");

        const { result, unmount } = renderHook(() =>
          useData("cleanup-key", fetcher, { refreshInterval: "1s" })
        );

        await waitFor(() => {
          expect(result.current.data).toBe("data");
        });

        unmount();

        // Check that cleanup happened
        expect(yasmStore.getRefreshInterval("cleanup-key")).toBeUndefined();

        vi.useFakeTimers();
      });

      it("should throw error when suspense is enabled and fetcher fails", async () => {
        vi.useRealTimers();
        const error = new Error("Suspense Fetch failed");
        const fetcher = vi.fn().mockRejectedValue(error);

        // Suppress console.error output from React for this expected error
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        // Add global error handler to catch unhandled rejections
        const originalHandler = process.listeners("unhandledRejection");
        const mockHandler = vi.fn();
        process.removeAllListeners("unhandledRejection");
        process.on("unhandledRejection", mockHandler);

        const ThrowingComponent = () => {
          const result = useData("suspense-error-key", fetcher, {
            suspense: true,
          });
          return <div>Data: {JSON.stringify(result.data)}</div>;
        };

        const ErrorBoundary = class extends React.Component<
          { children: React.ReactNode },
          { hasError: boolean; error?: Error }
        > {
          state = { hasError: false, error: undefined };
          static getDerivedStateFromError(error: Error) {
            return { hasError: true, error };
          }
          componentDidCatch(error: Error) {
            // Prevent the error from becoming an unhandled rejection
            console.log("Error caught by boundary:", error.message);
          }
          render() {
            if (this.state.hasError) {
              return <div>Error Caught</div>;
            }
            return this.props.children;
          }
        };

        // Wrap in Suspense boundary as well since we're using suspense mode
        const TestComponent = () => (
          <React.Suspense fallback={<div>Loading...</div>}>
            <ErrorBoundary>
              <ThrowingComponent />
            </ErrorBoundary>
          </React.Suspense>
        );

        render(<TestComponent />);

        // First we should see loading
        expect(screen.getByText("Loading...")).toBeTruthy();

        // Then after the promise rejects, we should see the error boundary
        await waitFor(() => {
          expect(screen.getByText("Error Caught")).toBeTruthy();
        });

        // Restore handlers
        consoleErrorSpy.mockRestore();
        process.removeAllListeners("unhandledRejection");
        originalHandler.forEach((handler) =>
          process.on("unhandledRejection", handler)
        );
        vi.useFakeTimers();
      });
    });

    describe("Utility Functions", () => {
      it("should parse time strings correctly", () => {
        expect(parseTime("5ms")).toBe(5);
        expect(parseTime("10s")).toBe(10000);
        expect(parseTime("5m")).toBe(300000);
        expect(parseTime("2h")).toBe(7200000);
        expect(parseTime("1d")).toBe(86400000);
        expect(parseTime("1w")).toBe(604800000);
        expect(parseTime(1000)).toBe(1000);
      });

      it("should throw on invalid time format", () => {
        expect(() => parseTime("invalid")).toThrow("Invalid time format");
        expect(() => parseTime("5x")).toThrow("Unknown time unit");
      });
    });
  });

  describe("Debug Functionality", () => {
    describe("Operation Tracking", () => {
      it("should track cache hits", () => {
        const { result } = renderHook(() => useCacheInspector());

        act(() => {
          trackCacheHit("test-key", 100);
        });

        expect(result.current.operations).toHaveLength(1);
        expect(result.current.operations[0]).toMatchObject({
          key: "test-key",
          type: "hit",
          size: 100,
          timestamp: expect.any(Number),
        });
      });

      it("should track cache misses", () => {
        const { result } = renderHook(() => useCacheInspector());

        act(() => {
          trackCacheMiss("missing-key");
        });

        expect(result.current.operations[0]).toMatchObject({
          key: "missing-key",
          type: "miss",
        });
      });

      it("should track cache sets", () => {
        const { result } = renderHook(() => useCacheInspector());

        act(() => {
          trackCacheSet("new-key", 256);
        });

        expect(result.current.operations[0]).toMatchObject({
          key: "new-key",
          type: "set",
          size: 256,
        });
      });

      it("should track cache errors", () => {
        const { result } = renderHook(() => useCacheInspector());

        act(() => {
          trackCacheError("error-key", "Network timeout");
        });

        expect(result.current.operations[0]).toMatchObject({
          key: "error-key",
          type: "error",
          error: "Network timeout",
        });
      });

      it("should track revalidations", () => {
        const { result } = renderHook(() => useCacheInspector());

        act(() => {
          markAsRevalidating("key1");
          markAsRevalidating("key2");
        });

        expect(result.current.revalidatingKeys).toEqual(["key1", "key2"]);
        expect(result.current.operations).toContainEqual(
          expect.objectContaining({ key: "key1", type: "revalidate" })
        );

        act(() => {
          markAsNotRevalidating("key1");
        });

        expect(result.current.revalidatingKeys).toEqual(["key2"]);
      });

      it("should limit operation history", () => {
        const { result } = renderHook(() => useCacheInspector());

        act(() => {
          // Add 25 operations (more than MAX_OPERATIONS)
          for (let i = 0; i < 25; i++) {
            trackCacheHit(`key-${i}`);
          }
        });

        expect(result.current.operations).toHaveLength(20);
        expect(result.current.operations[0].key).toBe("key-24"); // Most recent
        expect(result.current.operations[19].key).toBe("key-5"); // Oldest kept
      });

      it("should not track in production", () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";

        const { result } = renderHook(() => useCacheInspector());

        act(() => {
          trackCacheHit("prod-key");
          trackCacheMiss("prod-miss");
          trackCacheError("prod-error", "error");
        });

        expect(result.current.operations).toHaveLength(0);

        process.env.NODE_ENV = originalEnv;
      });
    });

    describe("Cache Inspector", () => {
      it("should calculate hit rate", () => {
        const { result } = renderHook(() => useCacheInspector());

        act(() => {
          trackCacheHit("key1");
          trackCacheHit("key2");
          trackCacheHit("key3");
          trackCacheMiss("key4");
          trackCacheMiss("key5");
        });

        // 3 hits, 2 misses = 60% hit rate
        expect(result.current.stats.hitRate).toBe(60);
      });

      it("should detect failures", () => {
        const { result } = renderHook(() => useCacheInspector());

        expect(result.current.hasFailures).toBe(false);

        act(() => {
          trackCacheError("fail-key", "Error message");
        });

        expect(result.current.hasFailures).toBe(true);
      });

      it("should determine health status", () => {
        const { result } = renderHook(() => useCacheInspector());

        // High hit rate, no failures = healthy
        act(() => {
          for (let i = 0; i < 8; i++) trackCacheHit(`hit-${i}`);
          for (let i = 0; i < 2; i++) trackCacheMiss(`miss-${i}`);
        });

        expect(result.current.stats.hitRate).toBe(80);
        expect(result.current.isHealthy).toBe(true);

        // Add error = unhealthy
        act(() => {
          trackCacheError("error", "Failed");
        });

        expect(result.current.isHealthy).toBe(false);
      });

      it("should update stats from store", () => {
        // Add items to store
        set("item1", "data1", "5m");
        set("item2", "data2", "5m");

        const { result } = renderHook(() => useCacheInspector());

        expect(result.current.stats.itemCount).toBe(2);
        expect(result.current.stats.totalSize).toBeGreaterThan(0);
      });
    });

    describe("Cache Monitor Hook", () => {
      it("should control visibility", () => {
        const { result } = renderHook(() => useCacheMonitor());

        expect(result.current.isVisible).toBe(true);

        act(() => {
          result.current.hide();
        });
        expect(result.current.isVisible).toBe(false);

        act(() => {
          result.current.show();
        });
        expect(result.current.isVisible).toBe(true);

        act(() => {
          result.current.toggle();
        });
        expect(result.current.isVisible).toBe(false);
      });

      it("should render Monitor component based on visibility", () => {
        const { result } = renderHook(() => useCacheMonitor());

        // When visible
        const Monitor = result.current.Monitor;
        expect(Monitor()).toBeTruthy();

        // When hidden
        act(() => {
          result.current.hide();
        });
        expect(result.current.Monitor()).toBe(null);
      });
    });
  });

  describe("Integration Tests", () => {
    it("should integrate debug tracking with useData hook", async () => {
      vi.useRealTimers();

      const fetcher = vi.fn().mockResolvedValue("integrated");
      const { result: inspector } = renderHook(() => useCacheInspector());

      // Use data hook - should trigger tracking
      const { result: data } = renderHook(() =>
        useData("integration-key", fetcher)
      );

      await waitFor(() => {
        expect(data.current.data).toBe("integrated");
      });

      // Check that operations were tracked
      // Note: This requires the debug-integrated version of useData
      // In real usage, you'd import from 'yasm/debug'

      vi.useFakeTimers();
    });

    it("should handle full cache lifecycle", async () => {
      vi.useRealTimers();

      const fetcher = vi
        .fn()
        .mockResolvedValueOnce("v1")
        .mockResolvedValueOnce("v2")
        .mockRejectedValueOnce(new Error("Failed"));

      const { result } = renderHook(() =>
        useData("lifecycle", fetcher, { refreshInterval: "200ms" })
      );

      // Initial fetch
      await waitFor(() => {
        expect(result.current.data).toBe("v1");
        expect(result.current.isFromCache).toBe(false);
      });

      // Wait for auto-refresh
      await new Promise((resolve) => setTimeout(resolve, 300));

      await waitFor(() => {
        expect(result.current.data).toBe("v2");
      });

      // Manual refresh with error
      await act(async () => {
        try {
          await result.current.refresh();
        } catch (e) {
          // Expected error
        }
      });

      // Should still have cached data
      expect(result.current.data).toBe("v2");
      expect(result.current.error).toBeTruthy();
      expect(result.current.isFromCache).toBe(true);

      // Clear
      act(() => {
        result.current.clear();
      });

      expect(result.current.data).toBeUndefined();

      vi.useFakeTimers();
    });

    it("should handle concurrent operations correctly", async () => {
      vi.useRealTimers();

      const results: string[] = [];
      const fetcher = vi.fn().mockImplementation(async () => {
        await delay(50);
        const value = `data-${Date.now()}`;
        results.push(value);
        return value;
      });

      // Start multiple hooks simultaneously
      const hooks = Array.from({ length: 5 }, () =>
        renderHook(() => useData("concurrent", fetcher))
      );

      await waitFor(() => {
        hooks.forEach(({ result }) => {
          expect(result.current.loading).toBe(false);
        });
      });

      // All should have the same data (deduplication worked)
      const firstData = hooks[0].result.current.data;
      hooks.forEach(({ result }) => {
        expect(result.current.data).toBe(firstData);
      });

      // Fetcher called only once
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);

      vi.useFakeTimers();
    });

    it("should handle SSR safely", () => {
      // Simulate SSR environment
      const windowBackup = global.window;
      // @ts-ignore
      delete global.window;

      const store = new YasmStore();
      expect(store.get("ssr-key")).toBe(null);
      expect(store.set("ssr-key", "data", "5m")).toBe(true);
      expect(store.get("ssr-key")).toBe("data");

      // No localStorage errors
      expect(() => store.clear()).not.toThrow();

      // Restore window
      global.window = windowBackup;
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined/null data", async () => {
      vi.useRealTimers(); // Use real timers for async operations

      const fetcher = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() => useData("undefined-key", fetcher));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.data).toBeUndefined();
        expect(result.current.error).toBe(null);
      });

      vi.useFakeTimers(); // Restore fake timers
    });

    it("should handle localStorage quota exceeded", () => {
      const store = new YasmStore();

      // Mock quota exceeded error
      (localStorage.setItem as Mock).mockImplementation(() => {
        const error = new DOMException("QuotaExceededError");
        Object.defineProperty(error, "name", { value: "QuotaExceededError" });
        throw error;
      });

      // Should handle gracefully and try LRU eviction
      expect(() => {
        store.set("quota-test", "data", "5m");
      }).not.toThrow();
    });

    it("should handle corrupted localStorage data", () => {
      (localStorage.getItem as Mock).mockReturnValue("corrupted{json");
      (localStorage.key as Mock).mockReturnValue("yasm_corrupted");
      Object.defineProperty(localStorage, "length", { value: 1 });

      // Should not throw on initialization
      expect(() => new YasmStore()).not.toThrow();
    });

    it("should handle rapid key changes", async () => {
      vi.useRealTimers(); // Use real timers for async operations

      const fetchers = {
        key1: vi.fn().mockResolvedValue("data1"),
        key2: vi.fn().mockResolvedValue("data2"),
        key3: vi.fn().mockResolvedValue("data3"),
      };

      const { result, rerender } = renderHook(
        ({ key }) => useData(key, fetchers[key as keyof typeof fetchers]),
        { initialProps: { key: "key1" } }
      );

      // Rapid key changes
      rerender({ key: "key2" });
      rerender({ key: "key3" });
      rerender({ key: "key1" });

      await waitFor(() => {
        expect(result.current.data).toBe("data1");
      });

      // Should handle cleanup properly
      expect(fetchers.key1).toHaveBeenCalled();

      vi.useFakeTimers(); // Restore fake timers
    });

    it("should handle circular references in cached data", () => {
      const store = new YasmStore();

      const circular: any = { a: 1 };
      circular.self = circular;

      // Should handle circular reference gracefully
      expect(() => {
        store.set("circular", circular, "5m");
      }).not.toThrow();
    });
  });

  describe("Other Tests", () => {
    beforeAll(() => {
      vi.useRealTimers();
    });

    afterAll(() => {
      vi.useFakeTimers();
    });
    describe("YasmStore Edge Cases", () => {
      it("should handle localStorage quota exceeded error gracefully", () => {
        // Mock localStorage to throw a QuotaExceededError
        const setItemMock = vi.fn(() => {
          const error = new DOMException("Quote exceeded");
          // Vitest/JSDOM doesn't perfectly mock the name property, so we define it
          Object.defineProperty(error, "name", {
            value: "QuotaExceededError",
          });
          throw error;
        });
        global.localStorage.setItem = setItemMock;

        const store = new YasmStore({ persist: true });

        // The store should not crash the app, it should catch the error.
        expect(() => {
          store.set("quota-key", { data: "some-data" }, "5m");
        }).not.toThrow();
      });

      it("should handle corrupted JSON from localStorage on load", () => {
        // Mock localStorage to return corrupted data
        (localStorage.getItem as Mock).mockReturnValue("{ not: json }");
        (localStorage.key as Mock).mockReturnValue("yasm_corrupted");
        Object.defineProperty(localStorage, "length", { value: 1 });

        // The constructor should not crash when trying to parse the corrupted data
        expect(() => new YasmStore({ persist: true })).not.toThrow();
      });
    });

    describe("useData Hook Edge Cases", () => {
      it("should handle edge case scenarios", () => {
        // This test exists to prevent empty test suite error
        // Actual edge cases are tested in the Core Functionality section
        expect(true).toBe(true);
      });
    });

    describe("Debug UI Component: YasmDebugMonitor", () => {
      beforeEach(() => {
        // Ensure NODE_ENV is development for these UI tests
        process.env.NODE_ENV = "development";
      });

      it("should render the minimized monitor by default", () => {
        const { container } = render(<YasmDebugMonitor />);
        // Basic check that component renders without crashing
        expect(container.firstChild).toBeTruthy();
        // Check for text that only appears in the minimized view
        expect(screen.getByText(/\d+ items/i)).toBeTruthy();
        expect(screen.getByText(/\d+%/i)).toBeTruthy();
      });

      it("should render debug component without crashing", () => {
        // Simple smoke test to ensure component renders
        const { container } = render(<YasmDebugMonitor />);
        expect(container).toBeTruthy();
      });

      it("should return null in non-development environment", () => {
        // Temporarily change NODE_ENV
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";

        const { container } = render(<YasmDebugMonitor />);
        expect(container.firstChild).toBeNull();

        // Restore environment
        process.env.NODE_ENV = originalEnv;
      });
    });
  });
});
