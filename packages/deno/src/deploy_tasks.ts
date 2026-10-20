// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `DenoDeployTasks` — typed task functions for
 * [Deno Deploy](https://deno.com/deploy) through `deno deploy`, in the
 * settings-lambda style.
 *
 * ```ts
 * import { DenoDeployTasks } from "@zuke/deno";
 * await DenoDeployTasks.deploy((s) =>
 *   s.token(token).org("acme").app("api").prod().json().nonInteractive()
 * );
 * ```
 *
 * The binary is the `deno` running the build, as for `DenoTasks`. The token
 * travels in `DENO_DEPLOY_TOKEN`, never on the command line.
 *
 * @module
 */

import { type Configure, runSettings } from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";
import { DenoDeployCreateSettings, DenoDeploySettings } from "./deploy.ts";
import {
  DenoDeployEnvDeleteSettings,
  DenoDeployEnvListSettings,
  DenoDeployEnvLoadSettings,
  DenoDeployEnvUpdateContextsSettings,
  DenoDeployEnvValueSettings,
} from "./deploy_env.ts";
import {
  DenoDeployAppsGetSettings,
  DenoDeployAppsListSettings,
  DenoDeployDeploymentsListSettings,
  DenoDeployLogsSettings,
  DenoDeployQuerySettings,
} from "./deploy_query.ts";

/** The shape of {@link DenoDeployTasks}. */
export interface DenoDeployTasksApi {
  /** Deploy a directory to an application: `deno deploy`. */
  deploy(configure?: Configure<DenoDeploySettings>): Promise<CommandOutput>;
  /** Create an application: `deno deploy create`. */
  create(
    configure?: Configure<DenoDeployCreateSettings>,
  ): Promise<CommandOutput>;
  /** List an application's variables: `deno deploy env list`. */
  envList(
    configure?: Configure<DenoDeployEnvListSettings>,
  ): Promise<CommandOutput>;
  /** Add a variable: `deno deploy env add`. */
  envAdd(
    configure: Configure<DenoDeployEnvValueSettings>,
  ): Promise<CommandOutput>;
  /** Change a variable's value: `deno deploy env update-value`. */
  envUpdateValue(
    configure: Configure<DenoDeployEnvValueSettings>,
  ): Promise<CommandOutput>;
  /** Change the contexts a variable applies in: `deno deploy env update-contexts`. */
  envUpdateContexts(
    configure: Configure<DenoDeployEnvUpdateContextsSettings>,
  ): Promise<CommandOutput>;
  /** Delete a variable: `deno deploy env delete`. */
  envDelete(
    configure: Configure<DenoDeployEnvDeleteSettings>,
  ): Promise<CommandOutput>;
  /** Load variables from a `.env` file: `deno deploy env load`. */
  envLoad(
    configure: Configure<DenoDeployEnvLoadSettings>,
  ): Promise<CommandOutput>;
  /** Print an application's logs: `deno deploy logs`. */
  logs(configure?: Configure<DenoDeployLogsSettings>): Promise<CommandOutput>;
  /** List an application's deployments: `deno deploy deployments list`. */
  deploymentsList(
    configure?: Configure<DenoDeployDeploymentsListSettings>,
  ): Promise<CommandOutput>;
  /** List an organization's applications: `deno deploy apps list`. */
  appsList(
    configure?: Configure<DenoDeployAppsListSettings>,
  ): Promise<CommandOutput>;
  /** Show an application, with its production URL: `deno deploy apps get`. */
  appsGet(
    configure?: Configure<DenoDeployAppsGetSettings>,
  ): Promise<CommandOutput>;
  /** List the organizations the token reaches: `deno deploy orgs list`. */
  orgsList(
    configure?: Configure<DenoDeployQuerySettings>,
  ): Promise<CommandOutput>;
  /** Check the token: `deno deploy whoami`. */
  whoami(
    configure?: Configure<DenoDeployQuerySettings>,
  ): Promise<CommandOutput>;
}

/** Typed task functions for `deno deploy`. */
export const DenoDeployTasks: DenoDeployTasksApi = {
  deploy: (configure) => runSettings(new DenoDeploySettings(), configure),
  create: (configure) => runSettings(new DenoDeployCreateSettings(), configure),
  envList: (configure) =>
    runSettings(new DenoDeployEnvListSettings(), configure),
  envAdd: (configure) =>
    runSettings(new DenoDeployEnvValueSettings("add"), configure),
  envUpdateValue: (configure) =>
    runSettings(new DenoDeployEnvValueSettings("update-value"), configure),
  envUpdateContexts: (configure) =>
    runSettings(new DenoDeployEnvUpdateContextsSettings(), configure),
  envDelete: (configure) =>
    runSettings(new DenoDeployEnvDeleteSettings(), configure),
  envLoad: (configure) =>
    runSettings(new DenoDeployEnvLoadSettings(), configure),
  logs: (configure) => runSettings(new DenoDeployLogsSettings(), configure),
  deploymentsList: (configure) =>
    runSettings(new DenoDeployDeploymentsListSettings(), configure),
  appsList: (configure) =>
    runSettings(new DenoDeployAppsListSettings(), configure),
  appsGet: (configure) =>
    runSettings(new DenoDeployAppsGetSettings(), configure),
  orgsList: (configure) =>
    runSettings(new DenoDeployQuerySettings("orgs list"), configure),
  whoami: (configure) =>
    runSettings(new DenoDeployQuerySettings("whoami"), configure),
};
