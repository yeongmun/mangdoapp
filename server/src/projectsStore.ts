// 프로젝트(폴더)를 저장·관리한다. 도면을 현장·구조물 단위로 묶는다 — 깊이는 최상위·하위
// 2단계까지다. 규칙을 어기면 ProjectRuleError를 던진다. 근거:
// docs/superpowers/specs/2026-09-21-projects-design.md 2.1

import { randomUUID } from 'node:crypto';
import { readJsonFile, writeJsonFileAtomic } from './jsonFile.js';

// 점검 종류는 최상위(과업)에, 시설물 종류는 하위(구조물)에만 둔다. 둘 다 선택 필드 — 옛 레코드에는
// 없다. 값 목록은 앱(src/api.ts)과 같아야 한다. 설계: docs/design/2026-10-24-field-photo-checklist.md 결정 5
export const INSPECTION_TYPES = ['정기안전점검', '정밀안전점검', '정밀안전진단'] as const;
export const FACILITY_TYPES = ['교량', '터널', '옹벽', '절토사면', '건축물', '기타'] as const;
// 과업구분: 웹(daenong)의 과업구분을 웹이 앱 프로젝트를 만들·연결할 때 넣는다(앱 목록 필터용, 2026-10-26).
// 최상위에만. 웹 app/work-status/lib/appLink.ts의 APP_LINKED_TASK_TYPES와 같은 값.
export const TASK_TYPES = ['정밀안전점검', '정기안전점검', '정밀안전진단', '옹벽(사급)'] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];
export type TaskType = (typeof TASK_TYPES)[number];
export type FacilityType = (typeof FACILITY_TYPES)[number];

export interface ProjectRecord {
  id: string;
  name: string;
  memo: string;
  parentId: string | null;
  createdAt: string;
  inspectionType?: InspectionType;
  facilityType?: FacilityType;
  taskType?: TaskType;
}

export type ProjectRuleCode = 'name' | 'memo' | 'parent' | 'depth' | 'duplicate' | 'notEmpty' | 'type';

export class ProjectRuleError extends Error {
  constructor(
    readonly code: ProjectRuleCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectRuleError';
  }
}

export const PROJECT_NAME_MAX = 80;
export const PROJECT_MEMO_MAX = 500;

const PROJECT_ID_PATTERN = /^p_[0-9a-f]{32}$/;

export function newProjectId(): string {
  return `p_${randomUUID().replaceAll('-', '')}`;
}

export function isProjectId(value: unknown): boolean {
  return typeof value === 'string' && PROJECT_ID_PATTERN.test(value);
}

function validateName(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (typeof value !== 'string' || trimmed.length < 1 || trimmed.length > PROJECT_NAME_MAX) {
    throw new ProjectRuleError('name', '프로젝트 이름은 1~80자로 적어 주세요.');
  }
  return trimmed;
}

function validateMemo(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new ProjectRuleError('memo', '메모는 500자까지 적을 수 있습니다.');
  const trimmed = value.trim();
  if (trimmed.length > PROJECT_MEMO_MAX) throw new ProjectRuleError('memo', '메모는 500자까지 적을 수 있습니다.');
  return trimmed;
}

// parentId가 null/undefined/''면 최상위다. 그 밖의 값은 문자열이어야 하고, 가리키는
// 프로젝트가 있어야 하며(parent), 그 프로젝트가 이미 하위(구조물)면 안 된다(depth) —
// 3단계가 되는 것을 막는다.
function resolveParentId(value: unknown, records: ProjectRecord[]): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new ProjectRuleError('parent', '상위 프로젝트를 찾을 수 없습니다.');
  const parent = records.find((r) => r.id === value);
  if (!parent) throw new ProjectRuleError('parent', '상위 프로젝트를 찾을 수 없습니다.');
  if (parent.parentId !== null) {
    throw new ProjectRuleError('depth', '하위 프로젝트 안에는 프로젝트를 만들 수 없습니다.');
  }
  return value;
}

const PLACE_MESSAGE = '점검 종류는 상위 프로젝트에, 시설물 종류는 구조물에만 둘 수 있습니다.';

// undefined면 "안 줌"(undefined 그대로). 값이 있으면 허용 목록에 있어야 하고 자리(parentId)가 맞아야 한다.
function validateInspectionType(value: unknown, parentId: string | null): InspectionType | undefined {
  if (value === undefined) return undefined;
  if (!INSPECTION_TYPES.includes(value as InspectionType)) {
    throw new ProjectRuleError('type', '점검 종류 값이 올바르지 않습니다.');
  }
  if (parentId !== null) throw new ProjectRuleError('type', PLACE_MESSAGE);
  return value as InspectionType;
}

function validateTaskType(value: unknown, parentId: string | null): TaskType | undefined {
  if (value === undefined) return undefined;
  if (!TASK_TYPES.includes(value as TaskType)) throw new ProjectRuleError('type', '과업구분 값이 올바르지 않습니다.');
  if (parentId !== null) throw new ProjectRuleError('type', '과업구분은 상위 프로젝트에만 둘 수 있습니다.');
  return value as TaskType;
}

