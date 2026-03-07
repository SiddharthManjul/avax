/**
 * Minimal type declarations for bun:test.
 * bun:test is a virtual module available at runtime when running `bun test`.
 * This shim silences the IDE "Cannot find module" error.
 */
declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export function expect<T>(value: T): {
    toBeInstanceOf(Uint8Array: Uint8ArrayConstructor): unknown;
    rejects: any;
    toBeDefined(): unknown;
    toBeGreaterThan(arg0: bigint): unknown;
    toBeLessThan(SUBGROUP_ORDER: bigint): unknown;
    toBe(expected: T): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    not: {
      toBe(expected: T): void;
      toBeNull(): void;
    };
    toHaveLength(length: number): void;
  };
}
