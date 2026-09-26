/** 靜態值，或同步 getter。 */
export type MaybeGetter<T> = T | (() => T);

/** `T` 本身也可能是函式，`typeof` 分不出 getter。 */
export function resolveMaybeGetter<T>(value: MaybeGetter<T>): T {
  return typeof value === "function" ? (value as () => T)() : value;
}
