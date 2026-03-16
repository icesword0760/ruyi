export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export async function getJson<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new HttpError(`GET ${url} failed`, response.status);
  }
  return (await response.json()) as T;
}

export async function postJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let message = `POST ${url} failed`;
    try {
      const error = (await response.json()) as { error?: string };
      if (error?.error) message = error.error;
    } catch {
      // ignore
    }
    throw new HttpError(message, response.status);
  }

  return (await response.json()) as T;
}
