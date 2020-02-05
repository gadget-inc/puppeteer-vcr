export function assert<T>(value: T | undefined | null): T {
  if (!value) {
    throw new Error("assertion error");
  }
  return value;
}
