import type { DrawingStatus } from './drawingsStore.js';

export interface ManifestMessage {
  type?: string;
  code?: string;
  message?: string | string[];
}

// 오프라인 모드(설계 3.1): manifest의 파생물 트리 노드. svf 파생 아래 어딘가에 mime이
// application/autodesk-f2d인 resource 노드가 있고, 그 urn이 오프라인에 내려받을 f2d 파생이다.
export interface ManifestNode {
  type?: string;
  role?: string;
  mime?: string;
  urn?: string;
  name?: string;
  children?: ManifestNode[];
}

export interface ManifestLike {
  status: string;
  progress?: string;
  derivatives?: Array<{ status?: string; messages?: ManifestMessage[]; outputType?: string; children?: ManifestNode[] }>;
}

export interface ApsClients {
  getTwoLeggedToken(scopes: string[]): Promise<{ access_token: string; expires_in: number }>;
  getBucketDetails(bucketKey: string, accessToken: string): Promise<unknown>;
  createBucket(bucketKey: string, accessToken: string): Promise<unknown>;
  uploadObject(bucketKey: string, objectKey: string, data: Buffer, accessToken: string): Promise<{ objectId?: string }>;
  startJob(urn: string, accessToken: string): Promise<unknown>;
  getManifest(urn: string, accessToken: string): Promise<ManifestLike>;
  // 오프라인 모드(설계 3.1): manifest의 파생 파일(f2d, manifest.json.gz, metadata.json.gz) 바이트.
  downloadDerivative(urn: string, derivativeUrn: string, accessToken: string): Promise<Buffer>;
}

export interface TokenInfo {
  accessToken: string;
  expiresAt: number;
}

export interface TranslationStatus {
  status: DrawingStatus;
  progress: string;
  error: string | null;
}

const INTERNAL_SCOPES = ['data:read', 'data:write', 'data:create', 'bucket:create', 'bucket:read'];
const VIEWER_SCOPES = ['viewables:read'];
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function urnify(objectId: string): string {
  return Buffer.from(objectId, 'utf8').toString('base64url');
}

export function httpStatusOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const candidate = err as {
    httpStatusCode?: () => number | null;
    axiosError?: { response?: { status?: number } };
  };
  if (typeof candidate.httpStatusCode === 'function') {
    const status = candidate.httpStatusCode();
    if (typeof status === 'number') return status;
  }
  return candidate.axiosError?.response?.status ?? null;
}

function collectErrorMessages(manifest: ManifestLike): string | null {
  const texts: string[] = [];
  for (const derivative of manifest.derivatives ?? []) {
    for (const message of derivative.messages ?? []) {
      if (message.type !== 'error') continue;
      const text = Array.isArray(message.message) ? message.message.join(' ') : message.message;
      if (text) texts.push(message.code ? `${text} (${message.code})` : text);
    }
  }
  return texts.length > 0 ? texts.join(' / ') : null;
}

export function mapManifest(manifest: ManifestLike): TranslationStatus {
  const progress = manifest.progress ?? '';
  switch (manifest.status) {
    case 'success':
      return { status: 'success', progress, error: null };
    case 'inprogress':
      return { status: 'inprogress', progress, error: null };
    case 'failed':
      return { status: 'failed', progress, error: collectErrorMessages(manifest) ?? '변환에 실패했습니다.' };
    case 'timeout':
      return { status: 'failed', progress, error: collectErrorMessages(manifest) ?? '변환 시간이 초과되었습니다.' };
    default:
      return { status: 'pending', progress, error: null };
  }
}

export class ApsService {
  private internalToken: TokenInfo | null = null;
  private viewerToken: TokenInfo | null = null;

  constructor(
    private readonly clients: ApsClients,
    private readonly bucketKey: string,
    private readonly now: () => number = Date.now,
  ) {}

  async getInternalToken(): Promise<string> {
    this.internalToken = await this.freshToken(this.internalToken, INTERNAL_SCOPES);
    return this.internalToken.accessToken;
  }

  async getViewerToken(): Promise<TokenInfo> {
    this.viewerToken = await this.freshToken(this.viewerToken, VIEWER_SCOPES);
    return this.viewerToken;
  }

  async ensureBucket(): Promise<void> {
    const token = await this.getInternalToken();
    try {
      await this.clients.getBucketDetails(this.bucketKey, token);
      return;
    } catch (err) {
      if (httpStatusOf(err) !== 404) throw err;
    }
    try {
      await this.clients.createBucket(this.bucketKey, token);
    } catch (err) {
      if (httpStatusOf(err) !== 409) throw err;
    }
  }

  async uploadDrawing(data: Buffer, objectKey: string): Promise<{ urn: string }> {
    const token = await this.getInternalToken();
    const details = await this.clients.uploadObject(this.bucketKey, objectKey, data, token);
    const objectId = details.objectId ?? `urn:adsk.objects:os.object:${this.bucketKey}/${objectKey}`;
    return { urn: urnify(objectId) };
  }

  async startTranslation(urn: string): Promise<void> {
    await this.clients.startJob(urn, await this.getInternalToken());
  }

  async getTranslationStatus(urn: string): Promise<TranslationStatus> {
    const token = await this.getInternalToken();
    try {
      return mapManifest(await this.clients.getManifest(urn, token));
    } catch (err) {
      // 변환 요청 직후에는 manifest가 아직 없어 404가 온다.
      if (httpStatusOf(err) === 404) return { status: 'pending', progress: '', error: null };
      throw err;
    }
  }

  // 오프라인 모드(설계 3.1): getTranslationStatus와 달리 가공 없이 manifest 그대로 돌려준다 —
  // offlineFiles.ts가 이 안에서 f2d 파생 urn을 찾는다(findF2dUrn).
  async getRawManifest(urn: string): Promise<ManifestLike> {
    return this.clients.getManifest(urn, await this.getInternalToken());
  }

  // 오프라인 모드(설계 3.1): 파생 파일(f2d·manifest.json.gz·metadata.json.gz) 바이트를 받는다.
  async downloadDerivative(urn: string, derivativeUrn: string): Promise<Buffer> {
    return this.clients.downloadDerivative(urn, derivativeUrn, await this.getInternalToken());
  }

  private async freshToken(current: TokenInfo | null, scopes: string[]): Promise<TokenInfo> {
    if (current && current.expiresAt - REFRESH_MARGIN_MS > this.now()) return current;
    const token = await this.clients.getTwoLeggedToken(scopes);
    return { accessToken: token.access_token, expiresAt: this.now() + token.expires_in * 1000 };
  }
}
