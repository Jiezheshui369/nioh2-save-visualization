const CACHE = "nioh2-companion-v26";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const root = await fetch("/", { cache: "reload" });
    await cache.put("/", root.clone());
    const html = await root.text();
    const discovered = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
      .map((match) => new URL(match[1], self.location.origin))
      .filter((url) => url.origin === self.location.origin && !url.pathname.startsWith("/api/"))
      .map((url) => `${url.pathname}${url.search}`);
    await cache.addAll([...new Set([...SHELL.slice(1), ...discovered])]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, response.clone());
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") return caches.match("/");
        throw new Error("资源尚未缓存，且当前处于离线状态。");
      }),
  );
});
