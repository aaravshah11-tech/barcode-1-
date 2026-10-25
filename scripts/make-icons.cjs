// Renders public/shared/logo.svg into the PNG app icons (run: node scripts/make-icons.cjs). Needs Playwright.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../public/shared/logo.svg'), 'utf8');
  const b = await chromium.launch();
  for (const size of [192, 512, 180]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    // Full-bleed dark square with the logo inset, so it looks right when phones round the corners.
    await p.setContent(`<html><body style="margin:0;background:#050807;display:grid;place-items:center;width:${size}px;height:${size}px">
      <div style="width:${Math.round(size * 0.82)}px;height:${Math.round(size * 0.82)}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`);
    const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
    await p.screenshot({ path: path.join(__dirname, '../public/shared/icons', name) });
  }
  await b.close();
})();
