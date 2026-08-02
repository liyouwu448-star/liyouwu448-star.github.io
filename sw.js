// 漫剧智能体 PWA Service Worker
const CACHE_NAME = 'manga-agent-v1';
const OFFLINE_URL = './index.html';

// 需要缓存的核心资源
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// 安装阶段：缓存核心资源
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CORE_ASSETS).then(function() {
        return self.skipWaiting();
      });
    })
  );
});

// 激活阶段：清理旧缓存
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_NAME;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// 请求拦截：网络优先，失败回退缓存，离线回退到首页
self.addEventListener('fetch', function(event) {
  // 只处理 GET 请求
  if (event.request.method !== 'GET') return;

  // 跳过跨域请求（API调用不缓存）
  if (!event.request.url.startsWith(self.location.origin) &&
      !event.request.url.startsWith('https://fonts.googleapis.com') &&
      !event.request.url.startsWith('https://fonts.gstatic.com')) {
    return;
  }

  // API请求不缓存，直接走网络
  if (event.request.url.includes('/api/') ||
      event.request.url.includes('siliconflow') ||
      event.request.url.includes('openai.com') ||
      event.request.url.includes('anthropic.com') ||
      event.request.url.includes('deepseek.com') ||
      event.request.url.includes('volces.com') ||
      event.request.url.includes('bigmodel.cn') ||
      event.request.url.includes('dashscope') ||
      event.request.url.includes('moonshot.cn')) {
    return;
  }

  event.respondWith(
    fetch(event.request).then(function(response) {
      // 缓存成功的响应
      if (response && response.status === 200) {
        var responseClone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseClone);
        });
      }
      return response;
    }).catch(function() {
      // 网络失败，尝试缓存
      return caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        // 导航请求返回离线页面
        if (event.request.mode === 'navigate') {
          return caches.match(OFFLINE_URL);
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});
