/**
 * Global test bootstrap. Loaded via `setupFiles` in jest.config.js, i.e.
 * BEFORE any test file (and therefore before any import of src/server.ts)
 * is evaluated.
 *
 * The JWT middleware (src/Middlewares/verifyToken.ts) refuses to verify
 * tokens against an undefined secret, so a SECRETKEY must exist before the
 * app handles any request. Signing in the guards suite uses the same value.
 */
process.env.SECRETKEY = process.env.SECRETKEY ?? 'test-secret-key-for-ci';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

export {};
