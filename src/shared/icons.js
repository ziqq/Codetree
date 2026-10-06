/**
 * Original 24×24 line icons rendered as inline SVG.
 *
 * Used for controls and for the Minimal file-icon style. File and folder
 * icons for the Color and Monochrome styles come from file-icons
 * (see `content/sidebar/file-icons.js`).
 *
 * @module shared/icons
 */

/** SVG path data by icon name. */
const paths = Object.freeze({
  tree: 'M5 3v14a3 3 0 0 0 3 3h7M5 8h10M15 5h5v6h-5zM15 17h5v6h-5zM2 1h6v4H2z',
  folder: 'M3 5h6l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5z',
  'folder-open': 'M3 18V5h6l2 2h8v3M3 20h16l3-10H6L3 20z',
  file: 'M5 3h9l5 5v13H5zM14 3v6h5',
  code: 'm9 8-4 4 4 4m6-8 4 4-4 4m-2-11-2 14',
  chevron: 'm9 5 7 7-7 7',
  branch: 'M6 7v10m0-5h6a6 6 0 0 0 6-6M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4M18 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  pr: 'M6 7v10m0-14a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4M15 4h2a3 3 0 0 1 3 3v10m-5-13 3-3m-3 3 3 3m2 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',
  bookmark: 'M6 3h12v19l-6-4-6 4z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  refresh: 'M20 11a8 8 0 1 0-2 6M20 3v8h-8',
  pin: 'm8 3 8 0-1 6 4 4H5l4-4zm4 10v8',
  close: 'm5 5 14 14M19 5 5 19',
  dock: 'M3 4h18v16H3zM9 4v16',
  external: 'M14 3h7v7m0-7-12 12M11 3H3v18h18v-8',
  collapse: 'M4 7h16M4 17h16m-12-5 4-3 4 3m-8 0 4 3 4-3',
  comment: 'M3 4h18v13H9l-6 4z',
  check: 'm5 12 4 4L20 5',
  diff: 'M5 3h14v18H5zM8 8h8m-4-3v6m-4 5h8',
  image: 'M3 3h18v18H3zm0 15 6-6 4 4 3-3 5 5M15 7h1',
  config: 'M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 4h5',
  json: 'M5 3h9l5 5v13H5zM14 3v6h5M10 12H9v2l-1 2 1 2v2h1m4-8h1v2l1 2-1 2v2h-1',
  markdown: 'M4 3h11l5 5v13H4zM15 3v5h5M7 17v-5l2 3 2-3v5m5-5v5m-2-2 2 2 2-2',
  license: 'M5 3h9l5 5v13H5zM14 3v6h5m-7 3 3 1v3c0 2-3 3-3 3s-3-1-3-3v-3l3-1z',
  ignore: 'M5 3h9l5 5v13H5zM14 3v6h5M9 13l6 6m0-6-6 6',
  'file-code': 'M4 3h11l5 5v13H4zM15 3v5h5m-11 4-2 3 2 3m6-6 2 3-2 3m-2-6-2 6',
  book: 'M3 3h7l2 2 2-2h7v17h-7l-2 2-2-2H3zm9 2v17',
  arrow: 'm10 5-7 7 7 7M3 12h18',
  account: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21v-3a8 8 0 0 1 16 0v3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
});

/**
 * Creates an icon element that inherits `currentColor`.
 *
 * @param {string} name An icon name; unknown names use the generic file icon.
 * @param {string} [className=''] An extra CSS class.
 * @returns {SVGSVGElement}
 */
export function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  if (className) svg.classList.add(className);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name] || paths.file);
  svg.append(path);
  return svg;
}
