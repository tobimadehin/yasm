/**
 * Simple Cache - Backward Compatibility Layer
 *
 * Provides the original simple API while using the enhanced storage system under the hood
 */

import { defaultStorage } from "./storage";

// Export the simple functions for backward compatibility
export function get<T>(key: string): T | undefined {
  return defaultStorage.get<T>(key) || undefined;
}

export function set<T>(key: string, data: T, ttl: number): void {
  defaultStorage.set(key, data, ttl);
}

export function setPromise(
  key: string,
  promise: Promise<any>,
  ttl: number
): void {
  defaultStorage.setPromise(key, promise, ttl);
}

export function getPromise(key: string): Promise<any> | undefined {
  return defaultStorage.getPromise(key);
}

export function clear(key?: string): void {
  defaultStorage.clear(key);
}

export function preloadData<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl = 300000
): Promise<T> {
  return defaultStorage.preload(key, fetcher, ttl);
}
