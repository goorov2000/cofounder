import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const brand = JSON.parse(await readFile(new URL('src/design-system/brand.json', root), 'utf8'));
const image = await readFile(new URL(`public${brand.source}`, root));
const { size, inset } = brand.favicon;
const tokens = await readFile(new URL('src/design-system/tokens.css', root), 'utf8');
const light = tokens.match(/--ds-favicon-light:\s*([^;]+);/)[1].trim();
const dark = tokens.match(/--ds-favicon-dark:\s*([^;]+);/)[1].trim();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<style>:root{--brand-color:${light};}@media(prefers-color-scheme:dark){:root{--brand-color:${dark};}}</style>
<defs><mask id="cofounder" maskUnits="userSpaceOnUse" x="0" y="0" width="${size}" height="${size}" style="mask-type:alpha"><svg x="${inset}" y="${inset}" width="${size - 2 * inset}" height="${size - 2 * inset}" viewBox="${brand.crop.x} ${brand.crop.y} ${brand.crop.size} ${brand.crop.size}" overflow="hidden"><image width="${brand.width}" height="${brand.height}" href="data:image/png;base64,${image.toString('base64')}"/></svg></mask></defs>
<rect width="${size}" height="${size}" fill="var(--brand-color)" mask="url(#cofounder)"/>
</svg>
`;
const destination = new URL('public/favicon.svg', root);
if (process.argv.includes('--check')) {
  if (await readFile(destination, 'utf8') !== svg) throw new Error('Regenerate favicon: node scripts/build-brand-assets.mjs');
  console.log('Brand favicon matches the original artwork and shared framing.');
} else {
  await writeFile(destination, svg);
  console.log('Generated favicon from the original transparent CoFounder artwork.');
}
