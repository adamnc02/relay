import { SBY } from './model.js';

// The Handoff mark: a blue tile with a white chevron handing off to an amber one.
export function handoff(size, rx = 128) {
  const chev = (x, c) => `<path d="M${x} 152 L${x + 104} 256 L${x} 360" fill="none" stroke="${c}" stroke-width="58" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg viewBox="0 0 512 512" width="${size}" height="${size}" aria-hidden="true"><rect width="512" height="512" rx="${rx}" fill="#2a5bd7"/>${chev(146, '#ffffff')}${chev(268, '#ffad5c')}</svg>`;
}

// Status glyphs: dashed = Backlog, ring = Up next, half = In progress,
// three-quarter = Testing, filled pause = Waiting, filled tick = Done.
export function sicon(s, size = 16) {
  const st = SBY[s] || SBY.backlog;
  const c = st.c;
  const ring = `<circle cx="8" cy="8" r="6.25" fill="none" style="stroke:${c}" stroke-width="1.5"`;
  const inner = {
    backlog: `${ring} stroke-dasharray="2.2 2.2"/>`,
    next: `${ring}/>`,
    progress: `${ring}/><path d="M8 4a4 4 0 0 1 0 8z" style="fill:${c}"/>`,
    testing: `${ring}/><path d="M8 4a4 4 0 1 1-4 4h4z" style="fill:${c}"/>`,
    waiting: `<circle cx="8" cy="8" r="6.5" style="fill:${c}"/><path d="M6.4 5.6v4.8M9.6 5.6v4.8" style="stroke:var(--on-wait)" stroke-width="1.6" stroke-linecap="round"/>`,
    done: `<circle cx="8" cy="8" r="6.5" style="fill:${c}"/><path d="m5.3 8.2 1.8 1.8 3.6-3.8" fill="none" style="stroke:var(--surface)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  }[st.id];
  return `<svg class="si" width="${size}" height="${size}" viewBox="0 0 16 16" role="img" aria-label="${st.name}">${inner}</svg>`;
}

// A parent's glyph: a dotted ring with a dot, in the project's colour (--pc).
export function parentIcon(colour) {
  return `<svg class="si pcol" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="Parent with phases" style="--pc:${colour}"><circle cx="8" cy="8" r="6.25" fill="none" class="pc-stroke" stroke-width="1.5" stroke-dasharray="1 2.4" stroke-linecap="round"/><circle cx="8" cy="8" r="2.5" class="pc-fill"/></svg>`;
}

const sv = (size, body, extra = '') => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

export const I_ALL = sv(16, '<path d="M4 6h16M4 12h16M4 18h10"/>');
export const I_ARCH = sv(16, '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>');
export const I_SKILLS = sv(16, '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3M13 15h4"/>');
export const I_BELL = sv(16, '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>');
export const I_COLLAPSE = sv(17, '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 10l-2 2 2 2"/>');
export const I_EXPAND = sv(18, '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M13 10l2 2-2 2"/>');
export const I_SEARCH = sv(15, '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', ' stroke-width="2"');
export const I_PLUS = sv(14, '<path d="M12 5v14M5 12h14"/>', ' stroke-width="2.2"');
export const I_COPY = sv(14, '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', ' stroke-width="2"');
export const I_LINK = sv(14, '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>', ' stroke-width="2"');
export const I_UP = sv(16, '<path d="m18 15-6-6-6 6"/>', ' stroke-width="2"');
export const I_DOWN = sv(16, '<path d="m6 9 6 6 6-6"/>', ' stroke-width="2"');
export const I_CARET = sv(14, '<path d="m7 10 5 5 5-5"/>', ' stroke-width="2"');
export const CHEV = sv(14, '<path d="m9 6 6 6-6 6"/>', ' class="chev" stroke-width="2"');
export const I_MORE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>`;
export const I_CLOSE = sv(14, '<path d="M6 6l12 12M18 6 6 18"/>', ' stroke-width="2.2"');
export const I_SEND = sv(16, '<path d="M12 19V5M5 12l7-7 7 7"/>', ' stroke-width="2.2"');
export const I_SUN = sv(13, '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', ' stroke-width="2"');
export const I_MOON = sv(13, '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>', ' stroke-width="2"');
export const I_MONITOR = sv(13, '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', ' stroke-width="2"');
export const I_GRID = sv(15, '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>');
export const I_SIGNOUT = sv(15, '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>');
export const I_LISTV = sv(14, '<path d="M4 6h16M4 12h16M4 18h16"/>', ' stroke-width="2"');
export const I_BOARDV = sv(14, '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>', ' stroke-width="2"');
export const I_MENU = sv(22, '<path d="M4 7h16M4 12h16M4 17h10"/>');
export const I_MAIL = sv(14, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', ' stroke-width="2"');
export const I_CHAT = sv(14, '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>', ' stroke-width="2"');
export const I_GRIP = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`;
export const I_PENCIL = sv(14, '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>', ' stroke-width="2"');
export const I_TRASH = sv(14, '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', ' stroke-width="2"');
export const I_CODE = sv(14, '<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>', ' stroke-width="2"');
export const I_BUG = sv(14, '<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 20v-8M8 13H4M20 13h-4M9 7 7 4M15 7l2-3M8.5 17l-3 2M15.5 17l3 2"/>', ' stroke-width="2"');
// The marker before a bug's title. Dev tickets show nothing.
export const bugMark = () => `<svg class="bug" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Bug"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 20v-8M8 13H4M20 13h-4M9 7 7 4M15 7l2-3"/></svg>`;
export const I_GOOGLE = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.52 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.73z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.1C3.24 21.3 7.28 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.24-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29v-3.1H1.26A11.96 11.96 0 0 0 0 12c0 1.94.46 3.77 1.26 5.39l4.01-3.1z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.28 0 3.24 2.7 1.26 6.61l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75z"/></svg>`;
