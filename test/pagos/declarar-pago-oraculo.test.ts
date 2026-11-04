import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONDICIONES_DE_PAGO, MEDIOS_DE_PAGO, decidirDeclaracionDePago, estadoDePago, etiquetaDeEstadoDePago } from "../../src/core/compras/pago-de-factura";
import { guardComandoAnularPagoDeFactura, guardComandoDeclararPagoDeFactura } from "../../src/core/features/compras/factura-proveedor.guard";
import {
  COLUMNAS_DEL_PAGO,
  CONDICIONES_ESPERADAS,
  DIAS_DE_PAGO,
  DIA_DE_LA_FACTURA,
  DIMENSIONES_DE_LA_REGLA,
  ENTRADAS_DE_LA_REGLA,
  FILAS,
  HOY,
  MEDIOS_ESPERADOS,
} from "./oraculo-declarar-pago";

/**
 * Pagos X0: el ORÁCULO de combinaciones de «declarar pago» (`oraculo-declarar-pago.ts`, escrito a mano y aparte) contra la regla pura, EXHAUSTIVO (40 combinaciones), más el GUARDIÁN de dimensiones: falla si aparece una
 * columna del pago, un dato de entrada de la regla, un medio o una condición sin declarar en el oráculo (ni siquiera de forma indirecta: se leen del esquema de Prisma, de la migración y del código fuente).
 *
 * Mutación (anotada en el commit): quitar la comparación `diaPago > hoy` de la regla → rojo las filas con fecha MANANA; invertir el orden anulada/contado → rojo las filas CONTADO+anulada; borrar un medio de la lista → rojo el guardián de medios.
 */
const leer = (ruta: string) => readFileSync(join(__dirname, "../..", ruta), "utf8");

describe("oráculo de declarar pago contra la regla pura (exhaustivo)", () => {
  it("la tabla cruza TODAS las dimensiones (40 filas, sin repetir ni faltar)", () => {
    const d = DIMENSIONES_DE_LA_REGLA;
    const esperadas = d.condicion.flatMap((c) => d.anulada.flatMap((a) => d.tienePagoVigente.flatMap((p) => d.fecha.map((f) => `${c}|${a}|${p}|${f}`))));
    const delOraculo = FILAS.map(([c, a, p, f]) => `${c}|${a}|${p}|${f}`);
    expect(new Set(delOraculo).size, "una combinación repetida").toBe(delOraculo.length);
    expect([...delOraculo].sort()).toEqual([...esperadas].sort());
    expect(delOraculo.length).toBe(40);
  });

  it.each(FILAS.map((f) => [f.join(" · "), f] as const))("%s", (_nombre, [condicionPago, anulada, tienePagoVigente, fecha, esperado]) => {
    const decision = decidirDeclaracionDePago({ condicionPago, anulada, tienePagoVigente, diaFactura: DIA_DE_LA_FACTURA, diaPago: DIAS_DE_PAGO[fecha], hoy: HOY });
    expect(decision.ok ? "OK" : decision.codigo).toBe(esperado);
  });

  it("una factura cargada HOY admite el pago de hoy (el día de la factura es el piso, inclusive)", () => {
    expect(decidirDeclaracionDePago({ condicionPago: "PENDIENTE_DE_PAGO", anulada: false, tienePagoVigente: false, diaFactura: HOY, diaPago: HOY, hoy: HOY })).toEqual({ ok: true });
  });

  it("el estado del dinero: contado = pagada al cargar; pendiente sin pago = pendiente; pendiente con pago vigente = pagada", () => {
    expect(estadoDePago("CONTADO_PAGADA", false)).toBe("PAGADA_AL_CARGAR");
    expect(estadoDePago("CONTADO_PAGADA", true)).toBe("PAGADA_AL_CARGAR");
    expect(estadoDePago("PENDIENTE_DE_PAGO", false)).toBe("PENDIENTE");
    expect(estadoDePago("PENDIENTE_DE_PAGO", true)).toBe("PAGADA");
    expect(etiquetaDeEstadoDePago("PENDIENTE")).toBe("Pendiente de pago");
    expect(etiquetaDeEstadoDePago("PAGADA", { dia: "2026-11-03", medio: "TRANSFERENCIA" })).toBe("Pagada el 2026-11-03 (Transferencia)");
  });
});

