import { supabase } from './supabase'

// Promemoria push delle scadenze. Lato client: registra il service worker, chiede il permesso,
// si iscrive con la chiave VAPID pubblica e salva la sottoscrizione su Supabase. La consegna
// effettiva la fa la Edge Function `send-reminders` (vedi supabase/functions).

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''
const SCOPE = import.meta.env.BASE_URL
const SW_URL = `${import.meta.env.BASE_URL}sw.js`

export type NotifState = 'unsupported' | 'unconfigured' | 'denied' | 'enabled' | 'disabled'

export const pushSupported = (): boolean =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export const pushConfigured = (): boolean => !!VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const buffer = new ArrayBuffer(raw.length)
  const arr = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration(SCOPE)
  return reg ? await reg.pushManager.getSubscription() : null
}

export async function getNotifState(): Promise<NotifState> {
  if (!pushSupported()) return 'unsupported'
  if (!pushConfigured()) return 'unconfigured'
  if (Notification.permission === 'denied') return 'denied'
  try {
    return (await currentSubscription()) ? 'enabled' : 'disabled'
  } catch {
    return 'disabled'
  }
}

export async function enableNotifications(userId: string): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: 'Notifiche non supportate da questo browser' }
  if (!pushConfigured()) return { ok: false, error: 'Notifiche non configurate (manca VITE_VAPID_PUBLIC_KEY)' }
  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return { ok: false, error: 'Permesso per le notifiche negato' }

    const reg = await navigator.serviceWorker.register(SW_URL, { scope: SCOPE })
    await navigator.serviceWorker.ready

    const existing = await reg.pushManager.getSubscription()
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })

    const json = sub.toJSON()
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    }, { onConflict: 'endpoint' })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Errore durante l\'attivazione' }
  }
}

export async function disableNotifications(): Promise<{ ok: boolean; error?: string }> {
  try {
    const sub = await currentSubscription()
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Errore durante la disattivazione' }
  }
}
