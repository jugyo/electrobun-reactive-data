// Private structural checks preserve named DTO interfaces without index signatures.
type IsAny<T> = 0 extends 1 & T ? true : false;
type InvalidMember<T, Depth extends unknown[]> = Depth["length"] extends 16
  ? true
  : T extends string | number | boolean | null
    ? false
    : T extends
          | undefined
          | bigint
          | symbol
          | Function
          | PromiseLike<unknown>
          | Date
          | Map<unknown, unknown>
          | ReadonlyMap<unknown, unknown>
          | Set<unknown>
          | ReadonlySet<unknown>
          | ArrayBuffer
          | ArrayBufferView
      ? true
      : T extends readonly (infer Item)[]
        ? InvalidDto<Item, [...Depth, 1]>
        : T extends object
          ? true extends {
              [K in keyof T]-?: K extends symbol
                ? true
                : InvalidDto<
                    {} extends Pick<T, K> ? Exclude<T[K], undefined> : T[K],
                    [...Depth, 1]
                  >;
            }[keyof T]
            ? true
            : false
          : true;
type InvalidDto<T, Depth extends unknown[] = []> =
  IsAny<T> extends true
    ? true
    : unknown extends T
      ? true
      : true extends InvalidMember<T, Depth>
        ? true
        : false;
type Run = (...args: any[]) => any;
type HandlerValid<H> = H extends { run: infer F extends Run }
  ? InvalidDto<Parameters<F>[0]> extends true
    ? false
    : InvalidDto<ReturnType<F>> extends true
      ? false
      : H extends { validate: infer V extends Run }
        ? InvalidDto<ReturnType<V>> extends true
          ? false
          : ReturnType<V> extends Parameters<F>[0]
            ? true
            : false
        : true
  : false;
export type CheckedHandlers<Group, Query extends boolean = false> = {
  [K in keyof Group]: HandlerValid<Group[K]> extends true
    ? Query extends true
      ? { readonly dependsOn: readonly string[] }
      : unknown
    : {
        readonly __error__: "Handlers require synchronous JSON DTO input/output; simplify types deeper than 16 levels";
      };
};
