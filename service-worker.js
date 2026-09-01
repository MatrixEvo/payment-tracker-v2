const CACHE_NAME = 'paytrack-v2-cache-v10';
const urlsToCache = [
    '/',
    '/index.html',
    '/offline.html',
    '/manifest.json',
    '/assets/css/output.css',
    '/assets/js/app.js'
];

const cdnDomains = [
    'unpkg.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const isCDN = cdnDomains.some(domain => url.hostname.includes(domain));

    if (isCDN) {
        // Cache First strategy for CDN assets
        event.respondWith(
            caches.match(event.request)
                .then(cachedResponse => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    
                    return fetch(event.request)
                        .then(response => {
                            if (!response || response.status !== 200 || (response.type !== 'basic' && response.type !== 'cors')) {
                                return response;
                            }
                            
                            const responseToCache = response.clone();
                            caches.open(CACHE_NAME)
                                .then(cache => {
                                    cache.put(event.request, responseToCache);
                                });
                            return response;
                        })
                        .catch(() => {
                            // If network fails and not in cache, return 503 to prevent TypeError
                            return new Response('CDN Resource Unavailable', { status: 503, statusText: 'Service Unavailable' });
                        });
                })
        );
    } else {
        // Network First strategy for main app files
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (!response || response.status !== 200 || (response.type !== 'basic' && response.type !== 'cors' && response.type !== 'default')) {
                        return response;
                    }
                    
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(event.request, responseToCache);
                        });
                    return response;
                })
                .catch(() => {
                    // Fallback to cache if network fails
                    return caches.match(event.request)
                        .then(cachedResponse => {
                            if (cachedResponse) {
                                return cachedResponse;
                            }
                            
                            // If not in cache, check if it's a navigation request
                            if (event.request.mode === 'navigate') {
                                return caches.match('/offline.html');
                            }
                            
                            // For other missing resources, return 503 to prevent TypeError
                            return new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });
                        });
                })
        );
    }
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
