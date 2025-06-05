/**
 * YASM Debug Tools - Lightweight & Production-Ready
 *
 * Minimal debug tools that actually integrate with the cache and provide
 * real metrics. Automatically tree-shaken in production builds.
 */

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { defaultStorage } from "../core/storage";

// Development-only check
const isDev =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

// Lightweight operation tracking
interface CacheOperation {
  key: string;
  type: "hit" | "miss" | "set" | "error" | "revalidate";
  timestamp: number;
  size?: number;
  error?: string;
}

interface DebugState {
  operations: CacheOperation[];
  revalidatingKeys: Set<string>;
  listeners: Set<() => void>;
}

// Global debug state
const debugState: DebugState = {
  operations: [],
  revalidatingKeys: new Set(),
  listeners: new Set(),
};

// Track operations (called from useData hook)
export function trackCacheHit(key: string, size: number = 0): void {
  if (!isDev) return;
  addOperation({ key, type: "hit", timestamp: Date.now(), size });
}

export function trackCacheMiss(key: string): void {
  if (!isDev) return;
  addOperation({ key, type: "miss", timestamp: Date.now() });
}

export function trackCacheSet(key: string, size: number = 0): void {
  if (!isDev) return;
  addOperation({ key, type: "set", timestamp: Date.now(), size });
}

export function trackCacheError(key: string, error: string): void {
  if (!isDev) return;
  addOperation({ key, type: "error", timestamp: Date.now(), error });
}

export function markAsRevalidating(key: string): void {
  if (!isDev) return;
  debugState.revalidatingKeys.add(key);
  addOperation({ key, type: "revalidate", timestamp: Date.now() });
  notifyListeners();
}

export function markAsNotRevalidating(key: string): void {
  if (!isDev) return;
  debugState.revalidatingKeys.delete(key);
  notifyListeners();
}

function addOperation(operation: CacheOperation): void {
  debugState.operations.unshift(operation);
  // Keep only last 20 operations for performance
  if (debugState.operations.length > 20) {
    debugState.operations = debugState.operations.slice(0, 20);
  }
  notifyListeners();
}

function notifyListeners(): void {
  debugState.listeners.forEach((callback) => callback());
}

// Hook to access debug state
function useDebugState() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const callback = () => setTick((prev) => prev + 1);
    debugState.listeners.add(callback);
    return () => {
      debugState.listeners.delete(callback);
    };
  }, []);

  return {
    operations: debugState.operations,
    revalidatingKeys: Array.from(debugState.revalidatingKeys),
  };
}

// Get real cache statistics
function useCacheStats() {
  const [stats, setStats] = useState(() => {
    const storageStats = defaultStorage.getStats();
    return {
      ...storageStats,
      hitRate: 0,
    };
  });

  useEffect(() => {
    if (!isDev) return;

    const updateStats = () => {
      const storageStats = defaultStorage.getStats();

      // Calculate hit rate from recent operations
      const recentOps = debugState.operations.slice(0, 10);
      const hits = recentOps.filter((op) => op.type === "hit").length;
      const total = recentOps.filter(
        (op) => op.type === "hit" || op.type === "miss"
      ).length;
      const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;

      setStats({
        ...storageStats,
        hitRate,
      });
    };

    updateStats();
    const interval = setInterval(updateStats, 3000);
    return () => clearInterval(interval);
  }, []);

  return stats;
}

