const FAVICON_URL = '/favicon.svg?v=cofounder-20261116';
let template: Promise<string> | undefined;
let requestedColors = '';

/** Transparent artwork uses the palette with a light/dark browser color variant. */
export function updateBrandFavicon(light: string, dark: string) {
  const link = document.querySelector<HTMLLinkElement>('#app-favicon');
  if (!link || !light || !dark) return;
  const colors = `${light}:${dark}`;
  if (requestedColors === colors) return;
  requestedColors = colors;
  template ??= fetch(FAVICON_URL, { cache: 'force-cache' }).then(response => {
    if (!response.ok) throw new Error('Favicon unavailable');
    return response.text();
  });
  void template.then(svg => {
    if (requestedColors !== colors) return;
    const themed = svg.replace(/<style>[\s\S]*?<\/style>/, `<style>:root{--brand-color:${light};}@media(prefers-color-scheme:dark){:root{--brand-color:${dark};}}</style>`);
    link.href = `data:image/svg+xml,${encodeURIComponent(themed)}`;
  }).catch(() => {
    // The static icon remains usable when the recoloring fetch fails.
    template = undefined;
    if (requestedColors === colors) requestedColors = '';
  });
}
