import express from 'express';
import type { Auth0Config } from '../config.js';

export function protectedResourceMetadata(auth0: Auth0Config) {
  return {
    resource: auth0.resource,
    authorization_servers: [auth0.issuer],
    scopes_supported: auth0.scopes,
    resource_documentation: `${auth0.resource}/docs/auth0-setup`,
  };
}

export function createProtectedResourceRouter(auth0?: Auth0Config): express.Router {
  const router = express.Router();
  router.get('/.well-known/oauth-protected-resource', (_req, res) => {
    if (!auth0) {
      res.sendStatus(404);
      return;
    }
    res.json(protectedResourceMetadata(auth0));
  });
  return router;
}
