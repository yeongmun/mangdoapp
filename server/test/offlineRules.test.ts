import { describe, expect, it } from 'vitest';
import {
  bundleNeedsUpdate,
  drawingsToDownload,
  pendingPushCount,
  rewriteViewerHtml,
  syncDecision,
} from '../../src/offlineRules.js';

describe('syncDecision', () => {
  it('로컬이 더 새것이면 push', () => {
    expect(syncDecision('2026-09-23T01:00:00.000Z', '2026-09-22T01:00:00.000Z')).toBe('push');
  });

  it('서버가 더 새것이면 pull', () => {
    expect(syncDecision('2026-09-22T01:00:00.000Z', '2026-09-23T01:00:00.000Z')).toBe('pull');
  });

  it('같은 시각이면 none', () => {
    expect(syncDecision('2026-09-23T01:00:00.000Z', '2026-09-23T01:00:00.000Z')).toBe('none');
  });

  it('로컬이 없고 서버가 있으면 pull', () => {
    expect(syncDecision(null, '2026-09-23T01:00:00.000Z')).toBe('pull');
  });

  it('서버가 없고 로컬이 있으면 push', () => {
    expect(syncDecision('2026-09-23T01:00:00.000Z', null)).toBe('push');
  });

  it('둘 다 없으면 none', () => {
    expect(syncDecision(null, null)).toBe('none');
  });

  it('파싱할 수 없는 값은 없는 것으로 본다', () => {
    expect(syncDecision('이건-날짜가-아님', '2026-09-23T01:00:00.000Z')).toBe('pull');
    expect(syncDecision('2026-09-23T01:00:00.000Z', '이건-날짜가-아님')).toBe('push');
    expect(syncDecision('이건-날짜가-아님', '')).toBe('none');
  });
});

describe('drawingsToDownload', () => {
  const drawings = [
    { id: 'd1', offlineReady: true },
    { id: 'd2', offlineReady: false },
    { id: 'd3', offlineReady: true },
    { id: 'd4' },
  ];

  it('offlineReady이고 index에 없는 것만, 순서를 지켜 고른다', () => {
    expect(drawingsToDownload(drawings, []).map((d) => d.id)).toEqual(['d1', 'd3']);
  });

  it('이미 index에 있는 도면은 뺀다', () => {
    expect(drawingsToDownload(drawings, ['d1']).map((d) => d.id)).toEqual(['d3']);
  });

  it('offlineReady가 아니거나 없으면 뺀다', () => {
    expect(drawingsToDownload(drawings, []).map((d) => d.id)).not.toContain('d2');
    expect(drawingsToDownload(drawings, []).map((d) => d.id)).not.toContain('d4');
  });

  it('빈 목록이면 빈 배열', () => {
    expect(drawingsToDownload([], [])).toEqual([]);
  });
});

describe('bundleNeedsUpdate', () => {
  it('로컬 버전이 없으면(처음) 받아야 한다', () => {
    expect(bundleNeedsUpdate(null, 'abc123-7.126.0')).toBe(true);
  });

  it('버전이 다르면 받아야 한다', () => {
    expect(bundleNeedsUpdate('old111-7.126.0', 'abc123-7.126.0')).toBe(true);
  });

  it('버전이 같으면 받지 않는다', () => {
    expect(bundleNeedsUpdate('abc123-7.126.0', 'abc123-7.126.0')).toBe(false);
  });
});

describe('pendingPushCount', () => {
  it('push가 필요한 도면 수만 센다', () => {
    const entries = [
      { localUpdatedAt: '2026-09-23T02:00:00.000Z', serverUpdatedAt: '2026-09-23T01:00:00.000Z' }, // push
      { localUpdatedAt: '2026-09-23T01:00:00.000Z', serverUpdatedAt: '2026-09-23T02:00:00.000Z' }, // pull
      { localUpdatedAt: '2026-09-23T01:00:00.000Z', serverUpdatedAt: '2026-09-23T01:00:00.000Z' }, // none
      { localUpdatedAt: '2026-09-23T03:00:00.000Z', serverUpdatedAt: null }, // push
    ];
    expect(pendingPushCount(entries)).toBe(2);
  });

  it('빈 목록이면 0', () => {
    expect(pendingPushCount([])).toBe(0);
  });
});

describe('rewriteViewerHtml', () => {
  const CSS =
    '<link rel="stylesheet" href="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.126.0/style.min.css" />';
  const JS = '<script src="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.126.0/viewer3D.min.js"></script>';

  it('오토데스크 CDN 절대 경로 두 줄을 autodesk/ 상대 경로로 바꾼다', () => {
    const html = `<html><head>${CSS}${JS}</head></html>`;
    const rewritten = rewriteViewerHtml(html);
    expect(rewritten).toContain('href="autodesk/style.min.css"');
    expect(rewritten).toContain('src="autodesk/viewer3D.min.js"');
    expect(rewritten).not.toContain('https://developer.api.autodesk.com');
  });

  it('그 밖의 내용은 그대로 둔다', () => {
    expect(rewriteViewerHtml('<div>바뀌지 않음</div>')).toBe('<div>바뀌지 않음</div>');
  });
});
