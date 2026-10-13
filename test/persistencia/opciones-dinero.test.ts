import { Prisma } from "@prisma/client";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { componerPrecioDeLinea, type DetalleDeOpcion, type OpcionParaPrecio } from "../../src/core/opciones/componer-precio-de-linea";
import { redondearMoneda } from "../../src/core/moneda";
import type { DiferenciaDePrecio } from "../../src/core/opciones/tipos";
import { EMPRESA_DE_PRUEBA_ID } from "../setup/empresa-de-prueba";
import { cerrarConexiones, conexionDelDuenio, intentar } from "../setup/gasto";
import { HUELLA_DE_PRUEBA, sembrarEscenarioDeOpciones, sentenciaDeFoto, sentenciaDeLinea, type EscenarioDeOpciones } from "../setup/opciones";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * GO-1 (invariante I4): el DINERO de la foto de una opción es exacto. Lo que `componerPrecioDeLinea` (el núcleo, con `core/moneda`) congela —importe unitario de 2 decimales, modo, tipo de diferencia y porcentaje de 4 decimales— se
 * escribe en `OpcionElegidaEnLinea` y vuelve IDÉNTICO de la base como `Prisma.Decimal`; y la suma de las partes, hecha en SQL con NUMERIC, es exactamente el precio de lista de la línea. Se escribe de verdad y las sumas se leen EN SQL, no en JavaScript.
 *
 * Propiedades (fast-check contra la base): (1) cada importe y cada porcentaje que sale del núcleo vuelve igual de la base; (2) Σ (importe × cantidad) de las partes dentro del precio, más el precio base si la medida no es absoluta, es EXACTAMENTE el precio de lista, y el
 * importe del adicional es k × la cantidad del producto × su recargo; (3) lo que la base redondea al guardar es lo mismo que redondea el núcleo (mitad lejos del cero, igual que `round(v::numeric, 2)`), pero la base redondea SIN avisar: `numeric(14,2)` guarda 0,005 como 0,01 en
 * vez de rechazarlo, así que la base NO reemplaza al único redondeo válido, el de `core/moneda`, que se hace antes de escribir (por eso las pruebas escriben el valor ya redondeado).
 */
afterAll(() => prismaAdmin.$disconnect());

let e: EscenarioDeOpciones;
beforeAll(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeOpciones();
}, 60_000);
afterAll(cerrarConexiones);

const PROPIA = { empresaId: EMPRESA_DE_PRUEBA_ID };
const centavos = fc.integer({ min: 1, max: 99_999_999 });
const aMonto = (c: number) => c / 100;

/** Una diferencia al azar: monto (positivo, negativo o cero) o porcentaje de 4 decimales en (-100, 999,9999]. */
const diferencia: fc.Arbitrary<DiferenciaDePrecio> = fc.oneof(
  fc.integer({ min: -500_000, max: 500_000 }).map((c): DiferenciaDePrecio => ({ tipo: "MONTO", monto: aMonto(c) })),
  fc.integer({ min: -999_999, max: 9_999_999 }).map((p): DiferenciaDePrecio => ({ tipo: "PORCENTAJE", porcentaje: p / 10_000 })),
);

interface Armado {
  precioBase: number;
  cantidad: number;
  medida: { opcionId: string; precioAbsoluto: number } | { opcionId: string; diferencia: DiferenciaDePrecio };
  variantes: Array<{ opcionId: string; diferencia: DiferenciaDePrecio | null }>;
  incluida: boolean;
  adicional: { k: number; recargo: number } | null;
}

const armado: fc.Arbitrary<Armado> = fc.record({
  precioBase: centavos.map(aMonto),
  cantidad: fc.integer({ min: 1, max: 5 }),
  medida: fc.oneof(
    fc.record({ opcionId: fc.constantFrom("chico", "mediano", "grande"), precioAbsoluto: centavos.map(aMonto) }),
    fc.record({ opcionId: fc.constantFrom("chico", "mediano", "grande"), diferencia }),
  ),
  variantes: fc.uniqueArray(fc.record({ opcionId: fc.constantFrom("vaca", "almendras"), diferencia: fc.option(diferencia, { nil: null }) }), { selector: (v) => v.opcionId, maxLength: 2 }),
  incluida: fc.boolean(),
  adicional: fc.option(fc.record({ k: fc.integer({ min: 1, max: 3 }), recargo: centavos.map(aMonto) }), { nil: null }),
});

