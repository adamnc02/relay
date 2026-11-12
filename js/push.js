// Web Push, the browser half. The server half is silver-octo-invention's
// relay-push Edge Function and migration 20261112220000_relay_push: a trigger
// queues a push when a ticket enters Waiting for me, and pg_cron sends it.
//
// The subscription belongs to this service worker registration (scope
// /relay/). Its row in relay.push_subscriptions is written through the
// adapter (savePushSubscription / deletePushSubscription), keyed on the
// endpoint, so registering the same browser twice updates one row.
//
// iOS: push exists only in the Home Screen app, never in a Safari tab, and
// permission can only be asked from a tap. Once denied, it can only be turned
// back on in the iPhone's Settings. Nothing here asks on load.

import { VAPID_PUBLIC_KEY } from './config.js';

export function isIos() {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function pushSupported() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration('./');
  if (existing) return existing;
  return navigator.serviceWorker.register('./sw.js', { scope: './' });
}

async function localSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('./');
  return (await reg?.pushManager.getSubscription()) || null;
}

function keyBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function b64url(buf) {
  if (!buf) return '';
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A subscription made with another VAPID key can't be used: the function's
// pushes to it would be refused (403).
function sameKey(sub) {
  const k = sub?.options?.applicationServerKey;
  if (!k) return true;
  return b64url(k) === VAPID_PUBLIC_KEY.replace(/=+$/, '');
}

// The state the Notifications panel shows:
//   demo | needs-home-screen | unsupported | blocked | on | off | unknown
// `on` needs both a subscription in this browser and its row on the server.
export async function pushState(adapter) {
  if (adapter.mode === 'demo') return { state: 'demo' };
  if (isIos() && !isStandalone()) return { state: 'needs-home-screen' };
  if (!pushSupported()) return { state: 'unsupported' };
  if (Notification.permission === 'denied') return { state: 'blocked' };
  const sub = await localSubscription().catch(() => null);
  if (!sub || !sameKey(sub)) return { state: 'off' };
  try {
    return { state: (await adapter.hasPushSubscription(sub.endpoint)) ? 'on' : 'off' };
  } catch (e) {
    return { state: 'unknown', message: e?.message };
  }
}

// 🚨 Call straight from a tap: the permission request must be the first thing
// that happens, or iOS doesn't show the prompt. Throws a sentence a person can
// act on.
export async function turnOn(adapter) {
  if (!pushSupported()) throw new Error("This browser can't show notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? "Notifications are blocked for Relay. Turn them on in Settings → Notifications → Relay (iPhone), or in this browser's site settings."
      : 'No answer was given, so nothing was turned on. Tap Turn on again when you are ready.');
  }
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  await adapter.savePushSubscription({
    endpoint: sub.endpoint,
    p256dh: b64url(sub.getKey('p256dh')),
    auth_key: b64url(sub.getKey('auth')),
    user_agent: navigator.userAgent.slice(0, 300),
    failed_count: 0,
  });
}

// This device only: its server row, then the browser's subscription.
export async function turnOff(adapter) {
  const sub = await localSubscription();
  if (!sub) return;
  await adapter.deletePushSubscription(sub.endpoint);
  await sub.unsubscribe().catch(() => {});
}

export async function sendTest(adapter) {
  const sub = await localSubscription();
  if (!sub) throw new Error('Turn notifications on for this device first.');
  return adapter.sendTestPush(sub.endpoint);
}

// On sign-out this device stops getting Relay's notifications. Best effort and
// time-boxed: signing out is never blocked by it.
export async function forgetThisDevice(adapter) {
  if (adapter.mode === 'demo' || !pushSupported()) return;
  try {
    await Promise.race([turnOff(adapter), new Promise((resolve) => setTimeout(resolve, 3000))]);
  } catch (e) {
    console.warn('[relay] could not unregister this device on sign-out:', e?.message);
  }
}
