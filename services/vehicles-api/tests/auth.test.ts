/**
 * Contract tests: POST /auth/register and POST /auth/login — validation layer.
 *
 * Every case below fails fast in Joi validation (src/Helpers/index.ts) inside
 * the controller, BEFORE bcrypt and BEFORE any db.exec call, so these tests
 * are hermetic and require no MSSQL instance.
 *
 * Response envelope contract for failures: 4xx { success: false, message }.
 */
import request from 'supertest';
import app from '../src/server';

// Re-asserted defensively (also set by tests/setup.ts via setupFiles, before
// this module — and therefore the app — is loaded).
process.env.SECRETKEY = process.env.SECRETKEY ?? 'test-secret-key-for-ci';

const VALID_PASSWORD = 'Str0ng!Pass';

describe('POST /auth/register — request validation (pre-DB)', () => {
  it('rejects a missing body with 400 and the failure envelope', async () => {
    const res = await request(app).post('/auth/register');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
  });

  it('rejects an empty JSON object with 400 and the failure envelope', async () => {
    const res = await request(app).post('/auth/register').send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: 'User name is required' });
  });

  it('rejects a weak password with 400 and the password policy message', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        userName: 'qa_user',
        email: 'qa.user@example.com',
        password: 'weakpass' // no upper, no digit, no special char
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
    expect(res.body.message).toBe(
      'Password must be 8+ chars with upper, lower, number and special character'
    );
  });

  it('rejects a userName shorter than 3 characters with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        userName: 'ab',
        email: 'qa.user@example.com',
        password: VALID_PASSWORD
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: 'User name must be at least 3 characters'
    });
  });

  it('rejects a malformed email with 400', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        userName: 'qa_user',
        email: 'not-an-email',
        password: VALID_PASSWORD
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: 'Please provide a valid email address'
    });
  });
});

describe('POST /auth/login — request validation (pre-DB)', () => {
  it('rejects a missing body with 400 and the failure envelope', async () => {
    const res = await request(app).post('/auth/login');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
    expect(typeof res.body.message).toBe('string');
  });

  it('rejects a body without a password with 400', async () => {
    const res = await request(app).post('/auth/login').send({ userName: 'qa_user' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: 'Password is required' });
  });

  it('rejects a body without a userName with 400', async () => {
    const res = await request(app).post('/auth/login').send({ password: VALID_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: 'User name is required' });
  });
});
