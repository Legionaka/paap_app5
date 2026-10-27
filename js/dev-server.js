import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import communityHandler from '../api/community.js';
import healthHandler from '../api/health.js';
import cronHandler from '../api/cron/import-dws.js';
import locationsHandler from '../api/locations.js';
import locationHandler from '../api/locations/[id].js';

const publicRoot = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const port = Number(process.env.PORT) || 5173;
const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self' https://api.open-meteo.com; font-src 'self'; upgrade-insecure-requests",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

function createLocalResponse(response, method) {
  let statusCode = 200;
  return {
    setHeader(name, value) {
      response.setHeader(name, value);
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      const body = JSON.stringify(payload);
      response.statusCode = statusCode;
      if (!response.hasHeader('Content-Type')) {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      response.setHeader('Content-Length', Buffer.byteLength(body));
      response.end(method === 'HEAD' ? undefined : body);
      return this;
    },
  };
}

async function parseRequestBody(request, response) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 15_000) throw new Error('Request body too large');
      chunks.push(chunk);
    }
  } catch {
    response.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end('{"error":"Request body too large"}');
    return null;
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end('{"error":"Invalid JSON"}');
    return null;
  }
}

async function callApi(handler, request, response, query = {}) {
  let body = {};
  if (!['GET', 'HEAD'].includes(request.method)) {
    body = await parseRequestBody(request, response);
    if (body === null) return;
  }
  for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
  await handler(
    {
      method: request.method,
      headers: request.headers,
      socket: request.socket,
      body,
      query,
    },
    createLocalResponse(response, request.method),
  );
}

function notFound(response) {
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/health') return callApi(healthHandler, request, response);
    if (pathname === '/api/cron/import-dws') return callApi(cronHandler, request, response);
    if (pathname === '/api/locations') return callApi(locationsHandler, request, response);
    const locationMatch = pathname.match(/^\/api\/locations\/([a-z0-9-]+)$/);
    if (locationMatch) return callApi(locationHandler, request, response, { id: locationMatch[1] });
    const communityMatch = pathname.match(/^\/api\/community\/(.+)$/);
    if (communityMatch) {
      return callApi(communityHandler, request, response, {
        path: communityMatch[1].split('/').filter(Boolean).join('/'),
      });
    }
    return notFound(response);
  }

  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }

  const normalizedPath =
    pathname === '/' ? '/index.html' : pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const relativePath = normalizedPath.replace(/^\/+/, '');
  const topLevel = relativePath.split(/[\\/]/)[0];
  if (
    ['server', 'db', '.git', 'node_modules', 'scripts', 'tests'].includes(topLevel) ||
    /^\.(?:env|git)/i.test(relativePath) ||
    /^(?:package(?:-lock)?\.json|README\.md|PHOTO_CREDITS\.md)$/i.test(relativePath)
  ) {
    return notFound(response);
  }

  const filePath = resolve(publicRoot, relativePath);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return notFound(response);
    response.writeHead(200, {
      ...securityHeaders,
      'Content-Length': info.size,
      'Content-Type': contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    notFound(response);
  }
}).listen(port, '127.0.0.1', () => {
  console.info(`Stillwater is running at http://localhost:${port}`);
});
