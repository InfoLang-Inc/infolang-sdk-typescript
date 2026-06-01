import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  errorFromResponse,
  InfoLangAPIError,
  InfoLangConfigError,
  InfoLangConnectionError,
  InfoLangError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "../src/errors.js";

describe("errors", () => {
  it("maps status codes to typed API errors", () => {
    expect(errorFromResponse({ status: 401, body: { error: "unauthorized" } })).toBeInstanceOf(
      AuthenticationError,
    );
    expect(errorFromResponse({ status: 403, body: { message: "forbidden" } })).toBeInstanceOf(
      AuthenticationError,
    );
    expect(errorFromResponse({ status: 404, body: { detail: "missing" } })).toBeInstanceOf(
      NotFoundError,
    );
    expect(errorFromResponse({ status: 400, body: { error: "bad" } })).toBeInstanceOf(
      ValidationError,
    );
    expect(errorFromResponse({ status: 422 })).toBeInstanceOf(ValidationError);
    expect(errorFromResponse({ status: 429, retryAfter: 2 })).toBeInstanceOf(RateLimitError);
    expect(errorFromResponse({ status: 500 })).toBeInstanceOf(ServerError);
    expect(errorFromResponse({ status: 418 })).toBeInstanceOf(InfoLangAPIError);
  });

  it("extracts messages from body shapes and appends requestId", () => {
    const err = errorFromResponse({
      status: 404,
      body: { error: "gone" },
      requestId: "req_abc",
    });
    expect(err.message).toContain("gone");
    expect(err.message).toContain("request_id=req_abc");
    expect(err.requestId).toBe("req_abc");
  });

  it("uses string body and default message fallback", () => {
    expect(errorFromResponse({ status: 502, body: "upstream down" }).message).toContain(
      "upstream down",
    );
    expect(errorFromResponse({ status: 599 }).message).toContain("599");
  });

  it("exposes base error classes", () => {
    expect(new InfoLangError("x").name).toBe("InfoLangError");
    expect(new InfoLangConfigError("cfg").name).toBe("InfoLangConfigError");
    expect(new InfoLangConnectionError("conn").name).toBe("InfoLangConnectionError");
    expect(new RateLimitError("rl", { status: 429, retryAfter: 3 }).retryAfter).toBe(3);
  });
});
