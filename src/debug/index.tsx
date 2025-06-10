/**
 * YASM Debug Monitor - Development Tools
 *
 * Clean, minimal debug UI for cache inspection.
 * Automatically treeshaken in production builds.
 */

"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { yasmStore, getItemInfo, CacheItemInfo } from "../core";

// ============================================================================
// Types & Constants
// ============================================================================

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

const MAX_OPERATIONS = 20;
const ITEMS_PER_PAGE = 5;

// Global debug state
const debugState: DebugState = {
  operations: [],
  revalidatingKeys: new Set(),
  listeners: new Set(),
};

// ============================================================================
// Tracking Functions
// ============================================================================

export function trackCacheHit(key: string, size: number = 0): void {
  if (process.env.NODE_ENV !== "development") return;
  addOperation({ key, type: "hit", timestamp: Date.now(), size });
}

export function trackCacheMiss(key: string): void {
  if (process.env.NODE_ENV !== "development") return;
  addOperation({ key, type: "miss", timestamp: Date.now() });
}

export function trackCacheSet(key: string, size: number = 0): void {
  if (process.env.NODE_ENV !== "development") return;
  addOperation({ key, type: "set", timestamp: Date.now(), size });
}

export function trackCacheError(key: string, error: string): void {
  if (process.env.NODE_ENV !== "development") return;
  addOperation({ key, type: "error", timestamp: Date.now(), error });
}

export function markAsRevalidating(key: string): void {
  if (process.env.NODE_ENV !== "development") return;
  debugState.revalidatingKeys.add(key);
  addOperation({ key, type: "revalidate", timestamp: Date.now() });
  notifyListeners();
}

export function markAsNotRevalidating(key: string): void {
  if (process.env.NODE_ENV !== "development") return;
  debugState.revalidatingKeys.delete(key);
  notifyListeners();
}

export function clearDebugOperations(): void {
  debugState.operations.length = 0;
  debugState.revalidatingKeys.clear();
  notifyListeners();
}

// ============================================================================
// Internal Functions
// ============================================================================

function addOperation(operation: CacheOperation): void {
  debugState.operations.unshift(operation);
  if (debugState.operations.length > MAX_OPERATIONS) {
    debugState.operations.length = MAX_OPERATIONS;
  }
  notifyListeners();
}

function notifyListeners(): void {
  debugState.listeners.forEach((callback) => callback());
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "EXPIRED";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function getCountdownColor(ms: number): string {
  if (ms <= 0) return "#ef4444"; // red
  if (ms < 30000) return "#f59e0b"; // orange
  if (ms < 300000) return "#eab308"; // yellow
  return "#10b981"; // green
}

function getStatusColor(
  hitRate: number,
  hasErrors: boolean,
  isRevalidating: boolean
): string {
  if (hasErrors) return "#ef4444"; // red
  if (isRevalidating) return "#3b82f6"; // blue
  if (hitRate > 80) return "#10b981"; // green
  if (hitRate > 50) return "#f59e0b"; // yellow
  return "#6b7280"; // gray
}

// ============================================================================
// Hooks
// ============================================================================

function useDebugState() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const callback = () => forceUpdate((prev) => prev + 1);
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

function useCacheStats() {
  const [stats, setStats] = useState(() => {
    const storageStats = yasmStore.getStats();
    return { ...storageStats, hitRate: 0 };
  });

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const updateStats = () => {
      const storageStats = yasmStore.getStats();

      // Calculate hit rate from recent operations
      const recentOps = debugState.operations.slice(0, 10);
      const hits = recentOps.filter((op) => op.type === "hit").length;
      const misses = recentOps.filter((op) => op.type === "miss").length;
      const total = hits + misses;
      const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;

      setStats({ ...storageStats, hitRate });
    };

    // Listen to debug state changes
    const callback = () => updateStats();
    debugState.listeners.add(callback);

    updateStats();
    const interval = setInterval(updateStats, 1000);

    return () => {
      debugState.listeners.delete(callback);
      clearInterval(interval);
    };
  }, []);

  return stats;
}

// ============================================================================
// Components
// ============================================================================

interface CountdownProps {
  expiresAt: number;
}

