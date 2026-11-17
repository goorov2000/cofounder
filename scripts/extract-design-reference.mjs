// Read-only extraction from user-provided HTML. Never execute its scripts or load remote resources.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
try {
  const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 1913, height: 860 } });
  await page.route('**/*', route => route.abort());
  const result = {};
  for (const [theme, file] of [['dark', new URL('../../sources/design/СберБизнес.html', import.meta.url)], ['light', new URL('../../sources/design/СберБизнесwhite.html', import.meta.url)]]) {
    const html = (await readFile(file, 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    result[theme] = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      const variables = Object.fromEntries([...style].filter(key => key.startsWith('--') && key.endsWith('-0-15-0')).map(key => [key, style.getPropertyValue(key).trim()]));
      // Do not extract textContent, input values, account numbers, links or images.
      const samples = [...document.querySelectorAll('button,h1,h2,h3,th,input')].slice(0, 55).map(element => {
        const css = getComputedStyle(element);
        return { tag: element.tagName, classes: element.className, font: css.font, fontFamily: css.fontFamily, color: css.color, background: css.backgroundColor, radius: css.borderRadius, padding: css.padding, height: css.height };
      });
      return { variables, samples };
    });
  }
  await mkdir('docs/design-system', { recursive: true });
  await writeFile('docs/design-system/source-tokens.json', JSON.stringify(result, null, 2) + '\n');
  console.log('Saved design properties only to docs/design-system/source-tokens.json');
} finally { await browser.close(); }
