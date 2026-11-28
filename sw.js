const CACHE = "holy-mommy-app-90c1ded7be70ad76";
const FILES = ["./","./DejaVuSans.ttf","./FONT-LICENSE.txt","./FONTKIT-LICENSE.txt","./PDF-LICENSE.txt","./app.js","./bootstrap.js","./engine.js","./fontkit.min.js","./icon-192.png","./icon-512.png","./icon.svg","./index.html","./library.json","./manifest.webmanifest","./names.js","./pdf-lib.min.js","./pdf.js","./policy.js","./rules.js","./store.js","./style.css"];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => {
        if (!self.registration.active) return self.skipWaiting();
      }),
  ),
);
// The waiting worker activates after all app windows close: no mid-form forced reload.
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("holy-mommy-app-") && key !== CACHE)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(new URL(self.registration.scope).pathname)
  )
    return;
  event.respondWith(
    (async () => {
      const cached = await caches
        .open(CACHE)
        .then((cache) => cache.match(event.request));
      if (cached) return cached;
      try {
        return await fetch(event.request);
      } catch (error) {
        if (event.request.mode === "navigate")
          return (await caches.open(CACHE)).match(
            new URL("./index.html", self.registration.scope),
          );
        throw error;
      }
    })(),
  );
});
