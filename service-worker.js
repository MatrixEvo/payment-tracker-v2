const CACHE_NAME = 'paytrack-v2-cache-v7';
const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json',
    '/assets/css/app.css',
    '/assets/js/app.js'
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
    // Basic Network First, fallback to cache strategy
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Check if we received a valid response (allow basic and cors)
                if (!response || response.status !== 200 || (response.type !== 'basic' && response.type !== 'cors' && response.type !== 'default')) {
                    return response;
                }
                
                // Clone the response because it's a stream and can only be consumed once
                const responseToCache = response.clone();
                caches.open(CACHE_NAME)
                    .then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                return response;
            })
            .catch(() => {
                // Fallback to cache if network fails
                return caches.match(event.request);
            })
    );
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
