import { describe, expect, it } from "vitest";
import {
  assertSafeTestEnv,
  isDefaultDevPostgres,
  OVERRIDE_VAR,
  UnsafeTestDatabaseError,
} from "./db-guard.js";

const SAFE = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55432/tallyline_test",
};

describe("test database guard", () => {
  it("accepts an explicit throwaway stack", () => {
    expect(() => assertSafeTestEnv(SAFE)).not.toThrow();
  });

  it("accepts the CI service (default port, non-default db name)", () => {
    expect(() =>
      assertSafeTestEnv({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/tallyline_test",
      }),
    ).not.toThrow();
  });

  it("refuses when DATABASE_URL is unset", () => {
    expect(() => assertSafeTestEnv({})).toThrow(UnsafeTestDatabaseError);
  });

  it.each([
    "postgresql://postgres:postgres@localhost:5432/tallyline",
    "postgresql://postgres:postgres@127.0.0.1:5432/tallyline",
    "postgresql://postgres:postgres@localhost/tallyline", // implicit 5432
    "postgresql://postgres:postgres@[::1]:5432/tallyline",
    "postgresql://postgres:postgres@0.0.0.0:5432/tallyline?sslmode=disable",
  ])("refuses the default dev database %s", (url) => {
    expect(isDefaultDevPostgres(url)).toBe(true);
    expect(() => assertSafeTestEnv({ ...SAFE, DATABASE_URL: url })).toThrow(
      /default dev database/,
    );
  });

  it.each([
    "postgresql://postgres:postgres@localhost:5433/tallyline",
    "postgresql://postgres:postgres@localhost:5432/other",
    "postgresql://postgres:postgres@db.internal:5432/tallyline",
  ])("does not flag %s as the default dev database", (url) => {
    expect(isDefaultDevPostgres(url)).toBe(false);
  });

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
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/tallyline",
      }),
    ).not.toThrow();
  });

  it("any other override value does not count", () => {
    expect(() => assertSafeTestEnv({ [OVERRIDE_VAR]: "true" })).toThrow(
      UnsafeTestDatabaseError,
    );
  });
});
