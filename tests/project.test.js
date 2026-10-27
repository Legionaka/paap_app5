import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { locationPhotos } from '../public/js/location-photos.js';

const root = resolve(import.meta.dirname, '..');
const publicRoot = join(root, 'public');

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const fullPath = join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(fullPath) : [fullPath];
    }),
  );
  return nested.flat();
}

test('all static page assets resolve to files in public', async () => {
  const htmlFiles = (await filesBelow(publicRoot)).filter((file) => extname(file) === '.html');
  const missing = [];
  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    for (const [, value] of html.matchAll(/(?:src|href)="(\/[^"#?]*)"/g)) {
      const target = value.endsWith('/')
        ? join(publicRoot, value, 'index.html')
        : join(publicRoot, value);
      try {
        await stat(target);
      } catch {
        missing.push(`${file}: ${value}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('all credited location images exist and use local URLs', async () => {
  for (const photo of Object.values(locationPhotos)) {
    assert.match(photo.src, /^\/images\//);
    await stat(join(publicRoot, photo.src.slice(1)));
    assert.ok(photo.credit);
    assert.ok(photo.license);
    assert.match(photo.sourceUrl, /^https:\/\/commons\.wikimedia\.org\//);
  }
});

test('Vercel stays within the Hobby serverless-function limit', async () => {
  const apiFiles = (await filesBelow(join(root, 'api'))).filter((file) => extname(file) === '.js');
  const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
  assert.ok(apiFiles.length <= 12, `Found ${apiFiles.length} Vercel functions`);
  assert.equal(config.outputDirectory, 'public');
});

test('public pages use the shared self-hosted typography system', async () => {
  const htmlFiles = (await filesBelow(publicRoot)).filter((file) => extname(file) === '.html');
  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    assert.ok(html.includes('/css/tokens.css'), `${file} does not load shared design tokens`);
    assert.ok(!html.includes('fonts.googleapis.com'), `${file} still loads a second font service`);
  }
});
