/**
 * `@zuke/kubectl` — typed `kubectl` CLI task wrappers for Zuke builds, for
 * deploying to and managing Kubernetes from a pipeline.
 *
 * ```ts
 * import { KubectlTasks } from "jsr:@zuke/kubectl";
 *
 * await KubectlTasks.apply((s) => s.file("k8s/").namespace("prod"));
 * await KubectlTasks.setImage((s) =>
 *   s.resource("deployment/api").image("api", "api:1.4").namespace("prod")
 * );
 * await KubectlTasks.rollout((s) =>
 *   s.status().resource("deployment/api").namespace("prod").timeout("120s")
 * );
 * ```
 *
 * @module
 */

export * from "./src/kubectl.ts";
