import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'crypto';
import { ClerkVerificationError, resetClerkJwksClient, verifyClerkToken } from './clerk';

/**
 * The verification boundary of the embedded sign-in.
 *
 * Everything downstream — creating users, minting LibreChat sessions, granting the
 * signup bonus — trusts whatever this returns. A forged or misdirected token that
 * survives here is an account takeover, so each case below is a way in that must
 * stay shut.
 */

const ISSUER = 'https://glorious-lemming-37.clerk.accounts.dev';
const KID = 'test-key';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const otherPair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** Stands in for Clerk's JWKS endpoint; the signing key is the only thing mocked. */
jest.mock('jwks-rsa', () => ({
  JwksClient: class {
    getSigningKey(
      _kid: string,
      cb: (err: Error | null, key?: { getPublicKey: () => string }) => void,
    ) {
      cb(null, { getPublicKey: () => (global as never as { __pk: string }).__pk });
    }
  },
}));

beforeEach(() => {
  resetClerkJwksClient();
  (global as never as { __pk: string }).__pk = publicKey;
});

const sign = (payload: object, key: string = privateKey, expiresIn: string | number = '5m') =>
  jwt.sign(payload, key, { algorithm: 'RS256', keyid: KID, issuer: ISSUER, expiresIn });

describe('verifyClerkToken', () => {
  it('accepts a well-formed token and returns its claims', async () => {
    const token = sign({ sub: 'user_abc', email: 'a@b.ro', email_verified: true, name: 'A B' });

    const claims = await verifyClerkToken(token, ISSUER);

    expect(claims.sub).toBe('user_abc');
    expect(claims.email).toBe('a@b.ro');
    expect(claims.emailVerified).toBe(true);
  });

  it('refuses a token signed by a different key', async () => {
    const token = sign({ sub: 'user_abc' }, otherPair.privateKey);

    await expect(verifyClerkToken(token, ISSUER)).rejects.toBeInstanceOf(ClerkVerificationError);
  });

  /**
   * Without the issuer check, a signature check proves only "some Clerk signed
   * this" — anyone could sign up on their own Clerk instance and walk in.
   */
  it('refuses a validly-signed token from another issuer', async () => {
    const token = jwt.sign({ sub: 'user_abc' }, privateKey, {
      algorithm: 'RS256',
      keyid: KID,
      issuer: 'https://someone-elses.clerk.accounts.dev',
      expiresIn: '5m',
    });

    await expect(verifyClerkToken(token, ISSUER)).rejects.toBeInstanceOf(ClerkVerificationError);
  });

  it('refuses an expired token', async () => {
    const token = sign({ sub: 'user_abc' }, privateKey, -60);

    await expect(verifyClerkToken(token, ISSUER)).rejects.toThrow(/expired/i);
  });

  it('refuses a token with no subject — there is nothing to link an account to', async () => {
    const token = sign({ email: 'a@b.ro' });

    await expect(verifyClerkToken(token, ISSUER)).rejects.toThrow(/no subject/);
  });

  it('refuses an unsigned (alg: none) token', async () => {
    const token = jwt.sign({ sub: 'user_abc', iss: ISSUER }, '', { algorithm: 'none' });

    await expect(verifyClerkToken(token, ISSUER)).rejects.toBeInstanceOf(ClerkVerificationError);
  });

  it('refuses outright garbage', async () => {
    await expect(verifyClerkToken('not-a-token', ISSUER)).rejects.toBeInstanceOf(
      ClerkVerificationError,
    );
  });

  /**
   * An absent `email_verified` must read as false. Treating unknown as verified
   * would hand the signup bonus to unverified addresses — exactly what the bonus
   * gate exists to prevent.
   */
  it('treats a missing email_verified claim as unverified', async () => {
    const token = sign({ sub: 'user_abc', email: 'a@b.ro' });

    const claims = await verifyClerkToken(token, ISSUER);

    expect(claims.emailVerified).toBe(false);
  });

  /**
   * The claim is authored by hand in Clerk's session-token editor, where
   * `"{{user.email_verified}}"` interpolates inside the quotes and arrives as a
   * string. Same signed token either way, so the string counts.
   */
  it('accepts email_verified as the string a session-token template produces', async () => {
    const token = sign({ sub: 'user_abc', email: 'a@b.ro', email_verified: 'true' });

    const claims = await verifyClerkToken(token, ISSUER);

    expect(claims.emailVerified).toBe(true);
  });

  /** Anything else is still unverified — only an affirmative claim counts. */
  it.each([['false'], [''], ['1'], [0]])(
    'treats email_verified %p as unverified',
    async (value) => {
      const token = sign({ sub: 'user_abc', email: 'a@b.ro', email_verified: value });

      const claims = await verifyClerkToken(token, ISSUER);

      expect(claims.emailVerified).toBe(false);
    },
  );
});
