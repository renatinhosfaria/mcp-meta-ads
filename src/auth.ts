import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config, type Auth0Config } from './config.js';

export type OAuthClaims = JWTPayload & { scope?: string; permissions?: string[] };
export type OAuthTokenVerifier = (token: string) => Promise<OAuthClaims>;

function equalToken(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function requiredScopesPresent(claims: OAuthClaims, required: string[]): boolean {
  const granted = new Set([
    ...(typeof claims.scope === 'string' ? claims.scope.split(/\s+/) : []),
    ...(Array.isArray(claims.permissions) ? claims.permissions : []),
  ]);
  return required.every((scope) => granted.has(scope));
}

function challenge(res: Response, auth0: Auth0Config): void {
  const metadata = `${auth0.resource}/.well-known/oauth-protected-resource`;
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadata}", scope="${auth0.scopes.join(' ')}"`);
  res.status(401).json({ error: 'Invalid or insufficient OAuth token' });
}

function defaultOAuthVerifier(auth0: Auth0Config): OAuthTokenVerifier {
  const jwks = createRemoteJWKSet(new URL('.well-known/jwks.json', auth0.issuer));
  return async (token) => {
    const result = await jwtVerify(token, jwks, {
      algorithms: ['RS256'],
      issuer: auth0.issuer,
      audience: auth0.audience,
    });
    return result.payload as OAuthClaims;
  };
}

export function createAuthMiddleware(options: {
  apiKey: string;
  auth0?: Auth0Config;
  verifyOAuthToken?: OAuthTokenVerifier;
}): (req: Request, res: Response, next: NextFunction) => void {
  const verifyOAuthToken = options.auth0
    ? (options.verifyOAuthToken ?? defaultOAuthVerifier(options.auth0))
    : undefined;

  return (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      if (options.auth0) {
        challenge(res, options.auth0);
      } else {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
      }
      return;
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (equalToken(token, options.apiKey)) {
      next();
      return;
    }

    if (!options.auth0 || !verifyOAuthToken) {
      res.status(403).json({ error: 'Invalid API key' });
      return;
    }

    void verifyOAuthToken(token).then((claims) => {
      if (!requiredScopesPresent(claims, options.auth0!.scopes)) {
        challenge(res, options.auth0!);
        return;
      }
      res.locals.auth = claims;
      next();
    }).catch(() => challenge(res, options.auth0!));
  };
}

export const authMiddleware = createAuthMiddleware({ apiKey: config.apiKey, auth0: config.auth0 });
