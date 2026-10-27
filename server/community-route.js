import communityHandler from './community-api.js';

export function communityRoute(resolvePath) {
  return (request, response) =>
    communityHandler(
      {
        method: request.method,
        headers: request.headers ?? {},
        socket: request.socket,
        body: request.body,
        query: {
          ...(request.query ?? {}),
          path: resolvePath(request.query ?? {}),
        },
      },
      response,
    );
}
