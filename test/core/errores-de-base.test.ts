import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { causaDeErrorDeDriver, errorConocidoDeBase, esErrorDeBaseConCodigo, esFalloDeSerializacionEnSqlCrudo } from "../../src/core/datos/errores-de-base";
import { esChoqueDeIndiceUnico, esConflictoDeEscritura } from "../../src/core/movimientos/con-reintento";
import { esChoqueDeFacturaUnica } from "../../src/core/movimientos/factura-unica";
import { esErrorDeUnicidad } from "../../src/core/catalogo/generar-codigo";

/**
 * Pureza 1.6: el dominio reconoce los errores de la base POR FORMA (`name`, `code`, `meta`, `cause.kind`), sin importar las clases del ORM. Estos tests fijan esa forma
 * contra instancias REALES de Prisma (si una actualización la cambia, fallan acá) y contra los casos que NO deben confundirse.
 */
const real = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("falló", { code, clientVersion: "test", ...(meta ? { meta } : {}) });
const deDriver = (kind: string, extra: Record<string, unknown> = {}) => Object.assign(new Error("driver"), { name: "DriverAdapterError", cause: { kind, ...extra } });

describe("errorConocidoDeBase: la forma de un error real de Prisma", () => {
  it("reconoce una instancia real, con su código y su meta", () => {
    expect(errorConocidoDeBase(real("P2002", { target: ["a"] }))).toEqual({ code: "P2002", meta: { target: ["a"] } });
    expect(errorConocidoDeBase(real("P2034"))).toEqual({ code: "P2034" });
  });

  it("no confunde otros errores ni valores", () => {
    expect(errorConocidoDeBase(new Error("P2002"))).toBeNull();
    expect(errorConocidoDeBase({ name: "PrismaClientKnownRequestError", code: "P2002" })).toBeNull(); // no es un Error
    expect(errorConocidoDeBase(Object.assign(new Error("x"), { code: "P2002" }))).toBeNull(); // trae código, pero no es de Prisma
    expect(errorConocidoDeBase(Object.assign(new Error("x"), { name: "PrismaClientKnownRequestError", code: 2002 }))).toBeNull(); // código no textual
    expect(errorConocidoDeBase(null)).toBeNull();
    expect(errorConocidoDeBase("P2002")).toBeNull();
  });

  it("esErrorDeBaseConCodigo compara el código exacto", () => {
    expect(esErrorDeBaseConCodigo(real("P2002"), "P2002")).toBe(true);
    expect(esErrorDeBaseConCodigo(real("P2025"), "P2002")).toBe(false);
  });
});

describe("causaDeErrorDeDriver", () => {
  it("lee el kind (y la restricción) de un DriverAdapterError, y nada más", () => {
    expect(causaDeErrorDeDriver(deDriver("UniqueConstraintViolation", { constraint: { index: "x" } }))).toEqual({ kind: "UniqueConstraintViolation", constraint: { index: "x" } });
    expect(causaDeErrorDeDriver(deDriver("TransactionWriteConflict"))).toEqual({ kind: "TransactionWriteConflict" });
    expect(causaDeErrorDeDriver(new Error("otro"))).toBeNull();
    expect(causaDeErrorDeDriver(Object.assign(new Error("x"), { name: "DriverAdapterError" }))).toBeNull(); // sin cause
  });
});

describe("los reconocedores del dominio siguen igual (con instancias reales)", () => {
  it("conflicto de escritura: P2034 de Prisma o TransactionWriteConflict del driver; nunca otro error", () => {
    expect(esConflictoDeEscritura(real("P2034"))).toBe(true);
    expect(esConflictoDeEscritura(deDriver("TransactionWriteConflict"))).toBe(true);
    expect(esConflictoDeEscritura(deDriver("ConnectionClosed"))).toBe(false);
    expect(esConflictoDeEscritura(real("P2002"))).toBe(false);
  });

  it("choque de índice único: P2002 o UniqueConstraintViolation; y esErrorDeUnicidad solo P2002", () => {
    expect(esChoqueDeIndiceUnico(real("P2002"))).toBe(true);
    expect(esChoqueDeIndiceUnico(deDriver("UniqueConstraintViolation"))).toBe(true);
    expect(esChoqueDeIndiceUnico(real("P2034"))).toBe(false);
    expect(esErrorDeUnicidad(real("P2002"))).toBe(true);
    expect(esErrorDeUnicidad(real("P2025"))).toBe(false);
  });

  it("factura duplicada: SOLO el índice de factura única, por target, por el driver anidado o por el driver crudo; nunca otro índice", () => {
    expect(esChoqueDeFacturaUnica(real("P2002", { target: ["Operacion_factura_unica_vigente_key"] }))).toBe(true);
    expect(esChoqueDeFacturaUnica(real("P2002", { target: "Operacion_factura_unica_key" }))).toBe(true);
    expect(esChoqueDeFacturaUnica(real("P2002", { driverAdapterError: deDriver("UniqueConstraintViolation", { constraint: { index: "Operacion_factura_unica_vigente_key" } }) }))).toBe(true);
    expect(esChoqueDeFacturaUnica(deDriver("UniqueConstraintViolation", { constraint: { index: "Operacion_factura_unica_vigente_key" } }))).toBe(true);
    expect(esChoqueDeFacturaUnica(real("P2002", { target: ["Operacion_claveIdempotencia_key"] }))).toBe(false);
    expect(esChoqueDeFacturaUnica(real("P2002"))).toBe(false); // sin nombre reconocible: no se disfraza de factura duplicada
  });
});

describe("esFalloDeSerializacionEnSqlCrudo: un 40001/40P01 de un $executeRaw llega como P2010 y es un conflicto reintentable", () => {
  const p2010 = (originalCode: string) => real("P2010", { driverAdapterError: { name: "DriverAdapterError", cause: { originalCode, originalMessage: "no se pudo serializar el acceso" } } });

  it("40001 (serialización) y 40P01 (deadlock) dentro de un P2010 son un conflicto de escritura", () => {
    expect(esFalloDeSerializacionEnSqlCrudo(p2010("40001"))).toBe(true);
    expect(esFalloDeSerializacionEnSqlCrudo(p2010("40P01"))).toBe(true);
    expect(esConflictoDeEscritura(p2010("40001"))).toBe(true);
  });

  it("cualquier OTRO P2010 (sintaxis, columna inexistente, violación) NO se reintenta", () => {
    expect(esFalloDeSerializacionEnSqlCrudo(p2010("42601"))).toBe(false);
    expect(esFalloDeSerializacionEnSqlCrudo(p2010("23505"))).toBe(false);
    expect(esConflictoDeEscritura(p2010("42703"))).toBe(false);
    expect(esFalloDeSerializacionEnSqlCrudo(real("P2010"))).toBe(false); // sin el código original
  });

  it("un 40001 dentro de OTRO código de Prisma, o un Error común con esa forma, no cuenta", () => {
    expect(esFalloDeSerializacionEnSqlCrudo(real("P2002", { driverAdapterError: { cause: { originalCode: "40001" } } }))).toBe(false);
    expect(esFalloDeSerializacionEnSqlCrudo(Object.assign(new Error("x"), { code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "40001" } } } }))).toBe(false);
    expect(esFalloDeSerializacionEnSqlCrudo(null)).toBe(false);
  });
});
