import test from "node:test";
import assert from "node:assert/strict";
import { ScratchPadSync } from "../scratch-pad-sync";

test("type -> save in flight -> conflict reload -> queued debounce -> no stale submit", () => {
  const sync = new ScratchPadSync(1);

  // User types "A"; a debounce is scheduled, stamped with generation 0.
  const flushA = sync.stampEdit();
  assert.equal(sync.shouldFlush(flushA), true);

  // Debounce fires: save("A") goes in flight (revision 1, generation 0 captured at call time).
  const generationAtSaveA = sync.stampEdit();

  // While that save is in flight, the user types more ("B"); a second debounce is queued,
  // stamped with the same still-current generation.
  const flushB = sync.stampEdit();
  assert.equal(flushB, generationAtSaveA);

  // The in-flight save for "A" comes back as a conflict: someone else's revision 2 wins.
  sync.applyConflict(2);

  // The response to the in-flight save must not be treated as authoritative once the generation
  // has moved on (the component checks this before applying an "ok" outcome).
  assert.equal(sync.applyOk(generationAtSaveA, 99), false);
  assert.equal(sync.currentRevision(), 2); // untouched by the stale "ok" apply attempt

  // The queued debounce for "B" (scheduled before the conflict) now fires. It must be dropped,
  // not submitted with the post-conflict revision.
  assert.equal(sync.shouldFlush(flushB), false);

  // A fresh edit typed after the reload gets a new generation and does flush normally.
  const flushC = sync.stampEdit();
  assert.notEqual(flushC, flushB);
  assert.equal(sync.shouldFlush(flushC), true);
  assert.equal(sync.applyOk(flushC, 3), true);
  assert.equal(sync.currentRevision(), 3);
});

test("applyConflict bumps the generation even with no pending flush", () => {
  const sync = new ScratchPadSync(0);
  const gen = sync.stampEdit();
  sync.applyConflict(5);
  assert.equal(sync.currentRevision(), 5);
  assert.equal(sync.shouldFlush(gen), false);
});

test("reload (task switch) discards the previous generation", () => {
  const sync = new ScratchPadSync(0);
  const staleGeneration = sync.stampEdit();
  sync.reload(7);
  assert.equal(sync.currentRevision(), 7);
  assert.equal(sync.shouldFlush(staleGeneration), false);
});

test("a normal save with no intervening conflict applies cleanly", () => {
  const sync = new ScratchPadSync(0);
  const generation = sync.stampEdit();
  assert.equal(sync.shouldFlush(generation), true);
  assert.equal(sync.applyOk(generation, 1), true);
  assert.equal(sync.currentRevision(), 1);
});
