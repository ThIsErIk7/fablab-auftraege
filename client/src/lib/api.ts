export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Server nicht erreichbar. Läuft der Server (npm run dev)?');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Fehler ${res.status}`, data?.details);
  return data as T;
}

function safeJson(t: string) {
  try { return JSON.parse(t); } catch { return { error: t }; }
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T = void>(url: string) => request<T>('DELETE', url),
};

/** Datei-Download über einen normalen Link (Server setzt Content-Disposition). */
export function download(url: string) {
  const a = document.createElement('a');
  a.href = `/api${url}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const problems: string[] | undefined = e.details?.problems ?? e.details?.missing;
    return problems?.length && !e.message.includes(problems[0]) ? `${e.message}\n• ${problems.slice(0, 8).join('\n• ')}` : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export function qs(params: Record<string, string | number | boolean | undefined | null | string[]>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : v === true ? '1' : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
