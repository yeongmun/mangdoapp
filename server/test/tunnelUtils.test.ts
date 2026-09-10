import { describe, expect, it } from 'vitest';
import { extractTunnelUrl, upsertEnvVars } from '../scripts/tunnelUtils.js';

describe('extractTunnelUrl', () => {
  it('cloudflared 로그에서 퀵 터널 주소를 찾는다', () => {
    const log = '2026-09-10T00:00:00Z INF |  https://quiet-river-1234.trycloudflare.com                                |';
    expect(extractTunnelUrl(log)).toBe('https://quiet-river-1234.trycloudflare.com');
  });

  it('API 주소나 주소가 없는 줄은 무시한다', () => {
    expect(extractTunnelUrl('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel"')).toBeNull();
    expect(extractTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeNull();
  });
});

describe('upsertEnvVars', () => {
  it('빈 내용에 변수를 추가한다', () => {
    expect(upsertEnvVars('', { A: '1', B: '2' })).toBe('A=1\nB=2\n');
  });

  it('같은 키는 교체하고 다른 줄과 주석은 보존한다', () => {
    const before = '# 앱 설정\nEXPO_PUBLIC_API_URL=https://old.trycloudflare.com\nOTHER=keep\n';
    const after = upsertEnvVars(before, {
      EXPO_PUBLIC_API_URL: 'https://new.trycloudflare.com',
      EXPO_PUBLIC_ACCESS_KEY: 'k',
    });
    expect(after).toBe(
      '# 앱 설정\nEXPO_PUBLIC_API_URL=https://new.trycloudflare.com\nOTHER=keep\nEXPO_PUBLIC_ACCESS_KEY=k\n',
    );
  });

  it('CRLF 줄바꿈도 처리한다', () => {
    expect(upsertEnvVars('A=old\r\nB=2\r\n', { A: 'new' })).toBe('A=new\nB=2\n');
  });
});
