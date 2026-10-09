import { describe, expect, it, vi } from 'vitest';
import { ClaudeTranscriber, parseHandwriting } from '../src/handwriting.js';

describe('parseHandwriting — 사내 치수 표기', () => {
  it('폭/길이', () => {
    expect(parseHandwriting('0.2/0.3')).toMatchObject({ width: 0.2, length: 0.3, count: null });
    expect(parseHandwriting(' 0.2 / 1.5 ')).toMatchObject({ width: 0.2, length: 1.5 });
  });
  it('가로x세로(×·X·*)', () => {
    expect(parseHandwriting('1.2x0.5')).toMatchObject({ width: 1.2, length: 0.5 });
    expect(parseHandwriting('1.2×0.5')).toMatchObject({ width: 1.2, length: 0.5 });
    expect(parseHandwriting('1.2*0.5')).toMatchObject({ width: 1.2, length: 0.5 });
  });
  it('개소: EA·개·뒤에 붙은 x3', () => {
    expect(parseHandwriting('0.3/2.0 3EA')).toMatchObject({ width: 0.3, length: 2, count: 3 });
    expect(parseHandwriting('1.2x0.5 2개')).toMatchObject({ width: 1.2, length: 0.5, count: 2 });
    expect(parseHandwriting('1.2x0.5x2')).toMatchObject({ width: 1.2, length: 0.5, count: 2 });
  });
  it('숫자 하나는 폭', () => {
    expect(parseHandwriting('0.3')).toMatchObject({ width: 0.3, length: null, count: null });
    expect(parseHandwriting('.3')).toMatchObject({ width: 0.3 });
    expect(parseHandwriting('0,3')).toMatchObject({ width: 0.3 });
  });
  it('O·l 혼동을 숫자로', () => {
    expect(parseHandwriting('O.2/l.5')).toMatchObject({ width: 0.2, length: 1.5 });
  });
  it('읽을 수 없으면 전부 null, 원문은 남긴다', () => {
    expect(parseHandwriting('abc')).toEqual({ width: null, length: null, count: null, text: 'abc' });
    expect(parseHandwriting('')).toEqual({ width: null, length: null, count: null, text: '' });
  });
});

describe('ClaudeTranscriber', () => {
  it('이미지를 base64로 보내고 text 블록을 이어 붙인다', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('test-model');
      expect(body.messages[0].content[0].source.data).toBe(Buffer.from('png').toString('base64'));
      return new Response(JSON.stringify({ content: [{ type: 'text', text: ' 0.2/0.3 ' }] }), { status: 200 });
    });
    const t = new ClaudeTranscriber('key', 'test-model', fetchImpl as unknown as typeof fetch);
    expect(await t.transcribe(Buffer.from('png'))).toBe('0.2/0.3');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'x-api-key': 'key' });
  });
  it('실패 응답은 throw', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }));
    const t = new ClaudeTranscriber('key', 'm', fetchImpl as unknown as typeof fetch);
    await expect(t.transcribe(Buffer.from('x'))).rejects.toThrow('401');
  });
});
