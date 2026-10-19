import { expect, it } from "vitest";
import { createTaskScope } from "./taskScope";

it("starts closed and invalidates work on close and every reopen", () => {
  const scope = createTaskScope();
  expect(scope.signal().aborted).toBe(true);
  scope.open();
  const first = scope.signal();
  expect(first.aborted).toBe(false);
  scope.close();
  expect(first.aborted).toBe(true);
  scope.open();
  const second = scope.signal();
  expect(second.aborted).toBe(false);
  expect(first.aborted).toBe(true);
  scope.open();
  expect(second.aborted).toBe(true);
  expect(scope.signal().aborted).toBe(false);
});
