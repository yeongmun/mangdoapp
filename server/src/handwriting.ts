// 손글씨 인식(2026-10-09, 인프라스마트 태블릿 Pro의 "펜으로 치수 쓰기"). 뷰어가 펜 획을 그림(PNG)으로
// 보내면 AI(Claude 비전)가 **글자만 그대로 옮겨 적고**, 숫자 해석은 여기 순수 함수(parseHandwriting)가 한다 —
// 해석 규칙이 코드에 있어야 검산할 수 있고, 모델이 바뀌어도 결과가 같다.
//
// 사내 표기:  폭/길이  →  "0.2/0.3"   (균열: 폭 mm / 길이 m)
//            가로x세로 →  "1.2x0.5"  ("×", "X", "*"도 같다)
//            개소      →  "3EA", "3개", "x3"(뒤에 붙은 것)  — 없으면 null(기본 1은 저장 쪽이 정한다)
// 숫자 하나만 있으면 폭으로 본다(균열은 보통 폭만 적는다). 콤마는 소수점으로 본다("0,3").

export interface HandwritingValues {
  width: number | null;
  length: number | null;
  count: number | null;
  /** 모델이 옮겨 적은 원문. 사용자가 확인한다 */
  text: string;
}

export interface Transcriber {
  /** PNG 바이트의 손글씨를 글자로 옮긴다. 읽을 수 없으면 '' */
  transcribe(png: Buffer): Promise<string>;
}

const NUM = String.raw`(\d+(?:[.,]\d+)?|[.,]\d+)`;

function num(raw: string): number | null {
  const n = Number(raw.replace(',', '.').replace(/^[.,]/, '0.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseHandwriting(text: string): HandwritingValues {
  // O/o(영문)를 0으로, l/I를 1로 — 손글씨 전사에서 흔한 혼동. 공백은 개소를 뗀 뒤에 지운다
  // ("2.0 3EA"의 공백을 먼저 지우면 2.03EA가 된다).
  let s = text.trim().replace(/[Oo]/g, '0').replace(/[lI|]/g, '1');
  let count: number | null = null;
  // 개소: 3EA · 3ea · 3개 · 3개소(공백 있어도 됨), 또는 맨 뒤의 x3 / ×3
  const ea = /\s*(\d+)\s*(?:EA|ea|개소|개)\s*$/.exec(s);
  if (ea) {
    count = Number(ea[1]);
    s = s.slice(0, ea.index);
  }
  s = s.replace(/\s+/g, '');
  if (count === null) {
    const trailing = /[x×X*](\d+)$/.exec(s);
    if (trailing && /[/x×X*]/.test(s.slice(0, trailing.index))) {
      count = Number(trailing[1]);
      s = s.slice(0, trailing.index);
    }
  }
  const pair = new RegExp(`^${NUM}[/x×X*]${NUM}$`).exec(s);
  if (pair) return { width: num(pair[1]), length: num(pair[2]), count, text };
  const single = new RegExp(`^${NUM}$`).exec(s);
  if (single) return { width: num(single[1]), length: null, count, text };
  return { width: null, length: null, count, text };
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_HANDWRITING_MODEL = 'claude-sonnet-5-5';

const PROMPT =
  '이 그림은 교량 점검자가 태블릿 펜으로 쓴 짧은 손글씨입니다. 보이는 글자를 **있는 그대로** 한 줄로 옮겨 적으세요. ' +
  '숫자, 소수점, 슬래시(/), 곱하기(x), "EA"·"개" 같은 단위만 나옵니다. 해석하거나 단위를 바꾸거나 설명을 붙이지 말고, ' +
  '글자가 없거나 읽을 수 없으면 빈 줄만 출력하세요.';

/** Claude 비전으로 옮겨 적는다. 키가 없으면 만들지 않는다(앱에 "서버에 키가 없다"고 알린다). */
export class ClaudeTranscriber implements Transcriber {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_HANDWRITING_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(png: Buffer): Promise<string> {
    const res = await this.fetchImpl(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 64,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`손글씨 인식 요청 실패 (${res.status}) ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (data.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text!)
      .join('')
      .trim();
  }
}
