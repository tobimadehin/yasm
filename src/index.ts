/**
 * YASM - Yet Another State Manager
 * 
 * A lightweight caching solution for React with automatic persistence.
 * If you know useState, you know YASM.
 */

// YASM API
export { 
  useData, 
  preload, 
  clear,
  yasmStore,
  type UseDataResult,
  type Fetcher,
  type UseDataOptions,
} from "./core";
