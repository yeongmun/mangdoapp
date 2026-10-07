import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * x-access-key 검사. expectedKey는 모든 요청을 통과시키고, readOnlyKey(선택)는 GET만 통과시킨다 —
 * 웹(daenong)처럼 손상 원장을 읽기만 하는 쪽에 업로드·삭제·덮어쓰기 권한을 주지 않기 위해서다.
 */
export function requireAccessKey(expectedKey: string, readOnlyKey?: string): RequestHandler {
  return (req, res, next) => {
    const provided = req.get('x-access-key') ?? '';
    if (matches(provided, expectedKey)) {
      next();
      return;
    }
    if (readOnlyKey && matches(provided, readOnlyKey)) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        next();
        return;
      }
      res.status(403).json({ error: '읽기 전용 접근키로는 조회만 할 수 있습니다.' });
      return;
    }
    res.status(401).json({ error: '접근키가 올바르지 않습니다.' });
  };
}
