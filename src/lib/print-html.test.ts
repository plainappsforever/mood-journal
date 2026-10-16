import { engineOptions, MARGIN_PT, PRINT_PROFILE, printHtml } from './print-html';

const html = '<html><head><style>@page { margin: 16mm; }</style></head><body>x</body></html>';

describe('print profiles (D64)', () => {
  it('iOS: zoom, @page margin 0 after the layout CSS, margins to the engine', () => {
    const out = printHtml(html, PRINT_PROFILE.ios);
    expect(out).toContain('<style>html{zoom:0.9375}@page{margin:0}body{margin:0}</style></head>');
    expect(out.indexOf('@page{margin:0}')).toBeGreaterThan(out.indexOf('@page { margin: 16mm; }'));
    expect(engineOptions(PRINT_PROFILE.ios)).toEqual({ margins: { left: MARGIN_PT, right: MARGIN_PT, top: MARGIN_PT, bottom: MARGIN_PT } });
    expect(MARGIN_PT).toBeCloseTo((16 / 25.4) * 72, 1);
  });
  it('Android: keeps @page, only the body margin goes; no engine margins', () => {
    const out = printHtml(html, PRINT_PROFILE.android);
    expect(out).toContain('<style>body{margin:0}</style></head>');
    expect(out).not.toContain('zoom');
    expect(engineOptions(PRINT_PROFILE.android)).toEqual({});
  });
});
