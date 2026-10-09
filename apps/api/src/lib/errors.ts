import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ApiError {
  error: { code: string; message: string };
}

export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  return c.json<ApiError>({ error: { code, message } }, status);
}

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
