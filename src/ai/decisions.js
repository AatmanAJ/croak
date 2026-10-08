// Client for OpenAI's Decisions API (POST /v1/decisions, public beta since Oct 6 2026).
// Uses plain fetch instead of the SDK so timings aren't hidden behind automatic retries.

const ENDPOINT = 'https://api.openai.com/v1/decisions';

export const DECISIONS_MODEL = 'gpt-6-luna';
export const PRICE_PER_MILLION_INPUT_TOKENS = 0.1; // USD; output tokens are free

export class ApiError extends Error {
  constructor(service, status, body) {
    super(`${service} returned HTTP ${status}: ${body.slice(0, 300)}`);
    this.status = status;
  }
}

/**
 * Ask typed questions about one piece of evidence.
 * @param {object} opts
 * @param {string | object[]} opts.input text, or user messages with input_text / input_image parts
 * @param {object[]} opts.questions predicate, choice or score questions, each with a unique name
 * @returns {Promise<{answers: Record<string, object>, usage: object, model: string}>}
 */
export async function decide({ input, questions, timeoutMs = 10_000 }) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: DECISIONS_MODEL, input, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new ApiError('Decisions API', res.status, await res.text());

  const body = await res.json();
  // Answers come back in question order; key them by name so callers don't depend on order.
  // A refused question comes back as { type: 'refusal', name } with no probability.
  const answers = Object.fromEntries(body.answers.map((a) => [a.name, a]));
  return { answers, usage: body.usage, model: body.model };
}

/** Wrap text plus one image (a base64 data URL) as Decisions input. */
export function imageInput(text, dataUrl, detail = 'auto') {
  return [
    {
      role: 'user',
      content: [
        { type: 'input_text', text },
        { type: 'input_image', image_url: dataUrl, detail },
      ],
    },
  ];
}
