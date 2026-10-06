import { describe, expect, it } from "vitest";
import { autorizacionCronValida } from "@/core/auth/secreto-cron";

describe("autorizacionCronValida", () => {
  it("acepta exactamente `Bearer <secreto>`", () => {
    expect(autorizacionCronValida("Bearer s3creto", "s3creto")).toBe(true);
  });

  it("rechaza un secreto distinto, un prefijo, una variante de esquema o mayúsculas", () => {
    for (const h of ["Bearer s3crett", "Bearer s3cret", "Bearer s3creto ", "bearer s3creto", "s3creto", "Basic s3creto", "Bearer  s3creto", ""]) {
      expect(autorizacionCronValida(h, "s3creto"), h).toBe(false);
    }
  });

  it("sin encabezado, o sin secreto configurado (o vacío), nunca autoriza — ni siquiera `Bearer ` a secas", () => {
    expect(autorizacionCronValida(null, "s3creto")).toBe(false);
    expect(autorizacionCronValida(undefined, "s3creto")).toBe(false);
    expect(autorizacionCronValida("Bearer undefined", undefined)).toBe(false);
    expect(autorizacionCronValida("Bearer ", "")).toBe(false);
    expect(autorizacionCronValida("Bearer null", null)).toBe(false);
  });

  it("no lanza con encabezados de largo distinto (timingSafeEqual exige buffers iguales: se comparan los hashes)", () => {
    expect(() => autorizacionCronValida("Bearer " + "x".repeat(10_000), "corto")).not.toThrow();
    expect(autorizacionCronValida("Bearer " + "x".repeat(10_000), "corto")).toBe(false);
  });
});
