import { neon } from '@neondatabase/serverless';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).json({ status: 'method_not_allowed' });
  }
  try {
    if (!process.env.DATABASE_URL) throw new Error('Database is not configured');
    await neon(process.env.DATABASE_URL)`SELECT 1`;
    return response
      .status(200)
      .json({ status: 'ok', database: 'ok', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Health check failed:', error.message);
    return response.status(503).json({ status: 'unavailable', database: 'unavailable' });
  }
}
