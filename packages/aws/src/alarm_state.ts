// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Reading one alarm's state out of a `describe-alarms` response. Internal to
 * the package; `AwsTasks.alarmState` is the public face.
 *
 * @module
 */

import type { CloudwatchAlarmState } from "./cloudwatch.ts";
import { AwsOutputError } from "./errors.ts";
import { isRecord } from "./shape.ts";

/**
 * The `--query` the reader pins: metric and composite alarms in one flat
 * list, so it reads either kind the same way.
 */
export const ALARMS_QUERY = "[MetricAlarms, CompositeAlarms][]";

/** Whether `value` is an alarm state. */
function isAlarmState(value: unknown): value is CloudwatchAlarmState {
  return value === "OK" || value === "ALARM" || value === "INSUFFICIENT_DATA";
}

/** The state of alarm `name` in `alarms`, the list {@link ALARMS_QUERY} projects. */
export function alarmStateOf(
  alarms: unknown,
  name: string,
): CloudwatchAlarmState {
  const task = "AwsTasks.alarmState";
  if (!Array.isArray(alarms)) {
    throw new AwsOutputError(
      task,
      "the describe-alarms response is not a list.",
    );
  }
  const alarm = alarms.find((entry) =>
    isRecord(entry) && entry.AlarmName === name
  );
  if (!isRecord(alarm)) {
    throw new AwsOutputError(
      task,
      `there is no alarm named "${name}" — check the name and the region.`,
    );
  }
  if (!isAlarmState(alarm.StateValue)) {
    throw new AwsOutputError(
      task,
      `alarm "${name}" has no StateValue of OK, ALARM or INSUFFICIENT_DATA.`,
    );
  }
  return alarm.StateValue;
}
