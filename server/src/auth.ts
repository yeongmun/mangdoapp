import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export function requireAccessKey(expectedKey: string): RequestHandler {
  const expected = Buffer.from(expectedKey, 'utf8');
  return (req, res, next) => {
    const provided = Buffer.from(req.get('x-access-key') ?? '', 'utf8');
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      next();
      return;
    }
    res.status(401).json({ error: '접근키가 올바르지 않습니다.' });
  };
}
