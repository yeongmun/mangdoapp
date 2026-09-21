// ProjectsStore 규칙 검증. 스펙: docs/superpowers/specs/2026-09-21-projects-design.md 2.1
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isProjectId, newProjectId, ProjectRuleError, ProjectsStore } from '../src/projectsStore.js';

let dir: string;
let store: ProjectsStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mangdo-projects-'));
  store = new ProjectsStore(join(dir, 'projects.json'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('프로젝트 id', () => {
  it('newProjectId는 형식을 지키고 매번 다르다', () => {
    const a = newProjectId();
    const b = newProjectId();
    expect(isProjectId(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('형식이 다르면 거부', () => {
    expect(isProjectId('p_123')).toBe(false);
    expect(isProjectId(null)).toBe(false);
    expect(isProjectId(42)).toBe(false);
  });
});

describe('ProjectsStore.create', () => {
  it('최상위 프로젝트를 만든다', async () => {
    const created = await store.create({ name: '오봉대교 정밀점검', memo: '2026년' }, '2026-09-21T00:00:00.000Z');
    expect(created).toMatchObject({
      name: '오봉대교 정밀점검',
      memo: '2026년',
      parentId: null,
      createdAt: '2026-09-21T00:00:00.000Z',
    });
    expect(isProjectId(created.id)).toBe(true);
    expect(await store.list()).toEqual([created]);
  });

  it('하위 프로젝트를 만든다(부모의 parentId가 null일 때)', async () => {
    const top = await store.create({ name: 'OO용역 2026' }, '2026-09-21T00:00:00.000Z');
    const child = await store.create({ name: 'A교', parentId: top.id }, '2026-09-21T00:00:01.000Z');
    expect(child.parentId).toBe(top.id);
    expect((await store.list()).map((p) => p.id)).toEqual([top.id, child.id]);
  });

  it('이름 앞뒤 공백을 뗀다', async () => {
    const created = await store.create({ name: '  A교  ' }, '2026-09-21T00:00:00.000Z');
    expect(created.name).toBe('A교');
  });

  it('memo가 없으면 빈 문자열이고 앞뒤 공백을 뗀다', async () => {
    const noMemo = await store.create({ name: '이름1' }, '2026-09-21T00:00:00.000Z');
    expect(noMemo.memo).toBe('');
    const trimmed = await store.create({ name: '이름2', memo: '  메모  ' }, '2026-09-21T00:00:00.000Z');
    expect(trimmed.memo).toBe('메모');
  });

  it('name 규칙: 비었거나 80자 초과면 code=name, 문구 그대로', async () => {
    await expect(store.create({ name: '' }, 'x')).rejects.toMatchObject({
      code: 'name',
      message: '프로젝트 이름은 1~80자로 적어 주세요.',
    });
    await expect(store.create({ name: '   ' }, 'x')).rejects.toMatchObject({ code: 'name' });
    await expect(store.create({ name: 'a'.repeat(81) }, 'x')).rejects.toMatchObject({ code: 'name' });
    await expect(store.create({ name: 123 }, 'x')).rejects.toMatchObject({ code: 'name' });
    const err = await store.create({ name: '' }, 'x').catch((e) => e);
    expect(err).toBeInstanceOf(ProjectRuleError);
    expect(err.name).toBe('ProjectRuleError');
  });

  it('memo 규칙: 500자 초과면 code=memo, 문구 그대로', async () => {
    await expect(store.create({ name: '이름', memo: 'a'.repeat(501) }, 'x')).rejects.toMatchObject({
      code: 'memo',
      message: '메모는 500자까지 적을 수 있습니다.',
    });
  });

  it('parent 규칙: 없는 parentId, 문구 그대로', async () => {
    await expect(store.create({ name: '이름', parentId: newProjectId() }, 'x')).rejects.toMatchObject({
      code: 'parent',
      message: '상위 프로젝트를 찾을 수 없습니다.',
    });
  });

  it('parent 규칙: parentId가 문자열이 아니면(null/undefined/"" 제외) parent 오류', async () => {
    await expect(store.create({ name: '이름', parentId: 123 }, 'x')).rejects.toMatchObject({ code: 'parent' });
    await expect(store.create({ name: '이름', parentId: {} }, 'x')).rejects.toMatchObject({ code: 'parent' });
  });

  it('depth 규칙: 하위 프로젝트 아래에는 만들 수 없다, 문구 그대로', async () => {
    const top = await store.create({ name: 'OO용역' }, 'x');
    const child = await store.create({ name: 'A교', parentId: top.id }, 'x');
    await expect(store.create({ name: 'B슬래브', parentId: child.id }, 'x')).rejects.toMatchObject({
      code: 'depth',
      message: '하위 프로젝트 안에는 프로젝트를 만들 수 없습니다.',
    });
  });

  it('duplicate 규칙: 같은 자리 같은 이름 거부, 문구 그대로. 다른 자리는 허용', async () => {
    await store.create({ name: '이름' }, 'x');
    await expect(store.create({ name: '이름' }, 'x')).rejects.toMatchObject({
      code: 'duplicate',
      message: '같은 자리에 같은 이름의 프로젝트가 있습니다.',
    });
    // 공백만 다르면 같은 이름(trim 후 비교)
    await expect(store.create({ name: ' 이름 ' }, 'x')).rejects.toMatchObject({ code: 'duplicate' });

    const top1 = await store.create({ name: '현장1' }, 'x');
    const top2 = await store.create({ name: '현장2' }, 'x');
    await store.create({ name: 'A교', parentId: top1.id }, 'x');
    // 다른 parentId(다른 자리)라면 같은 이름도 허용
    await expect(store.create({ name: 'A교', parentId: top2.id }, 'x')).resolves.toMatchObject({ name: 'A교' });
  });

  it('동시에 create 10개를 보내도 모두 남는다', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.create({ name: `이름${i}` }, `2026-09-21T00:00:0${i}.000Z`)),
    );
    expect((await store.list()).length).toBe(10);
  });
});

describe('ProjectsStore.update', () => {
  it('준 키만 바꾸고 나머지는 그대로다', async () => {
    const created = await store.create({ name: '이름', memo: '메모' }, 'x');
    const updated = await store.update(created.id, { memo: '새 메모' });
    expect(updated).toMatchObject({ id: created.id, name: '이름', memo: '새 메모', parentId: null });
  });

  it('자기 자신의 이름으로 고치는 것은 중복이 아니다', async () => {
    const created = await store.create({ name: '이름' }, 'x');
    await expect(store.update(created.id, { name: '이름' })).resolves.toMatchObject({ name: '이름' });
    await expect(store.update(created.id, { name: '  이름  ' })).resolves.toMatchObject({ name: '이름' });
  });

  it('형제와 이름이 겹치면 duplicate', async () => {
    await store.create({ name: '이름A' }, 'x');
    const b = await store.create({ name: '이름B' }, 'x');
    await expect(store.update(b.id, { name: '이름A' })).rejects.toMatchObject({ code: 'duplicate' });
  });

  it('없는 id는 null', async () => {
    expect(await store.update(newProjectId(), { name: '이름' })).toBeNull();
  });

  it('규칙 위반 시 저장하지 않는다', async () => {
    const created = await store.create({ name: '이름' }, 'x');
    await expect(store.update(created.id, { name: '' })).rejects.toMatchObject({ code: 'name' });
    expect(await store.get(created.id)).toMatchObject({ name: '이름' });
  });
});

describe('ProjectsStore.remove', () => {
  it('비어 있으면 지우고 지운 레코드를 돌려준다', async () => {
    const created = await store.create({ name: '이름' }, 'x');
    const removed = await store.remove(created.id, { drawingCount: 0 });
    expect(removed).toMatchObject({ id: created.id });
    expect(await store.get(created.id)).toBeNull();
  });

  it('없는 id는 null', async () => {
    expect(await store.remove(newProjectId(), { drawingCount: 0 })).toBeNull();
  });

  it('도면이 있으면 notEmpty, 문구에 N·M이 정확히 들어간다', async () => {
    const created = await store.create({ name: '이름' }, 'x');
    await expect(store.remove(created.id, { drawingCount: 3 })).rejects.toMatchObject({
      code: 'notEmpty',
      message: '비어 있는 프로젝트만 삭제할 수 있습니다. 도면 3개, 하위 프로젝트 0개가 있습니다.',
    });
  });

  it('하위 프로젝트가 있으면 notEmpty, M이 하위 수와 같다', async () => {
    const top = await store.create({ name: '이름' }, 'x');
    await store.create({ name: 'A교', parentId: top.id }, 'x');
    await store.create({ name: 'B교', parentId: top.id }, 'x');
    await expect(store.remove(top.id, { drawingCount: 0 })).rejects.toMatchObject({
      code: 'notEmpty',
      message: '비어 있는 프로젝트만 삭제할 수 있습니다. 도면 0개, 하위 프로젝트 2개가 있습니다.',
    });
  });

  it('규칙 위반 시 지우지 않는다', async () => {
    const created = await store.create({ name: '이름' }, 'x');
    await expect(store.remove(created.id, { drawingCount: 1 })).rejects.toThrow();
    expect(await store.get(created.id)).not.toBeNull();
  });
});