function Countdown({ expiresAt }: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    const update = () => {
      const remaining = Math.max(0, expiresAt - Date.now());
      setTimeLeft(remaining);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return (
    <span
      style={{
        color: getCountdownColor(timeLeft),
        fontSize: "8px",
        fontWeight: "600",
      }}
    >
      {formatCountdown(timeLeft)}
    </span>
  );
}

interface CacheItemViewProps {
  cacheKey: string;
  item: CacheItemInfo<any>;
  isExpanded: boolean;
  onToggle: () => void;
}

function CacheItemView({
  cacheKey,
  item,
  isExpanded,
  onToggle,
}: CacheItemViewProps) {
  const isRevalidating = debugState.revalidatingKeys.has(cacheKey);
  const isExpired = Date.now() > item.expiresAt;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  return (
    <div
      style={{
        borderBottom: "1px solid #374151",
        backgroundColor: isExpired ? "rgba(239, 68, 68, 0.05)" : "transparent",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          backgroundColor: isExpanded ? "rgba(55, 65, 81, 0.3)" : "transparent",
        }}
        onClick={onToggle}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "2px",
            }}
          >
            <span
              style={{
                color: "#f3f4f6",
                fontSize: "10px",
                fontWeight: "600",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {cacheKey}
            </span>

            {isRevalidating && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  backgroundColor: "rgba(59, 130, 246, 0.2)",
                  border: "1px solid #3b82f6",
                  borderRadius: "2px",
                  padding: "1px 4px",
                  fontSize: "7px",
                  color: "#3b82f6",
                  fontWeight: "600",
                }}
              >
                <div
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor: "#3b82f6",
                    animation: "pulse 1s infinite",
                  }}
                />
                REVALIDATING
              </div>
            )}

            {isExpired && (
              <span
                style={{
                  backgroundColor: "rgba(239, 68, 68, 0.2)",
                  color: "#ef4444",
                  padding: "1px 4px",
                  borderRadius: "2px",
                  fontSize: "7px",
                  fontWeight: "600",
                }}
              >
                EXPIRED
              </span>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: "12px",
              fontSize: "8px",
              color: "#9ca3af",
            }}
          >
            <span>{formatBytes(item.size)}</span>
            <span>{item.hits} hits</span>
            <span>{formatTime(item.lastAccess)}</span>
            <Countdown expiresAt={item.expiresAt} />
          </div>
        </div>

        <div
          style={{
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            color: "#9ca3af",
            fontSize: "8px",
          }}
        >
          ▶
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && item.data !== undefined && (
        <div
          style={{
            padding: "0 12px 12px 12px",
            backgroundColor: "rgba(55, 65, 81, 0.2)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <span style={{ color: "#9ca3af", fontSize: "9px" }}>
              Data Preview:
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(JSON.stringify(item.data, null, 2));
              }}
              style={{
                background: "rgba(34, 197, 94, 0.1)",
                border: "1px solid #22c55e",
                borderRadius: "2px",
                color: "#22c55e",
                cursor: "pointer",
                fontSize: "7px",
                padding: "1px 4px",
              }}
            >
              Copy JSON
            </button>
          </div>
          <pre
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.3)",
              border: "1px solid #374151",
              borderRadius: "3px",
              color: "#e5e7eb",
              fontSize: "8px",
              lineHeight: "1.4",
              margin: 0,
              maxHeight: "200px",
              overflow: "auto",
              padding: "6px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {JSON.stringify(item.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export const YasmDebugMonitor: React.FC = () => {
  if (process.env.NODE_ENV !== "development") return null;

  const [isMinimized, setIsMinimized] = useState(true);
  const [showViewer, setShowViewer] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const { operations, revalidatingKeys } = useDebugState();
  const stats = useCacheStats();

  // Load cache items
  const [cacheItems, setCacheItems] = useState<
    Array<{ key: string; item: CacheItemInfo<any> }>
  >([]);

  useEffect(() => {
    if (!showViewer) return;

    const loadItems = () => {
      const keys = yasmStore.getKeys();
      const items = keys
        .map((key: string) => {
          const item = getItemInfo(key);
          return item ? { key, item } : null;
        })
        .filter(
          (item: unknown): item is { key: string; item: CacheItemInfo<any> } =>
            item !== null
        )
        .sort(
          (
            a: { item: { lastAccess: number } },
            b: { item: { lastAccess: number } }
          ) => b.item.lastAccess - a.item.lastAccess
        );

      setCacheItems(items);
    };

    // Load items immediately
    loadItems();

    // Subscribe to changes from the debug state
    debugState.listeners.add(loadItems);

    // On cleanup, remove the listener
    return () => {
      debugState.listeners.delete(loadItems);
    };
  }, [showViewer]);

  // Filter items
  const filteredItems = cacheItems.filter(({ key }) =>
    key.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);
  const paginatedItems = filteredItems.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );

  const toggleExpanded = (key: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const clearCache = () => {
    yasmStore.clear();
    clearDebugOperations();
  };

  const hasErrors = operations.some((op) => op.type === "error");
  const statusColor = getStatusColor(
    stats.hitRate,
    hasErrors,
    revalidatingKeys.length > 0
  );

  // Minimized view
  if (isMinimized) {
    return (
      <>
        <style>{`
          @keyframes pulse {
            0%,
            100% {
              opacity: 1;
            }
            50% {
              opacity: 0.5;
            }
          }
        `}</style>
        <div
          style={{
            position: "fixed",
            bottom: "16px",
            right: "16px",
            zIndex: 9999,
            backgroundColor: "rgba(0, 0, 0, 0.9)",
            border: "1px solid #374151",
            borderRadius: "8px",
            padding: "8px 12px",
            fontFamily: '"SF Mono", Monaco, Consolas, monospace',
            fontSize: "11px",
            color: "#e5e7eb",
            cursor: "pointer",
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
          onClick={() => setIsMinimized(false)}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: statusColor,
            }}
          />
          <span>{stats.hitRate}%</span>
          <span style={{ color: "#9ca3af" }}>|</span>
          <span>{stats.itemCount} items</span>
          {revalidatingKeys.length > 0 && (
            <>
              <span style={{ color: "#9ca3af" }}>|</span>
              <span style={{ color: "#3b82f6" }}>
                ↻ {revalidatingKeys.length}
              </span>
            </>
          )}
        </div>
      </>
    );
  }

  // Expanded view
  return (
    <>
      <style>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          bottom: "16px",
          right: "16px",
          zIndex: 9999,
          backgroundColor: "rgba(0, 0, 0, 0.9)",
          border: "1px solid #374151",
          borderRadius: "8px",
          padding: "12px",
          fontFamily: '"SF Mono", Monaco, Consolas, monospace',
          fontSize: "11px",
          color: "#e5e7eb",
          width: showViewer ? "600px" : "280px",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
          backdropFilter: "blur(8px)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: statusColor,
              }}
            />
            <span style={{ fontWeight: "600" }}>YASM Debug</span>
          </div>
          <button
            onClick={() => setIsMinimized(true)}
            style={{
              background: "none",
              border: "none",
              color: "#9ca3af",
              cursor: "pointer",
              fontSize: "14px",
              padding: "2px",
            }}
          >
            −
          </button>
        </div>

        {/* Stats Grid */}
        <style>{`
          .yasm-stats-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 12px;
          }
          @media (min-width: 400px) {
            .yasm-stats-row {
              display: flex;
              justify-content: space-between;
              gap: 8px;
              margin-bottom: 12px;
            }
          }
        `}</style>
        <div className="yasm-stats-row">
          <div>
            <div style={{ color: "#9ca3af", fontSize: "9px" }}>Size</div>
            <div style={{ fontSize: "14px", fontWeight: "600" }}>
              {formatBytes(stats.totalSize)}
            </div>
          </div>
          <div>
            <div style={{ color: "#9ca3af", fontSize: "9px" }}>Hit Rate</div>
            <div style={{ fontSize: "14px", fontWeight: "600" }}>
              {stats.hitRate}%
            </div>
          </div>
          <div>
            <div style={{ color: "#9ca3af", fontSize: "9px" }}>Items</div>
            <div style={{ fontSize: "14px", fontWeight: "600" }}>
              {stats.itemCount}
            </div>
          </div>
          <div>
            <div style={{ color: "#9ca3af", fontSize: "9px" }}>Storage</div>
            <div style={{ fontSize: "14px", fontWeight: "600" }}>
              {stats.storageSupported ? "✓" : "✗"}
            </div>
          </div>
        </div>

        {/* Recent Operations */}
        <div
          style={{
            borderTop: "1px solid #374151",
            paddingTop: "8px",
            marginBottom: "8px",
          }}
        >
          <div
            style={{ fontSize: "9px", color: "#9ca3af", marginBottom: "4px" }}
          >
            Recent Operations
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {operations.slice(0, 3).map((op, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <div
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor:
                      op.type === "hit"
                        ? "#10b981"
                        : op.type === "miss"
                        ? "#f59e0b"
                        : op.type === "error"
                        ? "#ef4444"
                        : "#3b82f6",
                  }}
                />
                <span style={{ fontSize: "9px", color: "#e5e7eb" }}>
                  {op.type.toUpperCase()}
                </span>
                <span
                  style={{
                    fontSize: "8px",
                    color: "#6b7280",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {op.key}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => setShowViewer(!showViewer)}
            style={{
              flex: 1,
              background: "rgba(59, 130, 246, 0.1)",
              border: "1px solid #3b82f6",
              borderRadius: "4px",
              color: "#3b82f6",
              cursor: "pointer",
              fontSize: "10px",
              padding: "6px",
              fontFamily: "inherit",
            }}
          >
            {showViewer ? "Hide" : "View"} Cache
          </button>
          <button
            onClick={clearCache}
            style={{
              flex: 1,
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid #ef4444",
              borderRadius: "4px",
              color: "#ef4444",
              cursor: "pointer",
              fontSize: "10px",
              padding: "6px",
              fontFamily: "inherit",
            }}
          >
            Clear Cache
          </button>
        </div>

        {/* Cache Viewer */}
        {showViewer && (
          <div style={{ marginTop: "12px" }}>
            <input
              type="text"
              placeholder="Search cache keys..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(0);
              }}
              style={{
                width: "100%",
                backgroundColor: "rgba(55, 65, 81, 0.5)",
                border: "1px solid #374151",
                borderRadius: "4px",
                color: "#e5e7eb",
                fontSize: "10px",
                padding: "6px",
                marginBottom: "8px",
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
              }}
            />

            <div
              style={{
                border: "1px solid #374151",
                borderRadius: "4px",
                maxHeight: "300px",
                overflow: "auto",
              }}
            >
              {paginatedItems.length === 0 ? (
                <div
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "#6b7280",
                    fontSize: "10px",
                  }}
                >
                  {cacheItems.length === 0
                    ? "No cache items"
                    : "No matching items"}
                </div>
              ) : (
                paginatedItems.map(({ key, item }) => (
                  <CacheItemView
                    key={key}
                    cacheKey={key}
                    item={item}
                    isExpanded={expandedItems.has(key)}
                    onToggle={() => toggleExpanded(key)}
                  />
                ))
              )}
            </div>

            {totalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "8px",
                  marginTop: "8px",
                  fontSize: "9px",
                }}
              >
                <button
                  onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                  disabled={currentPage === 0}
                  style={{
                    background: "rgba(55, 65, 81, 0.5)",
                    border: "1px solid #374151",
                    borderRadius: "2px",
                    color: currentPage === 0 ? "#6b7280" : "#e5e7eb",
                    cursor: currentPage === 0 ? "not-allowed" : "pointer",
                    fontSize: "8px",
                    padding: "2px 6px",
                  }}
                >
                  ← Prev
                </button>
                <span>
                  Page {currentPage + 1} of {totalPages}
                </span>
                <button
                  onClick={() =>
                    setCurrentPage(Math.min(totalPages - 1, currentPage + 1))
                  }
                  disabled={currentPage === totalPages - 1}
                  style={{
                    background: "rgba(55, 65, 81, 0.5)",
                    border: "1px solid #374151",
                    borderRadius: "2px",
                    color:
                      currentPage === totalPages - 1 ? "#6b7280" : "#e5e7eb",
                    cursor:
                      currentPage === totalPages - 1
                        ? "not-allowed"
                        : "pointer",
                    fontSize: "8px",
                    padding: "2px 6px",
                  }}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

// ============================================================================
// Public Hooks
// ============================================================================

export function useCacheMonitor() {
  const [isVisible, setIsVisible] = useState(true);

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
