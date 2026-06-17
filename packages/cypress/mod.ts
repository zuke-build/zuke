/**
 * `@zuke/cypress` — typed `CypressTasks` wrappers for the
 * [Cypress](https://cypress.io) CLI (end-to-end and component testing), for use
 * in Zuke builds.
 *
 * ```ts
 * import { CypressTasks } from "jsr:@zuke/cypress";
 *
 * await CypressTasks.run((s) => s.e2e().browser("chrome"));
 * ```
 *
 * @module
 */

export {
  CypressInfoSettings,
  CypressInstallSettings,
  CypressOpenSettings,
  CypressRunSettings,
  CypressTasks,
  type CypressTasksApi,
  CypressVerifySettings,
} from "./src/cypress.ts";
