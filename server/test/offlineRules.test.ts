import { describe, expect, it } from 'vitest';
import {
  bundleNeedsUpdate,
  drawingsToDownload,
  effectiveDecision,
  mergeSyncDecision,
  pendingPushCount,
  pendingSummary,
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

  it('뷰어 버전이 달라도 바꾼다 (서버가 버전을 올려도 기기 페이지가 인터넷을 부르지 않게)', () => {
    const html = '<script src="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.130.2/viewer3D.min.js"></script>';
    expect(rewriteViewerHtml(html)).toBe('<script src="autodesk/viewer3D.min.js"></script>');
  });

  it('그 밖의 내용은 그대로 둔다', () => {
    expect(rewriteViewerHtml('<div>바뀌지 않음</div>')).toBe('<div>바뀌지 않음</div>');
  });
});

describe('pendingSummary', () => {
  it('손상과 사진이 둘 다 있으면 둘 다 쓴다', () => {
    expect(pendingSummary(2, 3)).toBe('서버에 아직 안 올라감: 손상 2개 · 사진 3장');
  });

  it('사진만 있으면 손상은 뺀다', () => {
    expect(pendingSummary(0, 3)).toBe('서버에 아직 안 올라감: 사진 3장');
  });

  it('손상만 있으면 사진은 뺀다', () => {
    expect(pendingSummary(1, 0)).toBe('서버에 아직 안 올라감: 손상 1개');
  });

  it('둘 다 0이면 null(배지 숨김)', () => {
    expect(pendingSummary(0, 0)).toBeNull();
  });
});

describe('effectiveDecision', () => {
  it('열어 둔 도면의 pull은 건너뛴다(none)', () => {
    expect(effectiveDecision('pull', 'd1', 'd1')).toBe('none');
  });

  it('열어 둔 도면이라도 push는 한다', () => {
    expect(effectiveDecision('push', 'd1', 'd1')).toBe('push');
  });

  it('다른 도면의 pull은 그대로 한다', () => {
    expect(effectiveDecision('pull', 'd2', 'd1')).toBe('pull');
  });

  it('skipPullFor가 없으면 결정을 그대로 돌려준다', () => {
    expect(effectiveDecision('pull', 'd1', undefined)).toBe('pull');
    expect(effectiveDecision('none', 'd1', undefined)).toBe('none');
  });
});

describe('mergeSyncDecision — 서버가 손상 단위로 합치는 뒤의 판단(2026-10-07)', () => {
  const T1 = '2026-10-07T00:00:00.000Z';
  const T2 = '2026-10-07T01:00:00.000Z';
  const T3 = '2026-10-07T02:00:00.000Z';

  it('기기에서 고친 것이 있으면 서버가 더 새것이어도 push(서버가 합쳐 준다)', () => {
    expect(mergeSyncDecision(T2, T1, T3)).toBe('push');
    expect(mergeSyncDecision(T2, T1, null)).toBe('push');
  });
  it('서버와 맞춘 기록이 없는 로컬 문서는 push', () => {
    expect(mergeSyncDecision(T1, null, T3)).toBe('push');
  });
  it('고친 것이 없고 서버가 새것이면 pull', () => {
    expect(mergeSyncDecision(T1, T1, T2)).toBe('pull');
  });
  it('고친 것이 없고 서버도 같거나 오래됐으면 none', () => {
    expect(mergeSyncDecision(T2, T2, T2)).toBe('none');
    expect(mergeSyncDecision(T2, T2, T1)).toBe('none');
    expect(mergeSyncDecision(T2, T2, null)).toBe('none');
  });
  it('로컬 문서가 없으면 서버가 있을 때만 pull', () => {
    expect(mergeSyncDecision(null, null, T1)).toBe('pull');
    expect(mergeSyncDecision(null, null, null)).toBe('none');
  });
});