// Minimal debug monitor component
export function YasmDebugMonitor(): JSX.Element | null {
  if (!isDev) return null;

  const [isExpanded, setIsExpanded] = useState(false);
  const { operations, revalidatingKeys } = useDebugState();
  const stats = useCacheStats();

  const getStatusColor = () => {
    const recentErrors = operations
      .slice(0, 5)
      .filter((op) => op.type === "error");
    if (recentErrors.length > 2) return "#ef4444"; // red
    if (revalidatingKeys.length > 0) return "#3b82f6"; // blue
    if (stats.hitRate > 80) return "#10b981"; // green
    if (stats.hitRate > 50) return "#f59e0b"; // yellow
    return "#6b7280"; // gray
  };

  const clearOperations = useCallback(() => {
    debugState.operations.length = 0;
    notifyListeners();
  }, []);

  const clearCache = useCallback(() => {
    defaultStorage.clear();
  }, []);

  const getOperationColor = (type: string) => {
    switch (type) {
      case "hit":
        return "#10b981";
      case "miss":
        return "#f59e0b";
      case "set":
        return "#3b82f6";
      case "error":
        return "#ef4444";
      default:
        return "#6b7280";
    }
  };

  if (!isExpanded) {
    return (
      <div
        onClick={() => setIsExpanded(true)}
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          backgroundColor: getStatusColor(),
          color: "white",
          padding: "8px 12px",
          borderRadius: "6px",
          fontSize: "12px",
          fontFamily: "monospace",
          cursor: "pointer",
          zIndex: 9999,
          boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
        }}
      >
        📦 {stats.hitRate}% | {stats.itemCount} items
        {revalidatingKeys.length > 0 && ` | ↻ ${revalidatingKeys.length}`}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        width: "320px",
        maxHeight: "400px",
        backgroundColor: "white",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        boxShadow: "0 10px 15px rgba(0,0,0,0.1)",
        zIndex: 9999,
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid #e5e7eb",
          backgroundColor: "#f9fafb",
        }}
      >
        <div style={{ fontWeight: "600" }}>YASM Debug</div>
        <button
          onClick={() => setIsExpanded(false)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px",
          }}
        >
          ✕
        </button>
      </div>

      {/* Stats */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "4px",
          }}
        >
          <span>Hit Rate: {stats.hitRate}%</span>
          <span>Items: {stats.itemCount}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Size: {Math.round(stats.totalSize / 1024)}KB</span>
          <span>Storage: {stats.storageSupported ? "✓" : "✗"}</span>
        </div>
      </div>

      {/* Operations */}
      <div style={{ maxHeight: "200px", overflowY: "auto" }}>
        {operations.map((op, i) => (
          <div
            key={`${op.timestamp}-${i}`}
            style={{
              padding: "6px 12px",
              borderBottom:
                i < operations.length - 1 ? "1px solid #f3f4f6" : "none",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  display: "inline-block",
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: getOperationColor(op.type),
                }}
              />
              <span style={{ fontFamily: "monospace", fontSize: "11px" }}>
                {op.type.toUpperCase()}
              </span>
              <span
                style={{
                  color: "#6b7280",
                  maxWidth: "120px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {op.key}
              </span>
            </div>
            <span style={{ color: "#9ca3af", fontSize: "10px" }}>
              {new Date(op.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
        {operations.length === 0 && (
          <div
            style={{ padding: "20px", textAlign: "center", color: "#9ca3af" }}
          >
            No operations yet
          </div>
        )}
      </div>

      {/* Actions */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid #e5e7eb",
          display: "flex",
          gap: "8px",
        }}
      >
        <button
          onClick={clearOperations}
          style={{
            padding: "4px 8px",
            backgroundColor: "#f3f4f6",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "11px",
            flex: 1,
          }}
        >
          Clear Log
        </button>
        <button
          onClick={clearCache}
          style={{
            padding: "4px 8px",
            backgroundColor: "#f3f4f6",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "11px",
            flex: 1,
          }}
        >
          Clear Cache
        </button>
      </div>
    </div>
  );
}

// Programmatic debug hooks
export function useCacheMonitor() {
  const [isVisible, setIsVisible] = useState(false);

  const show = useCallback(() => setIsVisible(true), []);
  const hide = useCallback(() => setIsVisible(false), []);
  const toggle = useCallback(() => setIsVisible((prev) => !prev), []);

  const Monitor = useCallback(() => {
    return isVisible ? <YasmDebugMonitor /> : null;
  }, [isVisible]);

  return { show, hide, toggle, Monitor, isVisible };
}

export function useCacheInspector() {
  const { operations, revalidatingKeys } = useDebugState();
  const stats = useCacheStats();

  const hasFailures = operations.some((op) => op.type === "error");
  const isHealthy = stats.hitRate > 70 && !hasFailures;

  return {
    stats,
    operations,
    revalidatingKeys,
    hasFailures,
    isHealthy,
  };
}
