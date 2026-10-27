import { communityRoute } from '../server/community-route.js';

export default communityRoute((query) =>
  String(query.path ?? '')
    .split('/')
    .filter(Boolean),
);
