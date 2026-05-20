import type { GroqRateLimitStatus } from "../utils/groq-rate-limit";

class GroqRateLimitCache {
  private status: GroqRateLimitStatus | null = null;

  update(status: GroqRateLimitStatus): void {
    this.status = status;
  }

  get(): GroqRateLimitStatus | null {
    return this.status;
  }

  clear(): void {
    this.status = null;
  }
}

export const groqRateLimitCache = new GroqRateLimitCache();
