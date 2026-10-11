import { describe, expect, it } from "vitest";
import {
  assertSafeTestEnv,
  isDefaultDevPostgres,
  isDefaultDevRedis,
  OVERRIDE_VAR,
  UnsafeTestDatabaseError,
} from "./db-guard.js";

const SAFE = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55432/tallyline_test",
  REDIS_URL: "redis://127.0.0.1:56380",
};

describe("test database guard", () => {
  it("accepts an explicit throwaway stack", () => {
    expect(() => assertSafeTestEnv(SAFE)).not.toThrow();
  });

  it("accepts the CI service (default port, non-default db name)", () => {
    expect(() =>
      assertSafeTestEnv({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/tallyline_test",
        REDIS_URL: "redis://localhost:6379",
      }),
    ).not.toThrow();
  });

  it("refuses when DATABASE_URL is unset", () => {
    expect(() => assertSafeTestEnv({ REDIS_URL: SAFE.REDIS_URL })).toThrow(
      UnsafeTestDatabaseError,
    );
  });

  it("refuses when REDIS_URL is unset", () => {
    expect(() => assertSafeTestEnv({ DATABASE_URL: SAFE.DATABASE_URL })).toThrow(
      /REDIS_URL is not set/,
    );
  });

  it.each([
    "postgresql://postgres:postgres@localhost:5432/docketry",
    "postgresql://postgres:postgres@127.0.0.1:5432/docketry",
    "postgresql://postgres:postgres@localhost/docketry", // implicit 5432
    "postgresql://postgres:postgres@[::1]:5432/docketry",
    "postgresql://postgres:postgres@0.0.0.0:5432/docketry?sslmode=disable",
  ])("refuses the default dev database %s", (url) => {
    expect(isDefaultDevPostgres(url)).toBe(true);
    expect(() => assertSafeTestEnv({ ...SAFE, DATABASE_URL: url })).toThrow(
      /default dev database/,
    );
  });

  it.each([
    "postgresql://postgres:postgres@localhost:5433/docketry",
    "postgresql://postgres:postgres@localhost:5432/other",
    "postgresql://postgres:postgres@db.internal:5432/docketry",
  ])("does not flag %s as the default dev database", (url) => {
    expect(isDefaultDevPostgres(url)).toBe(false);
  });

  it.each(["redis://localhost:6380", "redis://127.0.0.1:6380/2"])(
    "refuses the default dev redis %s",
    (url) => {
      expect(isDefaultDevRedis(url)).toBe(true);
      expect(() => assertSafeTestEnv({ ...SAFE, REDIS_URL: url })).toThrow(
        /default dev Redis/,
      );
    },
  );

  it("rejects an unparseable DATABASE_URL", () => {
    expect(() => assertSafeTestEnv({ ...SAFE, DATABASE_URL: "not a url" })).toThrow(
      UnsafeTestDatabaseError,
    );
  });

  it(`${OVERRIDE_VAR}=1 allows the default stack`, () => {
    expect(() => assertSafeTestEnv({ [OVERRIDE_VAR]: "1" })).not.toThrow();
    expect(() =>
      assertSafeTestEnv({
        [OVERRIDE_VAR]: "1",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/docketry",
        REDIS_URL: "redis://localhost:6380",
      }),
    ).not.toThrow();
  });

  it("any other override value does not count", () => {
    expect(() => assertSafeTestEnv({ [OVERRIDE_VAR]: "true" })).toThrow(
      UnsafeTestDatabaseError,
    );
  });
});
