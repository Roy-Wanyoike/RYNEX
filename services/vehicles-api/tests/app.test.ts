/**
 * App-level contract tests: health probe and the global 404 envelope.
 * Neither path touches the database.
 */
import request from 'supertest';
import app from '../src/server';

// Re-asserted defensively (also set by tests/setup.ts via setupFiles, before
// this module — and therefore the app — is loaded).
process.env.SECRETKEY = process.env.SECRETKEY ?? 'test-secret-key-for-ci';

describe('GET /health', () => {
  it('answers 200 with the success envelope', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ success: true, message: 'API healthy' });
  });
});

describe('Unknown routes', () => {
  it('GET /definitely-not-a-route -> 404 with the JSON failure envelope (not HTML)', async () => {
    const res = await request(app).get('/definitely-not-a-route');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ success: false, message: 'Route not found' });
  });
});
