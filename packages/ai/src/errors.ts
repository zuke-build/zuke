/**
 * The error type raised across `@zuke/ai`.
 *
 * @module
 */

/** Raised when a reviewer is misconfigured, the API fails, or the gate trips. */
export class AiReviewError extends Error {
  override name = "AiReviewError";
  constructor(message: string) {
    super(message);
  }
}
