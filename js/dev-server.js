import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPublishedLocation, getPublishedLocations } from '../server/location-api.js';
import communityHandler from '../server/community-api.js';

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
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  const apiMatch = pathname.match(/^\/api\/locations\/([a-z0-9-]+)$/);
  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/locations' && ['GET', 'HEAD'].includes(request.method)) {
      try {
        const locations = await getPublishedLocations();
        const body = JSON.stringify({ locations });
        response.writeHead(200, {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
          'Content-Length': Buffer.byteLength(body),
          'Content-Type': 'application/json; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : body);
      } catch (error) {
        const statusCode = error.statusCode === 503 ? 503 : 500;
        console.error('Location directory request failed:', error.message);
        const body = JSON.stringify({ error: statusCode === 503 ? 'Database is not configured' : 'Location directory is temporarily unavailable' });
        response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' }).end(body);
      }
      return;
    }

    const communityMatch = pathname.match(/^\/api\/community\/(.+)$/);
    if (communityMatch) {
      if (!['GET', 'POST', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'application/json; charset=utf-8' }).end('{"error":"Method not allowed"}');
        return;
      }
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 15000) throw new Error('Request body too large');
          chunks.push(chunk);
        }
      } catch {
        response.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' }).end('{"error":"Request body too large"}');
        return;
      }
      let body = {};
      try {
        if (size) body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }).end('{"error":"Invalid JSON"}');
        return;
      }
      const pathParts = communityMatch[1].split('/').filter(Boolean);
      const localResponse = {
        status(code) { this.statusCode = code; return this; },
        setHeader(name, value) { response.setHeader(name, value); },
        json(payload) {
          const output = JSON.stringify(payload);
          response.writeHead(this.statusCode ?? 200, { 'Content-Length': Buffer.byteLength(output) });
          response.end(request.method === 'HEAD' ? undefined : output);
          return response;
        },
      };
      await communityHandler({
        method: request.method,
        headers: request.headers,
        socket: request.socket,
        body,
        query: { path: pathParts },
      }, localResponse);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'application/json; charset=utf-8' }).end('{"error":"Method not allowed"}');
      return;
    }
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

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
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
