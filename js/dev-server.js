import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPublishedLocation } from '../server/location-api.js';

const root = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const port = Number(process.env.PORT) || 5173;
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  const apiMatch = pathname.match(/^\/api\/locations\/([a-z0-9-]+)$/);
  if (pathname.startsWith('/api/')) {
    if (!apiMatch) {
      response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }).end('{"error":"Not found"}');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'application/json; charset=utf-8' }).end('{"error":"Method not allowed"}');
      return;
    }

    try {
      const location = await getPublishedLocation(apiMatch[1]);
      if (!location) {
        response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }).end('{"error":"Location not found"}');
        return;
      }
      const body = JSON.stringify({ location });
      response.writeHead(200, {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        'Content-Length': Buffer.byteLength(body),
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') response.end();
      else response.end(body);
    } catch (error) {
      const statusCode = error.statusCode === 503 ? 503 : 500;
      console.error('Location API request failed:', error.message);
      const body = JSON.stringify({ error: statusCode === 503 ? 'Database is not configured' : 'Location data is temporarily unavailable' });
      response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      if (request.method === 'HEAD') response.end();
      else response.end(body);
    }
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const topLevel = relativePath.split(/[\\/]/)[0];
  if (['server', 'db', '.git', 'node_modules'].includes(topLevel)
    || /^(\.env|package(?:-lock)?\.json|README\.md)$/i.test(relativePath)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  const filePath = resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Length': info.size,
      'Content-Type': types[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Stillwater is running at http://localhost:${port}`);
});
