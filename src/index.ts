/**
 * YASM - "Yet Another State Manager"
 *
 * Enhanced with persistence, auto-refresh, and advanced caching patterns.
 * If you know useState, you know YASM.
 *
 * @example
 * ```tsx
 * import { useData } from 'yasm';
 *
 * function App() {
 *   const { data, loading } = useData('users', fetchUsers, '5m');
 *   return <div>{loading ? 'Loading...' : JSON.stringify(data)}</div>;
 * }
 * ```
 */

// Primary enhanced API
export { useData, useCached, preload, clear } from "./core/use-data";

// Storage management
export { YasmStorage, defaultStorage, parseTime } from "./core/storage";

// Types
export type {
  UseDataResult,
  Fetcher,
  TimeInterval,
  UseDataOptions,
  StorageOptions,
  CacheStats,
} from "./types";

// Backward compatibility - simple cache functions
export {
  get,
  set,
  getPromise,
  setPromise,
  preloadData,
} from "./core/simple-cache";
