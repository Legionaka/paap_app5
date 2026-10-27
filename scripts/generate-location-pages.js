import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPublishedLocations } from '../server/location-api.js';
import { locationPhotos } from '../public/js/location-photos.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(projectRoot, 'public');
const profilesRoot = resolve(publicRoot, 'explore/locations');
const templatePath = resolve(publicRoot, 'explore/index.html');
const manifestPath = resolve(profilesRoot, '.generated-pages.json');
const configuredBase = process.env.APP_BASE_URL || 'http://localhost:5173';
const baseUrl = new URL(configuredBase).origin;

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

function xmlEscape(value) {
  return escapeHtml(value).replaceAll('&#39;', '&apos;');
}

function locationDescription(location) {
  return `${location.name} fishing guide: location facts, sourced species records, weather forecasts and local angler discussions in ${location.province}, South Africa.`;
}

function setTagAttribute(html, id, attribute, value) {
  const tagPattern = new RegExp(`<([a-z]+)(?=[^>]*\\bid="${id}")[^>]*>`, 'i');
  return html.replace(tagPattern, (tag) => {
    const attributePattern = new RegExp(`\\b${attribute}="[^"]*"`, 'i');
    const replacement = `${attribute}="${escapeHtml(value)}"`;
    return attributePattern.test(tag)
      ? tag.replace(attributePattern, replacement)
      : tag.replace(/\s*\/?\s*>$/, ` ${replacement}>`);
  });
}

const locations = await getPublishedLocations();
const template = await readFile(templatePath, 'utf8');
let previousPages = [];
try {
  previousPages = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  // A first build has no generated-page manifest.
}

for (const relativePage of previousPages) {
  if (
    typeof relativePage !== 'string' ||
    !/^explore\/locations\/[a-z0-9-]+\/index\.html$/.test(relativePage)
  )
    continue;
  const oldPage = resolve(publicRoot, relativePage);
  if (oldPage.startsWith(`${profilesRoot}${sep}`)) await rm(oldPage, { force: true });
}

const generatedPages = [];
const sitemapEntries = [baseUrl, `${baseUrl}/explore/`];
for (const location of locations) {
  if (!/^[a-z0-9-]+$/.test(location.id)) continue;
  const relativePage = `explore/locations/${location.id}/index.html`;
  const pagePath = resolve(publicRoot, relativePage);
  if (!pagePath.startsWith(`${profilesRoot}${sep}`)) continue;
  const pageUrl = `${baseUrl}/explore/locations/${location.id}/`;
  const description = locationDescription(location);
  const photo = locationPhotos[location.id];
  let page = template
    .replace('<body>', `<body data-location-id="${escapeHtml(location.id)}">`)
    .replace(
      /<title id="pageTitle">.*?<\/title>/s,
      `<title id="pageTitle">${escapeHtml(location.name)} fishing guide · Stillwater</title>`,
    );
  page = setTagAttribute(page, 'pageDescription', 'content', description);
  page = setTagAttribute(page, 'pageCanonical', 'href', pageUrl);
  page = setTagAttribute(
    page,
    'openGraphTitle',
    'content',
    `${location.name} fishing guide · Stillwater`,
  );
  page = setTagAttribute(page, 'openGraphDescription', 'content', description);
  page = setTagAttribute(page, 'openGraphUrl', 'content', pageUrl);
  page = setTagAttribute(page, 'openGraphImage', 'content', photo ? `${baseUrl}${photo.src}` : '');
  await mkdir(dirname(pagePath), { recursive: true });
  await writeFile(pagePath, page, 'utf8');
  generatedPages.push(relativePage);
  sitemapEntries.push(pageUrl);
}

await mkdir(profilesRoot, { recursive: true });
await writeFile(manifestPath, JSON.stringify(generatedPages, null, 2), 'utf8');
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join('\n')}\n</urlset>\n`;
await writeFile(resolve(publicRoot, 'sitemap.xml'), sitemap, 'utf8');
await writeFile(
  resolve(publicRoot, 'robots.txt'),
  `User-agent: *\nAllow: /\nDisallow: /account/\nDisallow: /sign-in/\nDisallow: /register/\nDisallow: /forgot-password/\nDisallow: /reset-password/\nDisallow: /verify-email/\nSitemap: ${baseUrl}/sitemap.xml\n`,
  'utf8',
);
console.info(`Generated ${generatedPages.length} location pages and sitemap for ${baseUrl}.`);
