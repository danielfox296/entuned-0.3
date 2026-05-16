// Service worker registration helper. Kept separate from main.tsx so the
// player can be developed without SW (devOptions.enabled = false in vite.config)
// while still having a clean prod registration path.
//
// Exposes a global getter for the active registration so the push-subscription
// flow in PlayerScreen can subscribe once the SW is ready.

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null
  if (!('serviceWorker' in navigator)) return null
  if (import.meta.env.DEV) return null
  if (registrationPromise) return registrationPromise
  registrationPromise = (async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './', type: 'classic' })
      return reg
    } catch (e) {
      console.warn('[sw] registration failed', e)
      return null
    }
  })()
  return registrationPromise
}

export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!registrationPromise) return registerServiceWorker()
  return registrationPromise
}
