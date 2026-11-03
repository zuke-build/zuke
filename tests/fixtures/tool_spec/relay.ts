// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * A task object typed by an interface that takes its tasks from the ones it
 * extends, the shape `GhTasks` has: the inherited tasks come first, in the
 * order the bases are listed, one a base shares is read once, and a task the
 * interface redeclares keeps its inherited place with the new signature.
 *
 * @module
 */

/** The task both bases inherit. */
export interface PingApi {
  /** Answer the name back. */
  ping(name: string): string;
}

/** Sending, on top of pinging. */
export interface SendApi extends PingApi {
  /** Send a message. */
  send(message: string): boolean;
}

/** Receiving, on top of pinging. */
export interface ReceiveApi extends PingApi {
  /** Receive up to `limit` messages. */
  receive(limit: number): string[];
}

/** The whole relay: both bases, and `send` redeclared. */
export interface RelayTasksApi extends SendApi, ReceiveApi {
  /** Send a message, to a channel. */
  send(message: string, channel?: string): boolean;
  /** Stop the relay. */
  stop(): void;
}

/** Tasks reached only through `extends`. */
export const RelayTasks: RelayTasksApi = {
  ping: (name) => name,
  send: (message) => message.length > 0,
  receive: () => [],
  stop: () => {},
};
