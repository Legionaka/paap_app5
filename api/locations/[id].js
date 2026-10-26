import { getPublishedLocation } from '../../server/location-api.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const locationId = request.query.id;
  if (typeof locationId !== 'string' || !/^[a-z0-9-]+$/.test(locationId)) {
    return response.status(400).json({ error: 'Invalid location id' });
  }

  try {
    const location = await getPublishedLocation(locationId);
    if (!location) return response.status(404).json({ error: 'Location not found' });
    response.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return response.status(200).json({ location });
  } catch (error) {
    const status = error.statusCode === 503 ? 503 : 500;
    console.error('Location API request failed:', error.message);
    return response.status(status).json({
      error: status === 503 ? 'Database is not configured' : 'Location data is temporarily unavailable',
    });
  }
}
