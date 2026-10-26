import communityHandler from './community-api.js';

export function communityRoute(resolvePath) {
  return (request, response) => communityHandler({
    ...request,
    query: {
      ...request.query,
      path: resolvePath(request.query ?? {}),
    },
  }, response);
}