/** Las opciones del núcleo a partir del armado, con los ids REALES de la base. */
function opcionesDe(a: Armado): OpcionParaPrecio[] {
  const id = (clave: string) => ({ chico: e.chicoId, mediano: e.medianoId, grande: e.grandeId, vaca: e.vacaId, almendras: e.almendrasId })[clave]!;
  const base = { cantidad: 1, factorEscala: null, modoPrecio: null, precioAbsoluto: null, diferencia: null } as const;
  const opciones: OpcionParaPrecio[] = [
    "precioAbsoluto" in a.medida
      ? { ...base, opcionId: id(a.medida.opcionId), versionDeOpcionId: e.versionDe[id(a.medida.opcionId)]!, nombre: "Tamaño", tipo: "MEDIDA", factorEscala: 1, modoPrecio: "ABSOLUTO", precioAbsoluto: a.medida.precioAbsoluto }
      : { ...base, opcionId: id(a.medida.opcionId), versionDeOpcionId: e.versionDe[id(a.medida.opcionId)]!, nombre: "Tamaño", tipo: "MEDIDA", factorEscala: 1, modoPrecio: "DIFERENCIA", diferencia: a.medida.diferencia },
    ...a.variantes.map((v): OpcionParaPrecio => ({ ...base, opcionId: id(v.opcionId), versionDeOpcionId: e.versionDe[id(v.opcionId)]!, nombre: "Leche", tipo: "VARIANTE", diferencia: v.diferencia })),
  ];
  if (a.incluida) opciones.push({ ...base, opcionId: e.azucarId, versionDeOpcionId: e.versionDe[e.azucarId]!, nombre: "Azúcar", tipo: "INCLUIDA" });
  if (a.adicional) opciones.push({ ...base, opcionId: e.shotId, versionDeOpcionId: e.versionDe[e.shotId]!, nombre: "Shot extra", tipo: "ADICIONAL", cantidad: a.adicional.k, diferencia: { tipo: "MONTO", monto: a.adicional.recargo } });
  return opciones;
}

/** Lo que el núcleo congeló de UNA opción, en las columnas de la foto (importes y porcentaje como texto de la escala exacta). */
function datosDeFoto(d: DetalleDeOpcion, nombres: { grupoId: string; nombreGrupo: string; nombreOpcion: string }): Record<string, unknown> {
  return {
    ...PROPIA,
    grupoId: nombres.grupoId,
    opcionId: d.opcionId,
    versionDeOpcionId: d.versionDeOpcionId,
    tipoGrupo: d.tipo,
    nombreGrupo: nombres.nombreGrupo,
    nombreOpcion: nombres.nombreOpcion,
    cantidad: d.cantidad,
    modoPrecio: d.modoPrecio,
    tipoDeDiferencia: d.tipoDeDiferencia,
    porcentaje: d.porcentaje === null ? null : d.porcentaje.toFixed(4),
    importeUnitario: d.importeUnitario.toFixed(2),
    precioDeSucursal: d.precioDeSucursal,
    factorEscala: d.factorEscala === null ? null : d.factorEscala.toFixed(4),
  };
}

