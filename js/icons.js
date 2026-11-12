import { SBY } from './model.js';

// The Handoff mark: a blue tile with a white chevron handing off to an amber one.
export function handoff(size, rx = 115) {
  const chev = (x, c) => `<path d="M${x} 152 L${x + 104} 256 L${x} 360" fill="none" stroke="${c}" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg viewBox="0 0 512 512" width="${size}" height="${size}" aria-hidden="true"><rect width="512" height="512" rx="${rx}" fill="#2a5bd7"/>${chev(146, '#ffffff')}${chev(268, '#ffad5c')}</svg>`;
}

export function sicon(s) {
  const st = SBY[s] || SBY.backlog;
  const c = st.c;
  const o = `<circle cx="7" cy="7" r="5.6" fill="none" style="stroke:${c}" stroke-width="1.6"`;
  const inner = {
    backlog: `${o} stroke-dasharray="2.2 1.9"/>`,
    next: `${o}/>`,
    progress: `${o}/><path d="M7 3.4A3.6 3.6 0 0 1 7 10.6Z" style="fill:${c}"/>`,
    testing: `${o}/><path d="M7 3.4A3.6 3.6 0 1 1 3.4 7H7Z" style="fill:${c}"/>`,
    waiting: `<circle cx="7" cy="7" r="6.4" style="fill:${c}"/><rect x="4.9" y="4.2" width="1.5" height="5.6" rx=".5" style="fill:var(--surface)"/><rect x="7.6" y="4.2" width="1.5" height="5.6" rx=".5" style="fill:var(--surface)"/>`,
    done: `<circle cx="7" cy="7" r="6.4" style="fill:${c}"/><path d="M4.3 7.2l1.8 1.8 3.6-3.8" fill="none" style="stroke:var(--surface)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  }[st.id];
  return `<svg class="si" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="${st.name}">${inner}</svg>`;
}

export const I_ALL = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2.5" width="10" height="3" rx="1"/><rect x="2" y="8.5" width="10" height="3" rx="1"/></svg>`;
export const I_ARCH = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="2.5" width="11" height="3" rx="1"/><path d="M2.5 5.5v5.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.5M5.5 8h3"/></svg>`;
export const CHEV = `<svg class="chev" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 3.5l3 3 3-3"/></svg>`;
export const I_MENU = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 5h12M3 9h12M3 13h12"/></svg>`;
export const I_SEARCH = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
export const I_GOOGLE = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.52 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.73z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.1C3.24 21.3 7.28 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.24-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29v-3.1H1.26A11.96 11.96 0 0 0 0 12c0 1.94.46 3.77 1.26 5.39l4.01-3.1z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.28 0 3.24 2.7 1.26 6.61l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75z"/></svg>`;
