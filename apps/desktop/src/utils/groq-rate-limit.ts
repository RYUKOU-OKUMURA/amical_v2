export type GroqRateLimitSource = "transcription" | "models" | "refresh";

export type GroqRateLimitStatus = {
  remainingRequests: number;
  limitRequests: number;
  resetRequestsText?: string;
  updatedAt: string;
  source: GroqRateLimitSource;
};

function parseRateLimitNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export function parseGroqRateLimitHeaders(
  headers: Headers,
  source: GroqRateLimitSource,
): GroqRateLimitStatus | null {
  const remainingRequests = parseRateLimitNumber(
    headers.get("x-ratelimit-remaining-requests"),
  );
  const limitRequests = parseRateLimitNumber(
    headers.get("x-ratelimit-limit-requests"),
  );

  if (remainingRequests === null || limitRequests === null) {
    return null;
  }

  const resetRequestsText =
    headers.get("x-ratelimit-reset-requests")?.trim() || undefined;

  return {
    remainingRequests,
    limitRequests,
    resetRequestsText,
    updatedAt: new Date().toISOString(),
    source,
  };
}

export function getGroqRateLimitUsagePercent(
  status: GroqRateLimitStatus,
): number {
  if (status.limitRequests <= 0) {
    return 0;
  }

  const used = status.limitRequests - status.remainingRequests;
  const percent = (used / status.limitRequests) * 100;
  return Math.min(100, Math.max(0, percent));
}
