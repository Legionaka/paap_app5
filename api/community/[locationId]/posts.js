import { communityRoute } from '../../../server/community-route.js';

export default communityRoute(query => [query.locationId, 'posts']);
