/**
 * `@zuke/openapi-ts` — typed `openapi-ts` task wrappers for Zuke builds.
 *
 * `openapi-ts` is the [Hey API](https://heyapi.dev) code generator
 * (`@hey-api/openapi-ts`): it turns an OpenAPI specification into a type-safe
 * client. Configure a fluent settings object in a lambda; the task builds the
 * argv and runs it.
 *
 * ```ts
 * import { OpenapiTsTasks } from "jsr:@zuke/openapi-ts";
 * await OpenapiTsTasks.generate((s) =>
 *   s.input("openapi.yaml").output("src/client")
 * );
 * ```
 *
 * @module
 */

export * from "./src/openapi_ts.ts";
