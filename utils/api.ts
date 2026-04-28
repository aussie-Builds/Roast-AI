// Safe JSON POST helper for RoastLab API calls.
//
// Returns a discriminated union so callers never have to deal with raw
// JSON.parse errors, HTML error pages, or network exceptions. User-facing
// `message` strings are friendly; technical detail goes to console in dev.

export type ApiErrorKind = 'network' | 'invalid' | 'server';

export type ApiResult<T> =
  | { ok: true; data: T; latencyMs: number }
  | { ok: false; kind: ApiErrorKind; message: string; status?: number; latencyMs: number };

const NETWORK_MESSAGE =
  'Couldn’t reach RoastLab. Check your connection and try again.';
const INVALID_MESSAGE =
  'Server response was invalid. Please try again.';
const GENERIC_SERVER_MESSAGE =
  'Something went wrong. Please try again.';

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  options?: { deviceId?: string; headers?: Record<string, string> },
): Promise<ApiResult<T>> {
  const t0 = Date.now();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers ?? {}),
  };
  if (options?.deviceId) headers['x-device-id'] = options.deviceId;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (__DEV__) console.warn('[api] network error', err);
    return { ok: false, kind: 'network', message: NETWORK_MESSAGE, latencyMs: Date.now() - t0 };
  }

  const text = await response.text().catch(() => '');
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (__DEV__) {
        console.warn('[api] non-JSON response', {
          status: response.status,
          preview: text.slice(0, 200),
        });
      }
      return {
        ok: false,
        kind: 'invalid',
        message: INVALID_MESSAGE,
        status: response.status,
        latencyMs: Date.now() - t0,
      };
    }
  }

  if (!response.ok) {
    // Backend errors already include a user-friendly `message` field
    // (rate_limited, cooldown, payload_too_large, service_disabled, etc.).
    const serverMsg = typeof parsed?.message === 'string' && parsed.message.trim()
      ? parsed.message.trim()
      : GENERIC_SERVER_MESSAGE;
    return {
      ok: false,
      kind: 'server',
      message: serverMsg,
      status: response.status,
      latencyMs: Date.now() - t0,
    };
  }

  return { ok: true, data: parsed as T, latencyMs: Date.now() - t0 };
}
