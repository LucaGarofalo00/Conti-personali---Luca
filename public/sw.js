/* FinanzApp - Service Worker: solo notifiche push (nessuna cache/offline, per non interferire
   col normale funzionamento dell'app). Registrato on-demand quando l'utente attiva le notifiche. */

// Accetta solo URL che ricadono nello scope della registrazione; qualunque altra cosa (o un valore
// malformato) ricade sulla home dell'app.
function safeUrl(raw) {
  const scope = self.registration.scope
  if (!raw) return scope
  try {
    const url = new URL(raw, scope)
    return url.href.startsWith(scope) ? url.href : scope
  } catch (e) {
    return scope
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: 'FinanzApp', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'FinanzApp'
  const icon = new URL('apple-touch-icon.png', self.registration.scope).toString()
  const options = {
    body: data.body || '',
    icon,
    badge: icon,
    tag: data.tag || 'finanzapp-reminder',
    data: { url: data.url || self.registration.scope },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // L'URL arriva nel payload push: apriamo solo indirizzi dentro lo scope dell'app. Un payload
  // ostile (o semplicemente sbagliato) potrebbe altrimenti far aprire un sito esterno da un tocco
  // su una notifica che l'utente riconosce come propria.
  const target = safeUrl(event.notification.data && event.notification.data.url)
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })
  )
})
