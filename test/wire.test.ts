import { expect, test } from "bun:test";
import {
  prepareWireValue,
  MAX_WIRE_BYTES,
  MAX_WIRE_DEPTH,
} from "../src/wire.js";
import { defineApi, type ApiDefinition } from "../src/main/api.js";

test("wire data rejects conversions, prototypes, accessors and cycles without evaluating getters", () => {
  let invoked = 0;
  const accessor = Object.defineProperty({}, "x", {
    enumerable: true,
    get() {
      invoked++;
      return 1;
    },
  });
  const toJSON = {
    toJSON() {
      invoked++;
      return 1;
    },
  };
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  for (const value of [
    undefined,
    NaN,
    Infinity,
    1n,
    Symbol(),
    () => 1,
    new Date(),
    new Map(),
    new Set(),
    new Uint8Array(1),
    accessor,
    toJSON,
    cycle,
    // oxlint-disable-next-line no-sparse-arrays -- Deliberately malformed wire input.
    [, 1],
    [undefined],
    { x: undefined },
    { [Symbol()]: 1 },
    Object.create({ x: 1 }),
  ]) {
    expect(() => prepareWireValue(value)).toThrow();
  }
  expect(invoked).toBe(0);
  const shared = { id: 1 };
  expect(prepareWireValue({ a: shared, b: shared })).toEqual({
    a: shared,
    b: shared,
  });
  const dangerousKey = JSON.parse('{"__proto__":{"x":1}}');
  expect(Object.hasOwn(prepareWireValue(dangerousKey), "__proto__")).toBe(true);
});

test("wire size is exact UTF-8 JSON size and nesting is bounded", () => {
  expect(prepareWireValue("x".repeat(MAX_WIRE_BYTES - 2)).length).toBe(
    MAX_WIRE_BYTES - 2,
  );
  expect(() => prepareWireValue("x".repeat(MAX_WIRE_BYTES - 1))).toThrow(
    "payload size",
  );
  expect(() => prepareWireValue("あ".repeat(MAX_WIRE_BYTES / 3))).toThrow(
    "payload size",
  );
  let value: unknown = 0;
  for (let i = 0; i < MAX_WIRE_DEPTH; i++) value = [value];
  expect(() => prepareWireValue(value)).not.toThrow();
  expect(() => prepareWireValue([value])).toThrow("nesting depth");
});

test("definition rejects recognizable async functions before they execute", () => {
  let executed = false;
  const unsafe: ApiDefinition = {
    query: {},
    mutation: {
      bad: {
        async run(_input: {}) {
          executed = true;
          return null;
        },
      },
    },
  };
  // JavaScript callers can bypass the static contract, but not runtime validation.
  expect(() =>
    (defineApi as (api: ApiDefinition) => ApiDefinition)(unsafe),
  ).toThrow("Async handlers");
  expect(executed).toBe(false);
});
