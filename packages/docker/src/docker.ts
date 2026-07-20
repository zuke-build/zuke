/**
 * `DockerTasks` — typed task functions for the `docker` CLI, in the same
 * settings-lambda style as the other Zuke tool wrappers: configure a fluent
 * settings object in a lambda, and the task function builds the command line
 * and executes it.
 *
 * ```ts
 * import { DockerTasks } from "jsr:@zuke/docker";
 * await DockerTasks.build((s) => s.tag("app:latest").file("Dockerfile"));
 * await DockerTasks.push((s) => s.image("app:latest"));
 * ```
 *
 * Arguments stay a discrete argv array end-to-end — never a concatenated shell
 * string — so command construction is injection-free.
 *
 * @module
 */

import {
  type Configure,
  type PathLike,
  runSettings,
  ToolSettings,
} from "@zuke/core/tooling";
import type { CommandOutput } from "@zuke/core/shell";

/** Base for all `docker` subcommand settings: the binary is `docker`. */
export abstract class DockerSettings extends ToolSettings {
  /** The invoked binary is `docker`. */
  protected override defaultTool(): string {
    return "docker";
  }
}

/** Settings for `docker build`. */
export class DockerBuildSettings extends DockerSettings {
  #tags: string[] = [];
  #file?: string;
  #target?: string;
  #platform?: string;
  #buildArgs: string[] = [];
  #noCache = false;
  #pull = false;
  #push = false;
  #context = ".";

  /** Add an image tag (`-t`); repeatable. */
  tag(reference: string): this {
    this.#tags.push(reference);
    return this;
  }

  /** Use an explicit Dockerfile (`-f`). */
  file(path: PathLike): this {
    this.#file = String(path);
    return this;
  }

  /** Build a specific stage (`--target`). */
  target(stage: string): this {
    this.#target = stage;
    return this;
  }

  /** Set the target platform(s) (`--platform`). */
  platform(value: string): this {
    this.#platform = value;
    return this;
  }

  /** Pass a build-time variable (`--build-arg KEY=value`); repeatable. */
  buildArg(key: string, value: string): this {
    this.#buildArgs.push("--build-arg", `${key}=${value}`);
    return this;
  }

  /** Do not use the layer cache (`--no-cache`). */
  noCache(): this {
    this.#noCache = true;
    return this;
  }

  /** Always attempt to pull newer base images (`--pull`). */
  pull(): this {
    this.#pull = true;
    return this;
  }

  /** Push the result to the registry after building (`--push`). */
  push(): this {
    this.#push = true;
    return this;
  }

  /** The build context path or URL (default `.`). */
  context(path: PathLike): this {
    this.#context = String(path);
    return this;
  }

