// OpenAI's moderation endpoint (omni-moderation-latest): a free second opinion on images,
// and the fallback when the Decisions API refuses to answer.

import { ApiError } from './decisions.js';

const ENDPOINT = 'https://api.openai.com/v1/moderations';

/**
 * @param {string} dataUrl base64 image data URL
 * @param {string} [text] message text posted with the image
 * @returns {Promise<{flagged: boolean, categories: object, category_scores: object}>}
 */
export async function moderateImage(dataUrl, text, { timeoutMs = 10_000 } = {}) {
  const input = [{ type: 'image_url', image_url: { url: dataUrl } }];
  if (text) input.unshift({ type: 'text', text });

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'omni-moderation-latest', input }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new ApiError('Moderation API', res.status, await res.text());

  const { results } = await res.json();
  return results[0];
}
