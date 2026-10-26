import { communityRoute } from '../../../../server/community-route.js';

export default communityRoute(query => ['posts', query.postId, 'replies']);
