/* FinanzApp - Service Worker: solo notifiche push (nessuna cache/offline, per non interferire
   col normale funzionamento dell'app). Registrato on-demand quando l'utente attiva le notifiche. */

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
  const target = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })
  )
})
