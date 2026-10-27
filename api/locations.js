import { getPublishedLocations } from '../server/location-api.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const locations = await getPublishedLocations();
    response.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return response.status(200).json({ locations });
  } catch (error) {
    const status = error.statusCode === 503 ? 503 : 500;
    console.error('Location directory request failed:', error.message);
    return response.status(status).json({
      error:
        status === 503
          ? 'Database is not configured'
          : 'Location directory is temporarily unavailable',
    });
  }
}
