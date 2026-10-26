import { timingSafeEqual } from 'node:crypto';
import { importLatestDwsDamLevel } from '../../server/dws-importer.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.authorization ?? '';
  const expected = secret ? Buffer.from(`Bearer ${secret}`) : Buffer.alloc(0);
  const received = Buffer.from(authorization);
  if (!secret || received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return response.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await importLatestDwsDamLevel();
    console.info('DWS weekly storage import completed:', result);
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('DWS weekly storage import failed:', error.message);
    return response.status(502).json({ ok: false, error: 'DWS report import failed' });
  }
}
