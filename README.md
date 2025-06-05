# YASM - Yet Another State Manager

YASM is a straightforward, lightweight state management library for React that simplifies data fetching and caching.

[![npm version](https://badge.fury.io/js/yasm.svg)](https://badge.fury.io/js/yasm)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg)](http://www.typescriptlang.org/)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/yasm)](https://bundlephobia.com/package/yasm)

## ⚡ What's is YASM

YASM is a complete rewrite inspired by real-world usage in high-frequency applications like trading dashboards and live data systems. It brings enterprise-grade features while maintaining the simplicity you love.

### 🎯 **Core Philosophy: "useState but better"**

```tsx
// Before: useState
const [user, setUser] = useState(null);
useEffect(() => { fetchUser().then(setUser) }, []);

// After: YASM
const { data: user } = useData('user', fetchUser, '5m');
```

## ✨ **Enhanced Features**

### 🔄 **Stale-While-Revalidate**
Show cached data instantly, fetch fresh data in background
```tsx
const { data, isFromCache } = useData('posts', fetchPosts, '30s');
// ✅ Instant loading with cached data
// ✅ Fresh data fetched in background
```

### 🎯 **Request Deduplication**
Multiple components requesting same data = single network request
```tsx
// Both components share the same request
function UserProfile() {
  const { data } = useData('user-123', () => fetchUser(123));
}
function UserBadge() {
  const { data } = useData('user-123', () => fetchUser(123)); // No duplicate request!
}
```

### 💾 **Smart Persistence**
Automatic localStorage/sessionStorage with graceful fallbacks
```tsx
import { usePersistentData } from 'yasm/persist';

const { data } = usePersistentData(
  'user-settings', 
  fetchSettings, 
  '1h',
  { storageType: 'localStorage' }
);
// ✅ Survives page refresh
// ✅ Cross-tab synchronization
// ✅ Automatic cleanup
```

### 🔥 **Auto-Refresh**
Human-readable intervals for real-time data
```tsx
const { data: metrics } = useData('dashboard', fetchMetrics, '10s');
const { data: prices } = useData('crypto-btc', fetchPrice, '1s');  // High frequency
const { data: news } = useData('news', fetchNews, '5m');           // Reasonable refresh
```

### 🛡️ **Graceful Error Handling**
Show cached data when requests fail
```tsx
const { data, error, isFromCache } = useData('api/data', fetcher);
// ✅ Network fails → shows cached data
// ✅ Displays error state 
// ✅ User can still interact with cached data
```

### 🐛 **Production-Ready Debug Tools**
Lightweight monitoring that tree-shakes in production
```tsx
import { YasmDebugMonitor } from 'yasm/debug';

function App() {
  return (
    <div>
      <YourApp />
      <YasmDebugMonitor /> {/* Only in development */}
    </div>
  );
}
```

## 📦 **Installation**

```bash
npm install yasm
# or
yarn add yasm
# or
pnpm add yasm
```

## 🚀 **Quick Start**

### Basic Usage
```tsx
import { useData } from 'yasm';

function UserProfile({ userId }) {
  const { 
    data: user,     // The fetched data
    loading,        // Loading state
    error,          // Error state  
    refresh,        // Manual refresh function
    isFromCache     // Whether data is from cache
  } = useData(
    `user-${userId}`,           // Cache key
    () => fetchUser(userId),    // Fetcher function
    '5m'                        // Auto-refresh every 5 minutes
  );

  if (loading && !user) return <Skeleton />;
  if (error && !user) return <Error error={error} />;

  return (
    <div>
      <h1>{user.name}</h1>
      {isFromCache && <Badge>Cached</Badge>}
      {error && <Warning>Using cached data</Warning>}
      <button onClick={refresh}>Refresh</button>
    </div>
  );
}
```

### Time Intervals
Human-readable format instead of milliseconds:
```tsx
useData('data', fetcher, '30s');  // 30 seconds
useData('data', fetcher, '5m');   // 5 minutes  
useData('data', fetcher, '2h');   // 2 hours
useData('data', fetcher, '1d');   // 1 day
useData('data', fetcher, false);  // No auto-refresh
```

### Advanced Options
```tsx
const { data } = useData('key', fetcher, '1m', {
  revalidateOnFocus: true,      // Refresh when window gains focus
  revalidateOnReconnect: true,  // Refresh when network reconnects
  suspense: false,              // Throw errors instead of returning them
  initialData: [],              // Initial data before first fetch
});
```

## 🏗️ **Real-World Examples**

### Trading Dashboard
```tsx
function TradingDashboard() {
  // High-frequency price updates
  const { data: prices } = useData('crypto-prices', fetchPrices, '1s');
  
  // Moderate frequency for portfolio
  const { data: portfolio } = useData('portfolio', fetchPortfolio, '30s');
  
  // Low frequency for user settings
  const { data: settings } = usePersistentData('settings', fetchSettings, '1h');

  return (
    <div>
      <PriceChart data={prices} />
      <Portfolio data={portfolio} />
      <Settings data={settings} />
    </div>
  );
}
```

### News Feed with Offline Support
```tsx
function NewsFeed() {
  const { data: news, error, isFromCache } = useData(
    'breaking-news', 
    fetchNews, 
    '2m'
  );

  return (
    <div>
      {error && isFromCache && (
        <Banner>Showing cached news - connection issues</Banner>
      )}
      {news.map(article => <Article key={article.id} {...article} />)}
    </div>
  );
}
```

### User Settings with Persistence
```tsx
import { usePersistentData } from 'yasm/persist';

function UserSettings() {
  const { data: settings, refresh } = usePersistentData(
    'user-settings',
    fetchSettings,
    '1h',
    { 
      storageType: 'localStorage',
      syncAcrossTabs: true 
    }
  );

  return <SettingsForm data={settings} onSave={refresh} />;
}
```

## 🛠️ **Advanced Features**

### Persistence Options
```tsx
import { 
  usePersistentData, 
  configurePersistence,
  enableCrossTabSync 
} from 'yasm/persist';

// Configure globally
configurePersistence({
  defaultStorageType: 'localStorage',
  prefix: 'myapp_',
  maxSize: 200,
  enableCompression: true
});

// Enable cross-tab sync
const cleanup = enableCrossTabSync();
```

### Debug & Monitoring
```tsx
import { 
  YasmDebugMonitor, 
  useCacheInspector,
  useCacheMonitor 
} from 'yasm/debug';

function DevTools() {
  const { stats, hasFailures, isHealthy } = useCacheInspector();
  const { show, hide, Monitor } = useCacheMonitor();

  return (
    <div>
      <button onClick={show}>Show Cache Monitor</button>
      <Monitor />
      {!isHealthy && <Alert>Cache issues detected</Alert>}
    </div>
  );
}
```

### Preloading
```tsx
import { preload } from 'yasm';

// Preload critical data
await preload('user-profile', fetchUser, '10m');

// In component - data is already available
const { data: user } = useData('user-profile', fetchUser, '10m');
```

## 📊 **Performance**

- **Bundle Size**: ~2KB gzipped (core)
- **Memory Usage**: Automatic LRU eviction
- **Network**: Request deduplication
- **Storage**: Automatic cleanup of expired items
- **Tree Shaking**: Debug tools removed in production

## 🔧 **Migration from v1**

YASM is backward compatible:

```tsx
const { data } = useData('key', fetcher, '5m');
```

## 🤝 **Contributing**

YASM was built based on real-world feedback from developers building high-frequency applications. We welcome contributions!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 **License**

MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 **Acknowledgments**

- Inspired by SWR, React Query, and real-world usage in production apps
- Built for developers who need simple, reliable caching without the complexity
- Tested in high-frequency trading dashboards, live sports apps, and real-time monitoring systems

---
