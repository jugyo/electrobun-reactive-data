export const MAX_WIRE_BYTES = 256 * 1024;
export const MAX_WIRE_DEPTH = 64;

/** Validate descriptors before serialization: do not call application getters/toJSON. */
export function prepareWireValue<T>(value: T): T {
  const ancestors = new Set<object>();
  let bytes = 0;
  const encoder = new TextEncoder();
  const charge = (token: string) => {
    bytes += encoder.encode(token).byteLength;
    if (bytes > MAX_WIRE_BYTES)
      throw new Error("Wire value exceeds the supported payload size");
  };
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > MAX_WIRE_DEPTH)
      throw new Error("Wire value exceeds the supported nesting depth");
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      charge(JSON.stringify(item));
      return item;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      charge(JSON.stringify(item));
      return item;
    }
    if (typeof item !== "object" || item === null)
      throw new Error("Unsupported wire value");
    if (ancestors.has(item)) throw new Error("Cyclic wire value");
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (
      array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      throw new Error("Wire values must be plain objects or arrays");
    ancestors.add(item);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key === "symbol"))
        throw new Error("Unsupported wire symbol key");
      if (array) {
        const length = descriptors.length!.value as number;
        if (keys.length !== length + 1)
          throw new Error("Wire arrays must be dense without extra properties");
        charge("[]");
        const result: unknown[] = [];
        for (let index = 0; index < length; index++) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
            throw new Error("Unsupported wire array property");
          if (index) charge(",");
          result.push(visit(descriptor.value, depth + 1));
        }
        return result;
      }
      charge("{}");
      const result = Object.create(null) as Record<string, unknown>;
      let index = 0;
      for (const key of keys as string[]) {
        const descriptor = descriptors[key]!;
        if (!("value" in descriptor) || !descriptor.enumerable)
          throw new Error("Unsupported wire object property");
        if (index++) charge(",");
        charge(JSON.stringify(key));
        charge(":");
        result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(item);
    }
  };
  return JSON.parse(JSON.stringify(visit(value, 0))) as T;
}

export function assertWireValue(value: unknown): void {
  prepareWireValue(value);
}
