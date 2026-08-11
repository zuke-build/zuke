/**
 * Settling a cancelled run's durable state: the cancel-lock handshake that
 * decides whether *this* process owns the compensation walk, the walk itself,
 * and the audit trail it leaves behind.
 *
 * The walk is {@link "./cancel.ts".runCompensations}, shared with the
 * out-of-process `zuke cancel`; what lives here is the in-process half —
 * everything {@link "./executor.ts".execute} does once its plan has settled and
 * the run turns out to have been cancelled.
 *
 * @module
 */

import type { TargetBuilder } from "./target.ts";
import type { Reporter } from "./reporter.ts";
import type { Redactor } from "./redact.ts";
import type { Lifecycle } from "./lifecycle.ts";
import type { RunStateWriter } from "./state/writer.ts";
import type { SignalRecord } from "./state/types.ts";
import { cancelEvent, compensationEvents, runCompensations } from "./cancel.ts";

/**
 * Settle a cancelled run's durable state: hold the per-run cancel lock, walk
 * the succeeded targets' compensations in reverse, record them in the audit
 * trail, and mark the run cancelled — unless another process owns the walk.
 */
/** What a cancellation settlement did, so the caller can decide about the cache. */
export interface CancelSettlement {
  /**
   * Whether *this* process ran the compensation walk. False when another
   * process owns the cancellation, in which case what it will undo is unknown
   * here.
   */
  ownedWalk: boolean;
  /** How many compensations were attempted, successful or not. */
  compensated: number;
}

export async function settleCancelledRun(opts: {
  writer: RunStateWriter;
  life: Lifecycle;
  order: TargetBuilder[];
  runId: string;
  actor: string;
  signals: ReadonlyMap<string, SignalRecord>;
  reporter: Reporter;
  redactor: Redactor;
  nowIso: () => string;
  isExternallyCancelled: () => boolean;
  /** Whether this process has lost the run's lease (see {@link "../cancel.ts".CompensationDeps.stop}). */
  isLeaseLost?: () => boolean;
}): Promise<CancelSettlement> {
  const { writer, life, order, runId, actor, reporter } = opts;
  // Hold the per-run cancel lock while we compensate, so a concurrent
  // `zuke cancel` can't settle the run (declaring "no compensations") over
  // our live cleanup. We only reach here with `externallyCancelled` false
  // (the true case stopped above), so always attempt the acquire; a `null`
  // result means another process already holds the lock and owns the walk —
  // we stop and drain (F7).
  const cancelLock = await writer.acquireCancelLock(actor);
  if (cancelLock === null) {
    await writer.drain();
    reporter.info(
      `Run ${runId} cancelled by another process — stopping.`,
    );
    return { ownedWalk: false, compensated: 0 };
  } else {
    try {
      // We initiated it (Ctrl-C / options.signal): mark cancelling (which
      // also drains every pending per-target write, so the snapshot is
      // current).
      await writer.markRunCancelling();
      // markRunCancelling drains the write chain, so if another process's
      // `zuke cancel` won the race in the meantime, the conflict has already
      // fired onExternalCancel. Re-check before walking, so we never run the
      // compensations twice (that canceller owns them now).
      if (opts.isExternallyCancelled()) {
        await writer.drain();
        reporter.info(
          `Run ${runId} cancelled by another process — stopping.`,
        );
        return { ownedWalk: false, compensated: 0 };
      } else {
        // Announce the intermediate `cancelling` transition (the record was
        // just moved there) before compensations run, so a plugin sees the
        // full running → cancelling → cancelled sequence.
        await life.runStateChange(writer.snapshot());
        // Run the succeeded targets' compensations in reverse order, record
        // the cancellation in the audit trail (as `zuke cancel` does), then
        // settle.
        const comp = await runCompensations(order, writer.snapshot(), {
          runId,
          signals: opts.signals,
          reporter,
          redactor: opts.redactor,
          stop: opts.isLeaseLost,
        });
        const at = opts.nowIso();
        for (const event of compensationEvents(comp.attempts, actor, at)) {
          await writer.appendEvent(event);
        }
        await writer.appendEvent(cancelEvent(actor, comp, at));
        await writer.markRunCancelled();
        reporter.info(
          `Run ${runId} cancelled — ${comp.compensated.length} ` +
            `compensation(s) ran${
              comp.failures.length > 0 ? `, ${comp.failures.length} failed` : ""
            }.`,
        );
        return {
          ownedWalk: true,
          compensated: comp.compensated.length + comp.failures.length,
        };
      }
    } finally {
      await cancelLock?.release();
    }
  }
}
