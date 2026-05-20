import { describe, expect, it } from "vitest";
import {
  getGroqRateLimitUsagePercent,
  parseGroqRateLimitHeaders,
} from "../../src/utils/groq-rate-limit";

function headersFromRecord(record: Record<string, string>): Headers {
  return new Headers(record);
}

describe("parseGroqRateLimitHeaders", () => {
  it("parses valid Groq rate limit headers", () => {
    const status = parseGroqRateLimitHeaders(
      headersFromRecord({
        "x-ratelimit-remaining-requests": "1847",
        "x-ratelimit-limit-requests": "2000",
        "x-ratelimit-reset-requests": "2m59.56s",
      }),
      "models",
    );

    expect(status).toEqual({
      remainingRequests: 1847,
      limitRequests: 2000,
      resetRequestsText: "2m59.56s",
      updatedAt: expect.any(String),
      source: "models",
    });
  });

  it("returns null when required headers are missing", () => {
    expect(
      parseGroqRateLimitHeaders(headersFromRecord({}), "refresh"),
    ).toBeNull();
  });

  it("returns null when header values are not numbers", () => {
    expect(
      parseGroqRateLimitHeaders(
        headersFromRecord({
          "x-ratelimit-remaining-requests": "many",
          "x-ratelimit-limit-requests": "2000",
        }),
        "transcription",
      ),
    ).toBeNull();
  });
});

describe("getGroqRateLimitUsagePercent", () => {
  it("calculates used percentage from remaining and limit", () => {
    expect(
      getGroqRateLimitUsagePercent({
        remainingRequests: 500,
        limitRequests: 2000,
        updatedAt: new Date().toISOString(),
        source: "models",
      }),
    ).toBe(75);
  });

  it("returns 0 when limit is zero", () => {
    expect(
      getGroqRateLimitUsagePercent({
        remainingRequests: 0,
        limitRequests: 0,
        updatedAt: new Date().toISOString(),
        source: "models",
      }),
    ).toBe(0);
  });
});
