// Pure generation/revision bookkeeping for the scratch pad's debounced autosave
// (ui/rpi.tsx ScratchPadPanel). No timers, no RPC: the component owns those and asks
// this state machine what to do.
//
// The bug this exists to prevent: a debounce timer captures text at keystroke time and fires
// ~600ms later. If a save that was already in flight comes back as a conflict (someone else
// edited the scratch pad), the panel reloads the winning text and revision. A debounce timer
// that was already queued before the reload still fires afterward and, without this guard,
// submits its stale captured text using the *new* revision, silently overwriting the winner.
//
// Fix: every local edit is stamped with a "generation". A conflict bumps the generation. A
// queued flush (debounce firing, or an in-flight save's response) is only allowed to act if its
// stamped generation still matches the current one; a stale one is dropped instead of applied.
export class ScratchPadSync {
  private generation = 0;
  private revision: number;

  constructor(initialRevision = 0) {
    this.revision = initialRevision;
  }

  currentRevision(): number {
    return this.revision;
  }

  /** Task switch / initial load: adopt the server's revision, discard any prior generation. */
  reload(revision: number): void {
    this.revision = revision;
    this.generation += 1;
  }

  /** Stamp a just-scheduled debounce (or an unmount flush) with the generation it was typed in. */
  stampEdit(): number {
    return this.generation;
  }

  /**
   * A debounce timer is about to fire (or an unmount flush is about to run). Returns whether the
   * captured text is still current, i.e. no conflict reload happened since it was captured. A
   * false result means: drop the flush, do not call the save RPC at all.
   */
  shouldFlush(stampedGeneration: number): boolean {
    return stampedGeneration === this.generation;
  }

  /**
   * A save RPC succeeded with an ordinary (non-conflict) outcome. Returns whether the caller
   * should apply the new revision, false if a conflict reload happened while the request was in
   * flight (the response is for stale text and must be discarded, not treated as authoritative).
   */
  applyOk(stampedGeneration: number, newRevision: number): boolean {
    if (stampedGeneration !== this.generation) return false;
    this.revision = newRevision;
    return true;
  }

  /**
   * A save RPC came back as a conflict. Always authoritative (the server fact wins regardless of
   * the local generation): adopts the reloaded revision and bumps the generation so any pending
   * debounce or in-flight save based on the pre-conflict text is invalidated.
   */
  applyConflict(newRevision: number): void {
    this.revision = newRevision;
    this.generation += 1;
  }
}
