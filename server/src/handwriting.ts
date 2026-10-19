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
  // 모델이 설명을 덧붙이거나 따옴표·단위를 섞어도 숫자를 찾는다(2026-10-19: 앞뒤를 고정한 정규식이라
  // "0.2/0.3" 외의 글이 조금만 섞여도 전부 null이 됐다). O/o→0, l/I→1은 손글씨 전사의 흔한 혼동.
  let s = text
    .replace(/[`"'“”‘’]/g, ' ')
    .replace(/[，]/g, ',')
    .replace(/(?<=\d)[Oo]|[Oo](?=[.,]?\d)/g, '0')
    .replace(/(?<=\d)[lI|]|[lI|](?=[.,]?\d)/g, '1');
  let count: number | null = null;
  // 개소: 3EA · 3ea · 3개 · 3개소 (어디에 있든 첫 번째)
  const ea = /(\d+)\s*(?:EA|ea|Ea|개소|개)(?![a-zA-Z가-힣])/.exec(s);
  if (ea) {
    count = Number(ea[1]);
    s = s.slice(0, ea.index) + ' ' + s.slice(ea.index + ea[0].length);
  }
  // 숫자 뒤의 단위(mm, m, ㎡, cm)는 뗀다 — "0.2mm/0.3m"
  s = s.replace(/(\d)\s*(mm|cm|㎡|m2|m)(?![a-zA-Z])/gi, '$1');
  const pair = new RegExp(`${NUM}\\s*[/x×X*]\\s*${NUM}`).exec(s);
  if (pair) {
    // 뒤에 x3처럼 붙은 개소: "1.2x0.5x3"
    if (count === null) {
      const rest = s.slice(pair.index + pair[0].length);
      const trailing = /^\s*[x×X*]\s*(\d+)(?![.,\d])/.exec(rest);
      if (trailing) count = Number(trailing[1]);
    }
    return { width: num(pair[1]), length: num(pair[2]), count, text };
  }
  const single = new RegExp(NUM).exec(s);
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
