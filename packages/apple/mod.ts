// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/apple` — typed task wrappers for Apple's code-signing tools in Zuke
 * builds: `codesign`, `xcrun notarytool`, `security` and `ditto`.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. Sign, zip, notarize, from a throwaway keychain:
 *
 * ```ts
 * import {
 *   CodesignTasks,
 *   DittoTasks,
 *   NotarytoolTasks,
 *   SecurityTasks,
 * } from "@zuke/apple";
 *
 * await SecurityTasks.temporaryKeychain(
 *   (s) => s.certificate(p12Base64).certificatePassword(p12Password),
 *   async ({ keychain, identity }) => {
 *     await CodesignTasks.sign((s) =>
 *       s.identity(identity.hash).keychain(keychain).options("runtime")
 *         .timestamp().force().file("dist/MyApp.app")
 *     );
 *   },
 * );
 * await DittoTasks.archive((s) =>
 *   s.keepParent().source("dist/MyApp.app").destination("dist/MyApp.zip")
 * );
 * await NotarytoolTasks.submit((s) =>
 *   s.file("dist/MyApp.zip").key("AuthKey.p8").keyId(keyId).issuer(issuer)
 *     .wait().timeout("30m")
 * );
 * ```
 *
 * @module
 */

export {
  CodesignDisplaySettings,
  CodesignSettings,
  CodesignSignSettings,
  CodesignTasks,
  type CodesignTasksApi,
  CodesignVerifySettings,
} from "./src/codesign.ts";
export type { CodesignDisplay } from "./src/codesign_display.ts";
export { DittoSettings, DittoTasks, type DittoTasksApi } from "./src/ditto.ts";
export {
  KeychainCleanupError,
  type KeychainCleanupFailure,
  KeychainError,
  NotarizationError,
  NotarytoolOutputError,
} from "./src/errors.ts";
export {
  type TemporaryKeychain,
  TemporaryKeychainSettings,
} from "./src/keychain.ts";
export type { KeychainHost } from "./src/keychain_host.ts";
export {
  NotarytoolHistorySettings,
  NotarytoolInfoSettings,
  NotarytoolLogSettings,
  NotarytoolSubmitSettings,
  NotarytoolTasks,
  type NotarytoolTasksApi,
} from "./src/notarytool.ts";
export type {
  NotarytoolIssue,
  NotarytoolLog,
  NotarytoolSubmission,
} from "./src/notarytool_result.ts";
export { NotarytoolSettings } from "./src/notarytool_settings.ts";
export { SecurityTasks, type SecurityTasksApi } from "./src/security.ts";
export {
  type SecurityImportFormat,
  SecurityImportSettings,
  type SecurityItemType,
  SecuritySetKeyPartitionListSettings,
} from "./src/security_import.ts";
export {
  SecurityCreateKeychainSettings,
  SecurityDeleteKeychainSettings,
  SecuritySetKeychainSettings,
  SecurityUnlockKeychainSettings,
} from "./src/security_keychain.ts";
export {
  type SecurityDomain,
  SecurityFindIdentitySettings,
  type SecurityIdentity,
  SecurityListKeychainsSettings,
} from "./src/security_search.ts";
export { SecuritySettings } from "./src/security_settings.ts";
