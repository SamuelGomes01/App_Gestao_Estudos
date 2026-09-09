/* Service worker — cache de estáticos (o app funciona 100% sem ele) */
const CACHE = 'estudos-v168-bloco-edicao';

/* Toque na notificação: timer abre a tela do cronômetro; lembrete abre o app. */
self.addEventListener('notificationclick', (e) => {
  // Este handler precisa existir antes de carregar o SDK do Firebase para não ser
  // substituído pelo listener padrão do Messaging.
  e.stopImmediatePropagation();
  e.notification.close();
  const timer = e.notification.tag === 'estudos-timer';
  const destinoPush = e.notification.data && e.notification.data.link;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if ('focus' in c) {
          c.focus();
          if ('navigate' in c) {
            const destino = timer ? c.url.split('#')[0] + '#timer' : (destinoPush || c.url);
            c.navigate(destino).catch(() => {});
          }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(timer ? './#timer' : (destinoPush || './'));
    })
  );
});
// O Firebase Messaging usa o MESMO service worker da PWA. Manter cache/offline e
// push no mesmo registro evita que um worker substitua o outro no escopo raiz.
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyBAxmw7gFkMk0aPwIGHQblo5nLFz8fKKnU',
    authDomain: 'app-gestao-estudos.firebaseapp.com',
    projectId: 'app-gestao-estudos',
    storageBucket: 'app-gestao-estudos.firebasestorage.app',
    messagingSenderId: '450464644014',
    appId: '1:450464644014:web:150b9f8683842de10c663f'
  });
  firebase.messaging().onBackgroundMessage((payload) => {
    const n = (payload && payload.data) || (payload && payload.notification) || {};
    if (!n.title) return;
    self.registration.showNotification(n.title, {
      body: n.body || '',
      icon: n.icon || './icons/icone.svg',
      tag: 'lembrete-estudo',
      data: { link: n.link || './' }
    });
  });
} catch (e) {
  // Firebase/push é opcional. Uma falha da CDN não pode impedir o app offline.
  console.warn('Firebase Messaging indisponível no service worker.', e);
}
const ESTATICOS = [
  './',
  './index.html',
  './manifest.json',
  './calc/petrobras.html',
  './calc/judiciario-federal.html',
  './js/frases.js',
  './css/styles.css?v=20260909a-bloco-edicao',
  './js/domain.js?v=20260909a-bloco-edicao',
  './js/store.js?v=20260909a-bloco-edicao',
  './js/sync.js?v=20260718h-seguranca-escala',
  './js/remote-state.js?v=20260718h-seguranca-escala',
  './js/firebase-sync.js?v=20260909a-bloco-edicao',
  './js/timer.js?v=20260718a-integridade',
  './js/charts.js?v=20260615v-green-performance',
  './data/catalogo-editais.js?v=20260721-inss2',
  './data/carreiras.js?v=20260721-career-covers2',
  './assets/carreiras/capa-inss-tecnico.png',
  './assets/carreiras/capa-trf-tjaa.jpg?v=20260721-real1',
  './assets/carreiras/capa-trt-tjaa.jpg?v=20260721-real1',
  './data/exemplo-trf3.json?v=20260718g-integridade-sync',
  './js/app.js?v=20260909a-bloco-edicao',
  './icons/icone.svg',
  './icons/icone-192.png',
  './icons/icone-512.png'
];

// Atualização automática: o SW novo assume assim que instala (skipWaiting) e,
// no activate, assume o controle das abas abertas (clients.claim). A página
// recarrega sozinha no controllerchange — sem card nem ação do usuário.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ESTATICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Estratégia: rede primeiro com fallback para cache (estáticos sempre frescos online, app abre offline) */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.endsWith('/api/sync')) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        if (resp.ok && e.request.url.startsWith(self.location.origin)) {
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
