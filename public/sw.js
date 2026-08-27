const CACHE_NAME = 'musik-pintar-v3';
const AUDIO_CACHE = 'musik-pintar-audio';

// Install
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll([
                '/',
                '/index.html',
                '/manifest.json',
                '/favicon.svg'
            ]);
        })
    );
    self.skipWaiting();
});

// Activate
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME && key !== AUDIO_CACHE)
                    .map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch - Network first with cache fallback for HTML, Cache first for audio
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Audio files - Cache first for offline playback
    if (event.request.destination === 'audio' ||
        url.pathname.endsWith('.mp3') ||
        url.pathname.endsWith('.wav') ||
        url.pathname.endsWith('.ogg') ||
        url.pathname.includes('/storage/v1/object/')) {

        event.respondWith(
            caches.open(AUDIO_CACHE).then(cache => {
                return cache.match(event.request).then(cached => {
                    if (cached) return cached;

                    return fetch(event.request).then(response => {
                        if (response.ok) {
                            cache.put(event.request, response.clone());
                        }
                        return response;
                    }).catch(() => {
                        // Return empty response for offline
                        return new Response('', { status: 503, statusText: 'Offline' });
                    });
                });
            })
        );
        return;
    }

    // HTML/CSS/JS - Network first
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

// Message handler for precaching audio URLs
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'CACHE_AUDIO') {
        const urls = event.data.urls;
        caches.open(AUDIO_CACHE).then(cache => {
            urls.forEach(url => {
                fetch(url).then(response => {
                    if (response.ok) cache.put(url, response);
                }).catch(() => {});
            });
        });
    }
});
