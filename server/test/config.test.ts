import { describe, expect, it } from 'vitest';
import { defaultBucketKey, loadConfig } from '../src/config.js';

const base = {
  APS_CLIENT_ID: 'AbC123',
  APS_CLIENT_SECRET: 'secret',
  APP_ACCESS_KEY: 'key-1234567890abcdefgh',
};

describe('loadConfig', () => {
  it('필수 값이 없으면 누락된 이름을 모두 알려준다', () => {
    expect(() => loadConfig({}, '/data')).toThrow(
      'server/.env에 다음 값이 없습니다: APS_CLIENT_ID, APS_CLIENT_SECRET, APP_ACCESS_KEY',
    );
  });

  it('공백만 있는 값도 누락으로 본다', () => {
    expect(() => loadConfig({ ...base, APP_ACCESS_KEY: '   ' }, '/data')).toThrow('APP_ACCESS_KEY');
  });

  it('기본 PORT 3000과 파생 버킷 키를 쓴다', () => {
    const config = loadConfig(base, '/data');
    expect(config).toEqual({
      apsClientId: 'AbC123',
      apsClientSecret: 'secret',
      appAccessKey: 'key-1234567890abcdefgh',
      bucketKey: defaultBucketKey('AbC123'),
      port: 3000,
      dataDir: '/data',
    });
  });

  it('APS_BUCKET_KEY와 PORT를 지정하면 그 값을 쓴다', () => {
    const config = loadConfig({ ...base, APS_BUCKET_KEY: 'my-bucket', PORT: '4000' }, '/data');
    expect(config.bucketKey).toBe('my-bucket');
    expect(config.port).toBe(4000);
  });

  it('PORT가 양의 정수가 아니면 거부한다', () => {
    expect(() => loadConfig({ ...base, PORT: 'abc' }, '/data')).toThrow('PORT 값이 올바르지 않습니다: abc');
  });

  it('APP_ACCESS_KEY는 영문·숫자·-·_ 20자 이상만 허용한다', () => {
    const message = 'APP_ACCESS_KEY는 영문·숫자·-·_ 로만 20자 이상이어야 합니다.';
    for (const key of ['short-key', 'has$dollar-abcdefghijkl', 'has#hash-abcdefghijklmn', '한글접근키한글접근키한글접근키한글접근키']) {
      expect(() => loadConfig({ ...base, APP_ACCESS_KEY: key }, '/data')).toThrow(message);
    }
    expect(loadConfig({ ...base, APP_ACCESS_KEY: 'abcdefghij_KLMNOPQRS-0123' }, '/data').appAccessKey).toBe(
      'abcdefghij_KLMNOPQRS-0123',
    );
  });
});

describe('defaultBucketKey', () => {
  it('APS 버킷 규칙(소문자·숫자·하이픈, 3~128자)을 지키고 항상 같은 값을 낸다', () => {
    const key = defaultBucketKey('SomeClientId');
    expect(key).toMatch(/^mangdo-[a-f0-9]{16}$/);
    expect(defaultBucketKey('SomeClientId')).toBe(key);
  });
});
