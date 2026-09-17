/**
 * Accès à l'API Avisio depuis le navigateur et depuis le rendu serveur.
 *
 * Le jeton de session vit en `localStorage` : l'espace gérant est une SPA
 * derrière l'API, il n'y a pas de rendu serveur authentifié. La landing NFC,
 * elle, est rendue côté serveur sans aucun jeton.
 */

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? process.env.PUBLIC_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'avisio.token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // navigation privée : la session ne survivra pas au rechargement
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = options;
  const token = auth ? getToken() : null;

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `Erreur ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* corps non JSON */
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

/** Appel serveur (landing NFC) : pas de cache, la décision de routage est vivante. */
export async function serverApi<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  try {
    const response = await fetch(`${API_URL}${path}`, { ...init, cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
