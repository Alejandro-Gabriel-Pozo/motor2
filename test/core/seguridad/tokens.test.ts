import { describe, expect, it } from "vitest";
import { generarTokenOpaco, hashDeToken } from "../../../src/core/seguridad/tokens";

describe("token opaco", () => {
  it("son 32 bytes en base64url, distintos cada vez, y el hash es un SHA-256 estable", () => {
    const t = generarTokenOpaco();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generarTokenOpaco()).not.toBe(t);
    expect(hashDeToken(t)).toBe(hashDeToken(t));
    expect(hashDeToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