function validateFacilityType(value: unknown, parentId: string | null): FacilityType | undefined {
  if (value === undefined) return undefined;
  if (!FACILITY_TYPES.includes(value as FacilityType)) {
    throw new ProjectRuleError('type', '시설물 종류 값이 올바르지 않습니다.');
  }
  if (parentId === null) throw new ProjectRuleError('type', PLACE_MESSAGE);
  return value as FacilityType;
}

function assertNoDuplicate(records: ProjectRecord[], parentId: string | null, name: string, excludeId?: string) {
  const clash = records.some((r) => r.id !== excludeId && r.parentId === parentId && r.name === name);
  if (clash) throw new ProjectRuleError('duplicate', '같은 자리에 같은 이름의 프로젝트가 있습니다.');
}

export class ProjectsStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  // 저장 순서 그대로 돌려준다 — 트리로 펴는 일은 projectTree.ts가 한다.
  async list(): Promise<ProjectRecord[]> {
    return this.readAll();
  }

  async get(id: string): Promise<ProjectRecord | null> {
    return (await this.readAll()).find((r) => r.id === id) ?? null;
  }

  create(
    input: { name: unknown; memo?: unknown; parentId?: unknown; inspectionType?: unknown; facilityType?: unknown; taskType?: unknown },
    createdAt: string,
  ): Promise<ProjectRecord> {
    return this.serialize(async () => {
      const records = await this.readAll();
      const name = validateName(input.name);
      const memo = validateMemo(input.memo);
      const parentId = resolveParentId(input.parentId, records);
      assertNoDuplicate(records, parentId, name);
      const record: ProjectRecord = { id: newProjectId(), name, memo, parentId, createdAt };
      const inspectionType = validateInspectionType(input.inspectionType, parentId);
      if (inspectionType !== undefined) record.inspectionType = inspectionType;
      const facilityType = validateFacilityType(input.facilityType, parentId);
      if (facilityType !== undefined) record.facilityType = facilityType;
      const taskType = validateTaskType(input.taskType, parentId);
      if (taskType !== undefined) record.taskType = taskType;
      await writeJsonFileAtomic(this.filePath, [...records, record]);
      return record;
    });
  }

  // 준 키만 바꾼다. parentId는 여기서 바꿀 수 없다(프로젝트 옮기기는 범위 밖).
  // inspectionType/facilityType/taskType은 null이면 지운다.
  update(
    id: string,
    patch: { name?: unknown; memo?: unknown; inspectionType?: unknown; facilityType?: unknown; taskType?: unknown },
  ): Promise<ProjectRecord | null> {
    return this.serialize(async () => {
      const records = await this.readAll();
      const index = records.findIndex((r) => r.id === id);
      if (index === -1) return null;
      const current = records[index];
      const next: ProjectRecord = { ...current };
      if ('name' in patch) {
        const name = validateName(patch.name);
        assertNoDuplicate(records, current.parentId, name, id);
        next.name = name;
      }
      if ('memo' in patch) {
        next.memo = validateMemo(patch.memo);
      }
      if ('inspectionType' in patch) {
        if (patch.inspectionType === null) delete next.inspectionType;
        else next.inspectionType = validateInspectionType(patch.inspectionType, current.parentId);
      }
      if ('facilityType' in patch) {
        if (patch.facilityType === null) delete next.facilityType;
        else next.facilityType = validateFacilityType(patch.facilityType, current.parentId);
      }
      if ('taskType' in patch) {
        if (patch.taskType === null) delete next.taskType;
        else next.taskType = validateTaskType(patch.taskType, current.parentId);
      }
      records[index] = next;
      await writeJsonFileAtomic(this.filePath, records);
      return next;
    });
  }

  // 하위 프로젝트나 도면이 있으면 지우지 않는다. 도면 수는 휴지통을 빼고 호출하는 쪽이
  // 센다(usage.drawingCount) — 휴지통 안 도면은 "비어 있음" 판단에 넣지 않는다(스펙 2.3).
  remove(id: string, usage: { drawingCount: number }): Promise<ProjectRecord | null> {
    return this.serialize(async () => {
      const records = await this.readAll();
      const index = records.findIndex((r) => r.id === id);
      if (index === -1) return null;
      const childCount = records.filter((r) => r.parentId === id).length;
      const drawingCount = usage.drawingCount;
      if (drawingCount > 0 || childCount > 0) {
        throw new ProjectRuleError(
          'notEmpty',
          `비어 있는 프로젝트만 삭제할 수 있습니다. 도면 ${drawingCount}개, 하위 프로젝트 ${childCount}개가 있습니다.`,
        );
      }
      const found = records[index];
      await writeJsonFileAtomic(
        this.filePath,
        records.filter((r) => r.id !== id),
      );
      return found;
    });
  }

  private async readAll(): Promise<ProjectRecord[]> {
    return (await readJsonFile<ProjectRecord[]>(this.filePath)) ?? [];
  }

  // 읽고-고치고-쓰기가 겹쳐 레코드를 잃지 않도록 쓰기 작업을 한 줄로 세운다
  // (DrawingsStore.serialize와 같은 방식).
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
