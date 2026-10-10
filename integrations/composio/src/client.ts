/**
 * Thin REST client over the docketry API. The Composio toolkit never touches
 * Postgres — every tool call is an authenticated HTTP request against the
 * configured base URL, so the API's auth, scope, and state-machine rules stay
 * the single source of truth.
 */

/** Minimal fetch surface — satisfied by globalThis.fetch and test doubles. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

/** An error surfaced by the API's `{error:{code,message}}` envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Identity resolved by GET /v1/whoami. */
export interface Whoami {
  type: "agent" | "human";
  id: string;
  name: string;
  scopes: string[];
  workspaceId: string;
  workspaceSlug: string | null;
}

export interface DocketryClientConfig {
  /** API origin, e.g. https://docketry.example.com — no trailing slash needed. */
  baseUrl: string;
  /** Workspace slug — every resource route is /v1/workspaces/{ws}/… */
  workspace: string;
  /** dok_agt_* agent key or dok_pat_* personal access token. */
  apiKey: string;
  /** Injectable for tests — defaults to globalThis.fetch. */
  fetch?: FetchLike;
}

type Query = Record<string, string | number | boolean | undefined>;

export class DocketryClient {
  readonly baseUrl: string;
  readonly workspace: string;

  private readonly wsBase: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private cachedWhoami: Promise<Whoami> | null = null;

  constructor(config: DocketryClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.workspace = config.workspace;
    this.wsBase = `${this.baseUrl}/v1/workspaces/${encodeURIComponent(config.workspace)}`;
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetch ?? (fetch as unknown as FetchLike);
  }

  /** Identity of the presented credential (agent key or PAT). Cached — stable for the key's lifetime. */
  whoami(signal?: AbortSignal): Promise<Whoami> {
    this.cachedWhoami ??= this.request<Whoami>(
      "GET",
      `${this.baseUrl}/v1/whoami`,
      { signal },
    );
    return this.cachedWhoami;
  }

  apiGet<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
    return this.request<T>("GET", this.ws(path), { query, signal });
  }

  apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>("POST", this.ws(path), { body, signal });
  }

  apiPatch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>("PATCH", this.ws(path), { body, signal });
  }

  private ws(path: string): string {
    return `${this.wsBase}${path}`;
  }

  private async request<T>(
    method: string,
    url: string,
    opts: {
      query?: Query | undefined;
      body?: unknown;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<T> {
    let target = url;
    if (opts.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) target += `?${qs}`;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(target, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: "application/json",
          ...(opts.body !== undefined
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(opts.body !== undefined
          ? { body: JSON.stringify(opts.body) }
          : {}),
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      throw new ApiError(
        0,
        "UNREACHABLE",
        `cannot reach docketry API at ${this.baseUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const text = await res.text();
    let data: unknown = null;
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      const apiErr = (
        data as { error?: { code?: string; message?: string } } | null
      )?.error;
      throw new ApiError(
        res.status,
        apiErr?.code ?? "HTTP_ERROR",
        apiErr?.message ?? `HTTP ${res.status} from docketry API`,
      );
    }
    return data as T;
  }
}