describe("lo que el núcleo congela vuelve idéntico de la base, y las partes suman exacto el precio de lista (propiedades contra la base)", () => {
  it("para cualquier precio base, cantidad, medida, variantes, incluida y adicional: cada foto vuelve igual como Prisma.Decimal, y la suma en SQL es el precio de lista", async () => {
    const duenio = await conexionDelDuenio();
    const grupoDe = new Map<string, { grupoId: string; nombreGrupo: string }>([
      ["MEDIDA", { grupoId: e.grupoMedidaId, nombreGrupo: "Tamaño" }],
      ["VARIANTE", { grupoId: e.grupoVarianteId, nombreGrupo: "Leche" }],
      ["INCLUIDA", { grupoId: e.grupoIncluidaId, nombreGrupo: "Viene con" }],
      ["ADICIONAL", { grupoId: e.grupoAdicionalId, nombreGrupo: "Extras" }],
    ]);
    const nombreDe = new Map([[e.chicoId, "Chico"], [e.medianoId, "Mediano"], [e.grandeId, "Grande"], [e.vacaId, "De vaca"], [e.almendrasId, "Almendras"], [e.azucarId, "Azúcar"], [e.shotId, "Shot extra"]]);
    let corridas = 0;
    await fc.assert(
      fc.asyncProperty(armado, async (a) => {
        const r = componerPrecioDeLinea({ precioBase: a.precioBase, cantidad: a.cantidad, opciones: opcionesDe(a) });
        fc.pre(r.ok); // un precio de lista menor que 0,01 es una configuración inválida que el núcleo rechaza (y la base nunca ve)
        if (!r.ok) return;
        corridas++;
        const { precio } = r;
        // La línea padre y los fotos de lo que va dentro del precio.
        const padre = sentenciaDeLinea({ cuentaId: e.cuentaAId, productoId: e.cafeId }, { ...PROPIA, huellaOpciones: HUELLA_DE_PRUEBA, cantidad: a.cantidad, precioUnitario: precio.precioDeLista.toFixed(2) });
        expect(await intentar(duenio, padre.texto, padre.params)).toBeNull();
        const fotosDelPadre: string[] = [];
        for (const d of precio.dentroDelPrecio) {
          const g = grupoDe.get(d.tipo)!;
          const f = sentenciaDeFoto({ ...e, cuentaItemId: padre.id }, datosDeFoto(d, { ...g, nombreOpcion: nombreDe.get(d.opcionId)! }));
          expect(await intentar(duenio, f.texto, f.params), `${d.tipo} ${JSON.stringify(d)}`).toBeNull();
          fotosDelPadre.push(f.id);
        }
        // Cada adicional es su propia línea (hija) con su foto.
        const fotosDeAdicionales: string[] = [];
        for (const ad of precio.adicionales) {
          const hija = sentenciaDeLinea({ cuentaId: e.cuentaAId, productoId: e.anclaDelShotId }, { ...PROPIA, lineaPadreId: padre.id, cantidad: ad.cantidad, precioUnitario: ad.recargoUnitario.toFixed(2) });
          expect(await intentar(duenio, hija.texto, hija.params)).toBeNull();
          const f = sentenciaDeFoto({ ...e, cuentaItemId: hija.id }, datosDeFoto(ad.detalle, { ...grupoDe.get("ADICIONAL")!, nombreOpcion: "Shot extra" }));
          expect(await intentar(duenio, f.texto, f.params)).toBeNull();
          fotosDeAdicionales.push(f.id);
          // El importe del adicional: k × cantidad del producto × recargo, EXACTO en SQL.
          const [suma] = await prismaAdmin.$queryRaw<Array<{ importe: string }>>`SELECT ("cantidad" * "precioUnitario")::text AS importe FROM "CuentaItem" WHERE "id" = ${hija.id}`;
          expect(new Prisma.Decimal(suma!.importe).equals(new Prisma.Decimal(ad.importe.toFixed(2)))).toBe(true);
        }
        // (1) Cada foto vuelve IDÉNTICA como Prisma.Decimal.
        for (const d of [...precio.dentroDelPrecio, ...precio.adicionales.map((x) => x.detalle)]) {
          const filas = await prismaAdmin.opcionElegidaEnLinea.findMany({ where: { opcionId: d.opcionId, id: { in: [...fotosDelPadre, ...fotosDeAdicionales] } } });
          expect(filas).toHaveLength(1);
          const f = filas[0]!;
          expect(f.importeUnitario).toBeInstanceOf(Prisma.Decimal);
          expect(f.importeUnitario.equals(new Prisma.Decimal(d.importeUnitario.toFixed(2))), `importe de ${d.tipo}: ${f.importeUnitario.toFixed(2)} vs ${d.importeUnitario}`).toBe(true);
          expect(f.importeUnitario.toFixed(2)).toBe(d.importeUnitario.toFixed(2));
          if (d.porcentaje === null) expect(f.porcentaje).toBeNull();
          else expect(f.porcentaje!.toFixed(4)).toBe(d.porcentaje.toFixed(4));
          expect([f.tipoGrupo, f.modoPrecio, f.tipoDeDiferencia, f.cantidad, f.precioDeSucursal]).toEqual([d.tipo, d.modoPrecio, d.tipoDeDiferencia, d.cantidad, d.precioDeSucursal]);
        }
        // (2) La suma en SQL de las partes dentro del precio (más el base si la medida no es absoluta) es EXACTAMENTE el precio de lista.
        const medidaAbsoluta = precio.dentroDelPrecio.some((d) => d.modoPrecio === "ABSOLUTO");
        const [s] = await prismaAdmin.$queryRaw<Array<{ partes: string | null }>>`SELECT sum("importeUnitario" * "cantidad")::text AS partes FROM "OpcionElegidaEnLinea" WHERE "cuentaItemId" = ${padre.id}`;
        const total = new Prisma.Decimal(s!.partes ?? "0").plus(medidaAbsoluta ? 0 : new Prisma.Decimal(a.precioBase.toFixed(2)));
        expect(total.toFixed(2), "la suma exacta de las partes es el precio de lista").toBe(precio.precioDeLista.toFixed(2));
        expect(total.equals(new Prisma.Decimal(precio.precioDeLista.toFixed(2)))).toBe(true);
        // Y el importe de la línea del padre en SQL es cantidad × precio de lista, sin diferencia de un centavo.
        const [l] = await prismaAdmin.$queryRaw<Array<{ importe: string }>>`SELECT ("cantidad" * "precioUnitario")::text AS importe FROM "CuentaItem" WHERE "id" = ${padre.id}`;
        expect(new Prisma.Decimal(l!.importe).toFixed(2)).toBe(precio.importeDelProducto.toFixed(2));
      }),
      { numRuns: 40 },
    );
    expect(corridas, "sanidad: la propiedad ejercitó casos reales").toBeGreaterThan(5);
  }, 240_000);
});

