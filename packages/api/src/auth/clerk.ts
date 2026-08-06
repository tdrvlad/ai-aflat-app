import jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import type { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';

/**
 * ai-aflat: verification of a Clerk session token.
 *
 * This is the whole security boundary of the embedded sign-in. The browser
 * completes authentication with Clerk and ends up holding a Clerk token; this
 * module is what decides whether that token may be turned into a LibreChat
 * session. A token that merely *parses* is worthless — anyone can mint one of
 * those — so every check below is load-bearing and none may be relaxed for
 * convenience.
 */

export interface ClerkClaims {
  /** Clerk's user id. Stored as `openidId`, and the only durable link to the account. */
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  username?: string;
}

export class ClerkVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClerkVerificationError';
  }
}

let cachedClient: JwksClient | null = null;
let cachedIssuer: string | null = null;

function getJwksClient(issuer: string): JwksClient {
  if (cachedClient && cachedIssuer === issuer) {
    return cachedClient;
  }

  cachedClient = new JwksClient({
    jwksUri: `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`,
    cache: true,
    cacheMaxAge: 10 * 60 * 1000,
    /** Bounded so a hostile `kid` cannot be used to hammer Clerk through us. */
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });
  cachedIssuer = issuer;

  return cachedClient;
}

export function resetClerkJwksClient(): void {
  cachedClient = null;
  cachedIssuer = null;
}

/**
 * Verifies a Clerk session token and returns its claims.
 *
 * Rejects rather than returning anything partial: the caller must not have to
 * decide whether a half-verified token is good enough.
 */
export function verifyClerkToken(token: string, issuer: string): Promise<ClerkClaims> {
  const client = getJwksClient(issuer);

  const getKey = (header: JwtHeader, callback: SigningKeyCallback): void => {
    if (!header.kid) {
      callback(new Error('token header has no kid'));
      return;
    }
    client.getSigningKey(header.kid, (error, key) => {
      if (error || !key) {
        callback(error ?? new Error('signing key not found'));
        return;
      }
      callback(null, key.getPublicKey());
    });
  };

  return new Promise<ClerkClaims>((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        /**
         * Pinning the issuer is what stops a validly-signed token from *someone
         * else's* Clerk instance being accepted. Without it the signature check
         * proves only "some Clerk signed this", which is not an authorization.
         */
        issuer,
        algorithms: ['RS256'],
        /** Clerk session tokens are short-lived; a little skew, not a lot. */
        clockTolerance: 5,
      },
      (error, decoded) => {
        if (error) {
          reject(new ClerkVerificationError(error.message));
          return;
        }

        const claims = decoded as Record<string, unknown> | undefined;
        const sub = typeof claims?.sub === 'string' ? claims.sub : null;
        if (!sub) {
          reject(new ClerkVerificationError('token has no subject'));
          return;
        }

        resolve({
          sub,
          email: typeof claims?.email === 'string' ? claims.email : undefined,
          /**
           * Absent means false. Treating an unknown verification state as verified
           * would hand out the signup bonus to unverified addresses, which is
           * precisely what the bonus gate exists to prevent.
           *
           * The string form is accepted because the claim is authored by hand, in
           * Clerk's session-token editor, as `"{{user.email_verified}}"` — and a
           * template that interpolates into the quotes yields `"true"` rather than
           * `true`. Both come from the same signed token, so nothing is loosened;
           * refusing the string would only mean every new account silently losing
           * its signup bonus over a pair of quotation marks.
           */
          emailVerified: claims?.email_verified === true || claims?.email_verified === 'true',
          name: typeof claims?.name === 'string' ? claims.name : undefined,
          username: typeof claims?.username === 'string' ? claims.username : undefined,
        });
      },
    );
  });
}

/** The Clerk instance we trust. Defaults to the OIDC issuer — the same instance. */
export function getClerkIssuer(): string | null {
  return process.env.CLERK_ISSUER || process.env.OPENID_ISSUER || null;
}

export function getClerkPublishableKey(): string | null {
  return process.env.CLERK_PUBLISHABLE_KEY || null;
}

/**
 * Embedded sign-in is available only when both halves are configured. When it is
 * not, the client falls back to the OIDC redirect — auth must degrade to a working
 * path, never to a blank screen.
 */
export function isClerkEmbedConfigured(): boolean {
  return Boolean(getClerkPublishableKey() && getClerkIssuer());
}
