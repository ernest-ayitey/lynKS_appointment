export class ApiError extends Error {
  status: number;
  errors?: Record<string, string>;

  constructor(message: string, status: number, errors?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

export async function apiRequest<T>(
  path: string,
  options?: { method?: string; body?: unknown; accessToken?: string | null },
): Promise<T> {
  const { method, body, accessToken } = options ?? {};
  const url = `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1${path}`;

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.ok) {
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  let data: { error?: string; errors?: Record<string, string> } = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  throw new ApiError(data.error ?? response.statusText, response.status, data.errors);
}