  /** Assemble the `docker build` argv. */
  protected override buildArgs(): string[] {
    const argv = ["build"];
    for (const t of this.#tags) argv.push("-t", t);
    if (this.#file !== undefined) argv.push("-f", this.#file);
    if (this.#target !== undefined) argv.push("--target", this.#target);
    if (this.#platform !== undefined) argv.push("--platform", this.#platform);
    if (this.#noCache) argv.push("--no-cache");
    if (this.#pull) argv.push("--pull");
    if (this.#push) argv.push("--push");
    argv.push(...this.#buildArgs);
    argv.push(this.#context);
    return argv;
  }
}

/** Settings for `docker run`. */
export class DockerRunSettings extends DockerSettings {
  #image?: string;
  #name?: string;
  #rm = false;
  #detach = false;
  #interactive = false;
  #tty = false;
  #env: string[] = [];
  #publish: string[] = [];
  #volumes: string[] = [];
  #network?: string;
  #commandArgs: string[] = [];

  /** The image to run (required). */
  image(reference: string): this {
    this.#image = reference;
    return this;
  }

  /** Assign a container name (`--name`). */
  name(value: string): this {
    this.#name = value;
    return this;
  }

  /** Remove the container when it exits (`--rm`). */
  rm(): this {
    this.#rm = true;
    return this;
  }

  /** Run the container in the background (`-d`). */
  detach(): this {
    this.#detach = true;
    return this;
  }

  /** Keep STDIN open (`-i`). */
  interactive(): this {
    this.#interactive = true;
    return this;
  }

  /** Allocate a pseudo-TTY (`-t`). */
  tty(): this {
    this.#tty = true;
    return this;
  }

  /** Set a container environment variable (`-e KEY=value`); repeatable. */
  envVar(key: string, value: string): this {
    this.#env.push("-e", `${key}=${value}`);
    return this;
  }

  /** Publish a container port to the host (`-p host:container`). */
  publish(host: string | number, container: string | number): this {
    this.#publish.push("-p", `${host}:${container}`);
    return this;
  }

  /** Bind-mount or attach a volume (`-v source:target`). */
  volume(source: PathLike, target: PathLike): this {
    this.#volumes.push("-v", `${String(source)}:${String(target)}`);
    return this;
  }

  /** Connect the container to a network (`--network`). */
  network(value: string): this {
    this.#network = value;
    return this;
  }

  /** The command and arguments to run inside the container. */
  commandArgs(...args: Array<string | number>): this {
    this.#commandArgs.push(...args.map(String));
    return this;
  }

  /** Assemble the `docker run` argv. */
  protected override buildArgs(): string[] {
    if (this.#image === undefined) {
      throw new Error("DockerTasks.run: .image() is required.");
    }
    const argv = ["run"];
    if (this.#rm) argv.push("--rm");
    if (this.#detach) argv.push("-d");
    if (this.#interactive) argv.push("-i");
    if (this.#tty) argv.push("-t");
    if (this.#name !== undefined) argv.push("--name", this.#name);
    if (this.#network !== undefined) argv.push("--network", this.#network);
    argv.push(...this.#env, ...this.#publish, ...this.#volumes);
    argv.push(this.#image, ...this.#commandArgs);
    return argv;
  }
}

/** Settings for `docker exec`. */
export class DockerExecSettings extends DockerSettings {
  #container?: string;
  #interactive = false;
  #tty = false;
  #env: string[] = [];
  #workdir?: string;
  #commandArgs: string[] = [];

  /** The target container (required). */
  container(name: string): this {
    this.#container = name;
    return this;
  }

  /** Keep STDIN open (`-i`). */
  interactive(): this {
    this.#interactive = true;
    return this;
  }

  /** Allocate a pseudo-TTY (`-t`). */
  tty(): this {
    this.#tty = true;
    return this;
  }

  /** Set an environment variable for the command (`-e KEY=value`). */
  envVar(key: string, value: string): this {
    this.#env.push("-e", `${key}=${value}`);
    return this;
  }

  /** Working directory inside the container (`-w`). */
  workdir(path: PathLike): this {
    this.#workdir = String(path);
    return this;
  }

  /** The command and arguments to execute. */
  commandArgs(...args: Array<string | number>): this {
    this.#commandArgs.push(...args.map(String));
    return this;
  }

  /** Assemble the `docker exec` argv. */
  protected override buildArgs(): string[] {
    if (this.#container === undefined) {
      throw new Error("DockerTasks.exec: .container() is required.");
    }
    const argv = ["exec"];
    if (this.#interactive) argv.push("-i");
    if (this.#tty) argv.push("-t");
    argv.push(...this.#env);
    if (this.#workdir !== undefined) argv.push("-w", this.#workdir);
    argv.push(this.#container, ...this.#commandArgs);
    return argv;
  }
}

/** Settings for `docker push`. */
export class DockerPushSettings extends DockerSettings {
  #image?: string;
  #allTags = false;

  /** The image reference to push (required). */
  image(reference: string): this {
    this.#image = reference;
    return this;
  }

  /** Push every tag of the repository (`--all-tags`). */
  allTags(): this {
    this.#allTags = true;
    return this;
  }

  /** Assemble the `docker push` argv. */
  protected override buildArgs(): string[] {
    if (this.#image === undefined) {
      throw new Error("DockerTasks.push: .image() is required.");
    }
    const argv = ["push"];
    if (this.#allTags) argv.push("--all-tags");
    argv.push(this.#image);
    return argv;
  }
}

/** Settings for `docker pull`. */
export class DockerPullSettings extends DockerSettings {
  #image?: string;
  #platform?: string;
  #quiet = false;

  /** The image reference to pull (required). */
  image(reference: string): this {
    this.#image = reference;
    return this;
  }

  /** Pull a specific platform (`--platform`). */
  platform(value: string): this {
    this.#platform = value;
    return this;
  }

  /** Suppress verbose output (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Assemble the `docker pull` argv. */
  protected override buildArgs(): string[] {
    if (this.#image === undefined) {
      throw new Error("DockerTasks.pull: .image() is required.");
    }
    const argv = ["pull"];
    if (this.#platform !== undefined) argv.push("--platform", this.#platform);
    if (this.#quiet) argv.push("-q");
    argv.push(this.#image);
    return argv;
  }
}

/** Settings for `docker tag`. */
export class DockerTagSettings extends DockerSettings {
  #source?: string;
  #target?: string;

  /** The existing image reference (required). */
  source(reference: string): this {
    this.#source = reference;
    return this;
  }

  /** The new image reference (required). */
  target(reference: string): this {
    this.#target = reference;
    return this;
  }

  /** Assemble the `docker tag` argv. */
  protected override buildArgs(): string[] {
    if (this.#source === undefined || this.#target === undefined) {
      throw new Error("DockerTasks.tag: .source() and .target() are required.");
    }
    return ["tag", this.#source, this.#target];
  }
}

/** Settings for `docker login`. */
export class DockerLoginSettings extends DockerSettings {
  #username?: string;
  #password?: string;
  #passwordStdin = false;
  #registry?: string;

  /** The username (`-u`). */
  username(value: string): this {
    this.#username = value;
    return this;
  }

  /** The password (`-p`); prefer {@link passwordStdin} in CI. */
  password(value: string): this {
    this.#password = value;
    return this;
  }

  /** Read the password from STDIN (`--password-stdin`). */
  passwordStdin(): this {
    this.#passwordStdin = true;
    return this;
  }

  /** The registry server (defaults to Docker Hub). */
  registry(server: string): this {
    this.#registry = server;
    return this;
  }

  /** Assemble the `docker login` argv. */
  protected override buildArgs(): string[] {
    const argv = ["login"];
    if (this.#username !== undefined) argv.push("-u", this.#username);
    if (this.#password !== undefined) argv.push("-p", this.#password);
    if (this.#passwordStdin) argv.push("--password-stdin");
    if (this.#registry !== undefined) argv.push(this.#registry);
    return argv;
  }
}

/** Settings for `docker images`. */
export class DockerImagesSettings extends DockerSettings {
  #all = false;
  #quiet = false;
  #filters: string[] = [];
  #repository?: string;

  /** Show all images, including intermediate layers (`-a`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Only show image IDs (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Filter the listing (`--filter`); repeatable. */
  filter(expression: string): this {
    this.#filters.push("--filter", expression);
    return this;
  }

  /** Restrict to a repository (positional argument). */
  repository(name: string): this {
    this.#repository = name;
    return this;
  }

  /** Assemble the `docker images` argv. */
  protected override buildArgs(): string[] {
    const argv = ["images"];
    if (this.#all) argv.push("-a");
    if (this.#quiet) argv.push("-q");
    argv.push(...this.#filters);
    if (this.#repository !== undefined) argv.push(this.#repository);
    return argv;
  }
}

/** Settings for `docker ps`. */
export class DockerPsSettings extends DockerSettings {
  #all = false;
  #quiet = false;
  #filters: string[] = [];

  /** Show stopped containers too (`-a`). */
  all(): this {
    this.#all = true;
    return this;
  }

  /** Only show container IDs (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Filter the listing (`--filter`); repeatable. */
  filter(expression: string): this {
    this.#filters.push("--filter", expression);
    return this;
  }

  /** Assemble the `docker ps` argv. */
  protected override buildArgs(): string[] {
    const argv = ["ps"];
    if (this.#all) argv.push("-a");
    if (this.#quiet) argv.push("-q");
    argv.push(...this.#filters);
    return argv;
  }
}

/** Settings for `docker stop`. */
export class DockerStopSettings extends DockerSettings {
  #containers: string[] = [];
  #time?: number;

  /** The containers to stop (at least one is required). */
  containers(...names: string[]): this {
    this.#containers.push(...names);
    return this;
  }

  /** Seconds to wait before killing (`-t`). */
  time(seconds: number): this {
    this.#time = seconds;
    return this;
  }

  /** Assemble the `docker stop` argv. */
  protected override buildArgs(): string[] {
    if (this.#containers.length === 0) {
      throw new Error("DockerTasks.stop: at least one container is required.");
    }
    const argv = ["stop"];
    if (this.#time !== undefined) argv.push("-t", String(this.#time));
    argv.push(...this.#containers);
    return argv;
  }
}

/** Settings for `docker start`. */
export class DockerStartSettings extends DockerSettings {
  #containers: string[] = [];
  #attach = false;

  /** The containers to start (at least one is required). */
  containers(...names: string[]): this {
    this.#containers.push(...names);
    return this;
  }

  /** Attach STDOUT/STDERR and forward signals (`-a`). */
  attach(): this {
    this.#attach = true;
    return this;
  }

  /** Assemble the `docker start` argv. */
  protected override buildArgs(): string[] {
    if (this.#containers.length === 0) {
      throw new Error("DockerTasks.start: at least one container is required.");
    }
    const argv = ["start"];
    if (this.#attach) argv.push("-a");
    argv.push(...this.#containers);
    return argv;
  }
}

/** Settings for `docker rm`. */
export class DockerRmSettings extends DockerSettings {
  #containers: string[] = [];
  #force = false;
  #volumes = false;

  /** The containers to remove (at least one is required). */
  containers(...names: string[]): this {
    this.#containers.push(...names);
    return this;
  }

  /** Force removal of a running container (`-f`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Also remove anonymous volumes (`-v`). */
  volumes(): this {
    this.#volumes = true;
    return this;
  }

  /** Assemble the `docker rm` argv. */
  protected override buildArgs(): string[] {
    if (this.#containers.length === 0) {
      throw new Error("DockerTasks.rm: at least one container is required.");
    }
    const argv = ["rm"];
    if (this.#force) argv.push("-f");
    if (this.#volumes) argv.push("-v");
    argv.push(...this.#containers);
    return argv;
  }
}

/** Settings for `docker rmi`. */
export class DockerRmiSettings extends DockerSettings {
  #images: string[] = [];
  #force = false;

  /** The images to remove (at least one is required). */
  images(...references: string[]): this {
    this.#images.push(...references);
    return this;
  }

  /** Force removal (`-f`). */
  force(): this {
    this.#force = true;
    return this;
  }

  /** Assemble the `docker rmi` argv. */
  protected override buildArgs(): string[] {
    if (this.#images.length === 0) {
      throw new Error("DockerTasks.rmi: at least one image is required.");
    }
    const argv = ["rmi"];
    if (this.#force) argv.push("-f");
    argv.push(...this.#images);
    return argv;
  }
}

/** Settings for `docker save`. */
export class DockerSaveSettings extends DockerSettings {
  #images: string[] = [];
  #output?: string;

  /** The images to save (at least one is required). */
  images(...references: string[]): this {
    this.#images.push(...references);
    return this;
  }

  /** Write to a file instead of STDOUT (`-o`). */
  output(path: PathLike): this {
    this.#output = String(path);
    return this;
  }

  /** Assemble the `docker save` argv. */
  protected override buildArgs(): string[] {
    if (this.#images.length === 0) {
      throw new Error("DockerTasks.save: at least one image is required.");
    }
    const argv = ["save"];
    if (this.#output !== undefined) argv.push("-o", this.#output);
    argv.push(...this.#images);
    return argv;
  }
}

/** Settings for `docker load`. */
export class DockerLoadSettings extends DockerSettings {
  #input?: string;
  #quiet = false;

  /** Read from a tar archive instead of STDIN (`-i`). */
  input(path: PathLike): this {
    this.#input = String(path);
    return this;
  }

  /** Suppress the load output (`-q`). */
  quietOutput(): this {
    this.#quiet = true;
    return this;
  }

  /** Assemble the `docker load` argv. */
  protected override buildArgs(): string[] {
    const argv = ["load"];
    if (this.#input !== undefined) argv.push("-i", this.#input);
    if (this.#quiet) argv.push("-q");
    return argv;
  }
}

/** The shape of {@link DockerTasks}. */
export interface DockerTasksApi {
  /** Build an image: `docker build`. */
  build(configure?: Configure<DockerBuildSettings>): Promise<CommandOutput>;
  /** Run a container: `docker run`. */
  run(configure?: Configure<DockerRunSettings>): Promise<CommandOutput>;
  /** Run a command in a container: `docker exec`. */
  exec(configure?: Configure<DockerExecSettings>): Promise<CommandOutput>;
  /** Push an image: `docker push`. */
  push(configure?: Configure<DockerPushSettings>): Promise<CommandOutput>;
  /** Pull an image: `docker pull`. */
  pull(configure?: Configure<DockerPullSettings>): Promise<CommandOutput>;
  /** Tag an image: `docker tag`. */
  tag(configure?: Configure<DockerTagSettings>): Promise<CommandOutput>;
  /** Authenticate to a registry: `docker login`. */
  login(configure?: Configure<DockerLoginSettings>): Promise<CommandOutput>;
  /** List images: `docker images`. */
  images(configure?: Configure<DockerImagesSettings>): Promise<CommandOutput>;
  /** List containers: `docker ps`. */
  ps(configure?: Configure<DockerPsSettings>): Promise<CommandOutput>;
  /** Stop containers: `docker stop`. */
  stop(configure?: Configure<DockerStopSettings>): Promise<CommandOutput>;
  /** Start containers: `docker start`. */
  start(configure?: Configure<DockerStartSettings>): Promise<CommandOutput>;
  /** Remove containers: `docker rm`. */
  rm(configure?: Configure<DockerRmSettings>): Promise<CommandOutput>;
  /** Remove images: `docker rmi`. */
  rmi(configure?: Configure<DockerRmiSettings>): Promise<CommandOutput>;
  /** Save images to a tar archive: `docker save`. */
  save(configure?: Configure<DockerSaveSettings>): Promise<CommandOutput>;
  /** Load images from a tar archive: `docker load`. */
  load(configure?: Configure<DockerLoadSettings>): Promise<CommandOutput>;
}

/** Typed task functions for the `docker` CLI. */
export const DockerTasks: DockerTasksApi = {
  build(configure?: Configure<DockerBuildSettings>): Promise<CommandOutput> {
    return runSettings(new DockerBuildSettings(), configure);
  },
  run(configure?: Configure<DockerRunSettings>): Promise<CommandOutput> {
    return runSettings(new DockerRunSettings(), configure);
  },
  exec(configure?: Configure<DockerExecSettings>): Promise<CommandOutput> {
    return runSettings(new DockerExecSettings(), configure);
  },
  push(configure?: Configure<DockerPushSettings>): Promise<CommandOutput> {
    return runSettings(new DockerPushSettings(), configure);
  },
  pull(configure?: Configure<DockerPullSettings>): Promise<CommandOutput> {
    return runSettings(new DockerPullSettings(), configure);
  },
  tag(configure?: Configure<DockerTagSettings>): Promise<CommandOutput> {
    return runSettings(new DockerTagSettings(), configure);
  },
  login(configure?: Configure<DockerLoginSettings>): Promise<CommandOutput> {
    return runSettings(new DockerLoginSettings(), configure);
  },
  images(configure?: Configure<DockerImagesSettings>): Promise<CommandOutput> {
    return runSettings(new DockerImagesSettings(), configure);
  },
  ps(configure?: Configure<DockerPsSettings>): Promise<CommandOutput> {
    return runSettings(new DockerPsSettings(), configure);
  },
  stop(configure?: Configure<DockerStopSettings>): Promise<CommandOutput> {
    return runSettings(new DockerStopSettings(), configure);
  },
  start(configure?: Configure<DockerStartSettings>): Promise<CommandOutput> {
    return runSettings(new DockerStartSettings(), configure);
  },
  rm(configure?: Configure<DockerRmSettings>): Promise<CommandOutput> {
    return runSettings(new DockerRmSettings(), configure);
  },
  rmi(configure?: Configure<DockerRmiSettings>): Promise<CommandOutput> {
    return runSettings(new DockerRmiSettings(), configure);
  },
  save(configure?: Configure<DockerSaveSettings>): Promise<CommandOutput> {
    return runSettings(new DockerSaveSettings(), configure);
  },
  load(configure?: Configure<DockerLoadSettings>): Promise<CommandOutput> {
    return runSettings(new DockerLoadSettings(), configure);
  },
};
