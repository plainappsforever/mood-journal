// What the two print engines do with the report HTML (ported from print-cost D62; re-measured for Mood with
// scripts/measure-pdf.swift — V1_LOG P8). PURE. The layout (src/engine/pdf-html.ts) is written in CSS points with
// `@page { margin: 16mm }`; the profile corrects each engine so that 1 CSS pt = 1 PDF pt and the margins are 16 mm.
export type Engine = 'ios' | 'android';

export type PrintProfile = {
  /** `html { zoom }`; 1 = none. */
  zoom: number;
  /** iOS only: page margins in PDF points given to expo-print (`margins`); null = none. */
  engineMargins: { left: number; right: number; top: number; bottom: number } | null;
  /** Replacement for the layout's `@page` margin (CSS value), or null to keep it. */
  pageMargin: string | null;
  /** CSS appended last. */
  extraCss: string;
};

/** 16 mm in points. */
export const MARGIN_PT = 45.35;
const M = { left: MARGIN_PT, right: MARGIN_PT, top: MARGIN_PT, bottom: MARGIN_PT };

export const PRINT_PROFILE: Record<Engine, PrintProfile> = {
  // WebKit ignores the @page margin for placement but lets it change the scale (measured before the port: body 10.5 pt
  // printed as 12.6 pt, text 22 pt from the left and 3 pt from the top of pages 2+). With @page and body margin 0 and
  // the margins handed to expo-print, 1 CSS px prints as 0.8 pt; `zoom: 0.9375` brings 1 CSS pt to 1 PDF pt.
  ios: { zoom: 0.9375, engineMargins: M, pageMargin: '0', extraCss: 'body{margin:0}' },
  // Chromium honours @page and prints 1 CSS pt as 1 PDF pt once the default 8 px body margin is gone.
  android: { zoom: 1, engineMargins: null, pageMargin: null, extraCss: 'body{margin:0}' },
};

/** The report HTML with the engine's corrections (inserted before </head>). */
export function printHtml(html: string, profile: PrintProfile): string {
  const css = [profile.zoom !== 1 ? `html{zoom:${profile.zoom}}` : '', profile.pageMargin !== null ? `@page{margin:${profile.pageMargin}}` : '', profile.extraCss].filter(Boolean).join('');
  return css ? html.replace('</head>', `<style>${css}</style></head>`) : html;
}

/** Extra options for expo-print's printToFileAsync. */
export function engineOptions(profile: PrintProfile): { margins?: { left: number; right: number; top: number; bottom: number } } {
  return profile.engineMargins ? { margins: profile.engineMargins } : {};
}