describe("guardián de dimensiones de Pagos X0: nada nuevo sin declarar", () => {
  it("las columnas de PagoDeFacturaProveedor del esquema de Prisma son EXACTAMENTE las declaradas en el oráculo", () => {
    const modelo = /model PagoDeFacturaProveedor \{([\s\S]*?)\n\}/.exec(leer("prisma/schema.prisma"))?.[1] ?? "";
    // Solo los campos escalares: una línea «nombre Tipo ...» cuyo tipo no es otro modelo (las relaciones empiezan con mayúscula y no son columnas: se reconocen por @relation o por ser lista/modelo).
    const columnas = modelo
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("///") && !l.startsWith("@@") && !l.startsWith("//"))
      .map((l) => l.split(/\s+/))
      .filter(([, tipo]) => tipo && /^(String|DateTime)\??$/.test(tipo))
      .map(([nombre]) => nombre!);
    expect(columnas.sort(), "una columna nueva del pago se declara en COLUMNAS_DEL_PAGO (¿cambia el resultado?)").toEqual(Object.keys(COLUMNAS_DEL_PAGO).sort());
    for (const [nombre, d] of Object.entries(COLUMNAS_DEL_PAGO)) expect(d.porque.length, `${nombre}: hay que decir por qué afecta o no`).toBeGreaterThan(10);
  });

  it("los datos de entrada de la regla pura son EXACTAMENTE los declarados (cada uno atado a una dimensión de la tabla)", () => {
    const interfaz = /export interface EntradaDeDeclaracionDePago \{([\s\S]*?)\n\}/.exec(leer("src/core/compras/pago-de-factura.ts"))?.[1] ?? "";
    const campos = [...interfaz.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]!);
    expect(campos.sort()).toEqual(Object.keys(ENTRADAS_DE_LA_REGLA).sort());
    for (const dimension of Object.values(ENTRADAS_DE_LA_REGLA)) expect(Object.keys(DIMENSIONES_DE_LA_REGLA)).toContain(dimension);
  });

  it("los medios de pago: oráculo, código y CHECK de la migración dicen lo mismo", () => {
    expect([...MEDIOS_DE_PAGO]).toEqual([...MEDIOS_ESPERADOS]);
    const check = /PagoDeFacturaProveedor_medio_chk" CHECK \("medio" IN \(([^)]*)\)\)/.exec(leer("prisma/migrations/20261104110000_pago_de_factura_proveedor/migration.sql"))?.[1] ?? "";
    expect([...check.matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual([...MEDIOS_ESPERADOS]);
  });

  it("las condiciones de pago: oráculo, código, dimensión y CHECK de la migración dicen lo mismo", () => {
    expect([...CONDICIONES_DE_PAGO]).toEqual([...CONDICIONES_ESPERADAS]);
    expect([...DIMENSIONES_DE_LA_REGLA.condicion]).toEqual([...CONDICIONES_ESPERADAS]);
    const check = /FacturaProveedor_condicion_pago_chk" CHECK \("condicionPago" IN \(([^)]*)\)\)/.exec(leer("prisma/migrations/20261104110000_pago_de_factura_proveedor/migration.sql"))?.[1] ?? "";
    expect([...check.matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual([...CONDICIONES_ESPERADAS]);
  });
});

describe("el comando de declarar pago: el guard (formato, corte de día argentino, medio, clave)", () => {
  const clave = "11111111-1111-4111-8111-111111111111";
  // 2026-11-05 02:59:59Z = 23:59:59 del 2026-11-04 en Argentina; 03:00:00Z ya es el 05.
  const ultimoSegundo = new Date("2026-11-05T02:59:59Z");
  const primerSegundo = new Date("2026-11-05T03:00:00Z");
  const comando = (extra: Record<string, unknown> = {}) => ({ facturaId: "f1", fechaPago: "2026-11-04", medio: "TRANSFERENCIA", claveIdempotencia: clave, ...extra });

  it("acepta el día de HOY argentino hasta el último segundo y rechaza el siguiente; a las 00:00 argentinas ya acepta el nuevo día", () => {
    expect(guardComandoDeclararPagoDeFactura(comando(), ultimoSegundo).ok).toBe(true);
    expect(guardComandoDeclararPagoDeFactura(comando({ fechaPago: "2026-11-05" }), ultimoSegundo).ok).toBe(false);
    expect(guardComandoDeclararPagoDeFactura(comando({ fechaPago: "2026-11-05" }), primerSegundo).ok).toBe(true);
  });

  it.each(MEDIOS_ESPERADOS)("acepta el medio %s", (medio) => {
    expect(guardComandoDeclararPagoDeFactura(comando({ medio }), primerSegundo).ok).toBe(true);
  });

  it.each([undefined, "", "BITCOIN", "transferencia", null, 3])("rechaza el medio %j", (medio) => {
    expect(guardComandoDeclararPagoDeFactura(comando({ medio }), primerSegundo).ok).toBe(false);
  });

  it.each([undefined, "", "2026-02-30", "04/11/2026", "2026-11-4", 20261104, null])("rechaza la fecha %j", (fechaPago) => {
    expect(guardComandoDeclararPagoDeFactura(comando({ fechaPago }), primerSegundo).ok).toBe(false);
  });

  it("exige la factura y la clave de reintento", () => {
    expect(guardComandoDeclararPagoDeFactura(comando({ facturaId: "" }), primerSegundo).ok).toBe(false);
    expect(guardComandoDeclararPagoDeFactura(comando({ claveIdempotencia: undefined }), primerSegundo).ok).toBe(false);
    expect(guardComandoDeclararPagoDeFactura(comando({ claveIdempotencia: "no-es-uuid" }), primerSegundo).ok).toBe(false);
  });

  it("anular: exige pago, motivo (1 a 200, con algo visible) y clave", () => {
    const anular = (extra: Record<string, unknown> = {}) => ({ pagoId: "p1", motivo: "Me equivoqué de fecha", claveIdempotencia: clave, ...extra });
    expect(guardComandoAnularPagoDeFactura(anular()).ok).toBe(true);
    expect(guardComandoAnularPagoDeFactura(anular({ pagoId: "" })).ok).toBe(false);
    expect(guardComandoAnularPagoDeFactura(anular({ motivo: "   " })).ok).toBe(false);
    expect(guardComandoAnularPagoDeFactura(anular({ motivo: "x".repeat(201) })).ok).toBe(false);
    expect(guardComandoAnularPagoDeFactura(anular({ claveIdempotencia: "" })).ok).toBe(false);
  });
});
