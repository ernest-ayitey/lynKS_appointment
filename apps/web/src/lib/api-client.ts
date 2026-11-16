export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && 'message' in data) {
      const { message } = data as { message: unknown };
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message)) {
        return message.join(', ');
      }
    }
  } catch {
    // Response body was not JSON (or was empty) — fall back below.
  }
  return response.statusText || 'Request failed';
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ApiError(response.status, await extractErrorMessage(response));
  }

  return (await response.json()) as T;
}

export const apiClient = { post };
