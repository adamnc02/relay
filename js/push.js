// Push notifications arrive in a later phase. This module is the seam: the
// UI asks it whether push is available and renders nothing when it is not.
// The service worker's push and notificationclick handlers go in sw.js.

export const pushAvailable = () => false;
export async function subscribePush() {
  throw new Error('Push notifications are not available yet.');
}
export async function unsubscribePush() {}
