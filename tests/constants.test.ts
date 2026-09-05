import test from "node:test";
import assert from "node:assert/strict";
import { TASK_ROOT_DIR } from "../constants";

test("TASK_ROOT_DIR is the .rpi task artifact root", () => {
  assert.equal(TASK_ROOT_DIR, ".rpi");
});