describe("la base redondea igual que el núcleo, pero sin avisar (R-g): el único redondeo válido es el de `core/moneda`", () => {
  it("para importes con 3 decimales, `numeric(14,2)` guarda lo mismo que `redondearMoneda` (mitad lejos del cero), también con negativos", async () => {
    const duenio = await conexionDelDuenio();
    let n = 0;
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: -9_999_999, max: 9_999_999 }), async (milesimos) => {
        const texto = (milesimos / 1000).toFixed(3);
        const r = await duenio.query<{ guardado: string }>(`SELECT ($1::numeric)::numeric(14,2)::text AS guardado`, [texto]);
        const enNucleo = redondearMoneda(Number(texto));
        expect(r.rows[0]!.guardado, `redondeo de ${texto}`).toBe(enNucleo.toFixed(2));
        n++;
      }),
      { numRuns: 200 },
    );
    expect(n).toBe(200);
  });

  it("la base NO rechaza un precio con medio centavo: 0,005 queda guardado como 0,01 (y 0,004 como 0,00, que el CHECK sí frena); el valor se redondea ANTES de escribir", async () => {
    const duenio = await conexionDelDuenio();
    const precio = (valor: string) =>
      intentar(duenio, `INSERT INTO "PrecioLocalDeOpcion" ("id", "empresaId", "sucursalId", "productoId", "opcionId", "precio") VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::numeric)`, [EMPRESA_DE_PRUEBA_ID, e.sucursalA, e.cafeId, e.chicoId, valor]);
    expect(await precio("0.005")).toBeNull();
    const guardado = await prismaAdmin.precioLocalDeOpcion.findFirstOrThrow({ where: { sucursalId: e.sucursalA, opcionId: e.chicoId } });
    expect(guardado.precio.toFixed(2), "0,005 se guardó como 0,01 sin ningún aviso").toBe("0.01");
    await prismaAdmin.precioLocalDeOpcion.deleteMany();
    expect(await precio("0.004")).toMatchObject({ codigo: "23514", restriccion: "PrecioLocalDeOpcion_precio_chk" });
    expect(redondearMoneda(0.005), "el núcleo hace el mismo redondeo, antes de escribir").toBe(0.01);
    expect(redondearMoneda(0.004)).toBe(0);
  });
});
