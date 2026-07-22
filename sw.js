const SHELL_CACHE = "keyboard-piano-shell-v3";
const AUDIO_CACHE = "keyboard-piano-audio-salamander-v3-48k-mp3-320-web-v2";
const SHELL_FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== SHELL_CACHE && key !== AUDIO_CACHE).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  // The web build keeps audio in one Cache Storage collection. This avoids the
  // IndexedDB request stalls seen on iOS while preserving the original MP3
  // bytes without duplication or transcoding.
  if (url.pathname.includes("/audio/")) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        return cached || fetch(request);
      }),
    );
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
