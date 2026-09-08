/**
 * REGRESSION SUITE for the historical auth-bypass bug: the original
 * verifyToken middleware never blocked unauthenticated requests, letting
 * them fall through to controllers (which then blew up with a 500 / DB
 * error instead of 401, and admin routes were effectively open).
 *
 * Contract under test (src/Middlewares/verifyToken.ts + requireAdmin.ts):
 *   - missing / malformed Authorization  -> 401 { success: false, message }
 *   - invalid or forged signature        -> 401 { success: false, message }
 *   - valid token but non-admin role     -> 403 { success: false,
 *                                                   message: 'Admin access required' }
 *     on every admin-guarded route:
 *       POST /products, POST /products/softdeletecar/:carId, GET /users,
 *       GET /cart/all
 *
 * The 401/403 short-circuits happen BEFORE any db.exec call, so no MSSQL
 * instance is required. Requests never reach a database-backed code path.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/server';

// Re-asserted defensively (also set by tests/setup.ts via setupFiles, before
// this module — and therefore the app — is loaded).
const SECRET = (process.env.SECRETKEY = process.env.SECRETKEY ?? 'test-secret-key-for-ci');

/** Shape of the JWT payload produced by POST /auth/login (src/Models). */
interface TokenPayload {
  userId: string;
  userName: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
}

const nonAdminPayload: TokenPayload = {
  userId: '11111111-1111-4111-8111-111111111111',
  userName: 'plain_buyer',
  email: 'buyer@example.com',
  fullName: 'Plain Buyer',
  isAdmin: false
};

/** Sign a payload with the same secret the API verifies against. */
const signToken = (payload: TokenPayload): string =>
  jwt.sign(payload, SECRET, { expiresIn: '1h' });

describe('Authentication guard — verifyToken short-circuits (regression)', () => {
  it('POST /cart with NO Authorization header -> 401 (not 500), failure envelope', async () => {
    const res = await request(app).post('/cart');

    // The historical bug answered 500 (downstream controller/DB crash).
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ success: false, message: 'Authentication required' });
  });

  it("POST /cart with 'Bearer invalid.token.here' -> 401, failure envelope", async () => {
    const res = await request(app)
      .post('/cart')
      .set('Authorization', 'Bearer invalid.token.here');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, message: 'Invalid or expired token' });
  });

  it('POST /cart with a token signed by a different secret -> 401', async () => {
    const forged = jwt.sign({ ...nonAdminPayload }, 'attacker-controlled-secret', {
      expiresIn: '1h'
    });
    const res = await request(app).post('/cart').set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, message: 'Invalid or expired token' });
  });

  it("POST /cart with a non-Bearer scheme ('Token abc') -> 401", async () => {
    const res = await request(app).post('/cart').set('Authorization', 'Token invalid.token.here');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, message: 'Authentication required' });
  });
});

describe('Admin guard — requireAdmin on admin-only routes (regression)', () => {
  const adminOnlyRequests: Array<{ description: string; make: () => request.Test }> = [
    {
      description: 'POST /products (create car)',
      make: () =>
        request(app)
          .post('/products')
          .set('Authorization', `Bearer ${signToken(nonAdminPayload)}`)
          .send({ model: 'Audi A5', bodyType: 'Sedan', brand: 'Audi', prices: 45000 })
    },
    {
      description: 'GET /users (list accounts)',
      make: () =>
        request(app)
          .get('/users')
          .set('Authorization', `Bearer ${signToken(nonAdminPayload)}`)
    },
    {
      description: 'POST /products/softdeletecar/:carId (soft delete)',
      make: () =>
        request(app)
          .post('/products/softdeletecar/22222222-2222-4222-8222-222222222222')
          .set('Authorization', `Bearer ${signToken(nonAdminPayload)}`)
    },
    {
      description: 'GET /cart/all (view all carts)',
      make: () =>
        request(app)
          .get('/cart/all')
          .set('Authorization', `Bearer ${signToken(nonAdminPayload)}`)
    }
  ];

  it.each(adminOnlyRequests.map((r) => [r.description, r.make]))(
    '%s with a valid non-admin token -> 403, Admin access required',
    async (_description, make) => {
      const res = await make();

      expect(res.status).toBe(403);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toMatchObject({
        success: false,
        message: 'Admin access required'
      });
    }
  );
});

describe('Positive guard flow — valid non-admin token gets past verifyToken', () => {
  it('POST /cart with a valid token reaches controller validation, not 401/403', async () => {
    // Empty body: verifyToken accepts the token and the controller's Joi
    // validation rejects it — all BEFORE any db.exec call. This proves the
    // guard chain no longer blocks valid tokens (the inverse of the bug).
    const res = await request(app)
      .post('/cart')
      .set('Authorization', `Bearer ${signToken(nonAdminPayload)}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(res.body).toMatchObject({ success: false, message: 'carId is required' });
  });
});
