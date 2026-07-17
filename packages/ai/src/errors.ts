/**
 * The error type raised across `@zuke/ai`.
 *
 * @module
 */

/** Raised when a reviewer is misconfigured, the API fails, or the gate trips. */
export class AiReviewError extends Error {
  /** The error name. */
  override name = "AiReviewError";
  /** Create the error with a message. */
  constructor(message: string) {
    super(message);
  }
}
