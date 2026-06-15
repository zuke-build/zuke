/**
 * `@zuke/docker-compose` — typed Docker Compose task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. The wrapper detects whether Compose is installed as the v2 plugin
 * (`docker compose`) or the v1 standalone binary (`docker-compose`) at run
 * time, so the same build works on either host.
 *
 * ```ts
 * import { DockerComposeTasks } from "jsr:@zuke/docker-compose";
 *
 * await DockerComposeTasks.up((s) => s.file("compose.yml").detach().build());
 * await DockerComposeTasks.logs((s) => s.follow().tail(100));
 * await DockerComposeTasks.down((s) => s.volumes());
 * ```
 *
 * @module
 */

export * from "./src/docker_compose.ts";
