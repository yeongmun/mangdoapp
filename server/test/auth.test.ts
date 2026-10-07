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

describe('requireAccessKey — 읽기 전용 키', () => {
  function makeApp() {
    const app = express();
    app.use(requireAccessKey('correct-key', 'read-only-key'));
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    app.post('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it('읽기 전용 키는 GET을 통과시킨다', async () => {
    const res = await request(makeApp()).get('/ping').set('x-access-key', 'read-only-key');
    expect(res.status).toBe(200);
  });

  it('읽기 전용 키로 쓰기(POST)를 하면 403', async () => {
    const res = await request(makeApp()).post('/ping').set('x-access-key', 'read-only-key');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: '읽기 전용 접근키로는 조회만 할 수 있습니다.' });
  });

  it('본 키는 여전히 쓰기도 통과한다', async () => {
    const res = await request(makeApp()).post('/ping').set('x-access-key', 'correct-key');
    expect(res.status).toBe(200);
  });

  it('둘 다 아니면 401', async () => {
    const res = await request(makeApp()).get('/ping').set('x-access-key', 'other');
    expect(res.status).toBe(401);
  });
});
