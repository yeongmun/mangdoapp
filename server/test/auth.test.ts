import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requireAccessKey } from '../src/auth.js';

function makeApp() {
  const app = express();
  app.use(requireAccessKey('correct-key'));
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('requireAccessKey', () => {
  it('헤더가 없으면 401과 안내 문구', async () => {
    const res = await request(makeApp()).get('/ping');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: '접근키가 올바르지 않습니다.' });
  });

  it('길이가 같아도 키가 다르면 401', async () => {
    const res = await request(makeApp()).get('/ping').set('x-access-key', 'correct-kez');
    expect(res.status).toBe(401);
  });

  it('길이가 다른 키도 401 (예외 없이)', async () => {
    const res = await request(makeApp()).get('/ping').set('x-access-key', 'short');
    expect(res.status).toBe(401);
  });

  it('키가 맞으면 통과', async () => {
    const res = await request(makeApp()).get('/ping').set('x-access-key', 'correct-key');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
