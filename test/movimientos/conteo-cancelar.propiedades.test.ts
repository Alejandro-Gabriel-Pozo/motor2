import { beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { baseDeTest, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { registrarConteoFisicoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-conteo-fisico";
import { resolverConteoPendienteCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/resolver-conteo-pendiente";
import { cancelarConteoFisicoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/cancelar-conteo-fisico";
import { calcularSaldoTotal } from "../setup/saldo-de-seccion";

/**
 * GT-6 completo (S-04, O.53 de docs/pureza-integracion.md; plan de endurecimiento de seguridad, tanda T5): «toda reversión mira lo que de verdad se aplicó». La parte de la compra (S-02)
 * está en `test/core/anulacion-compra-saldo-total.propiedades.test.ts`; esta es la del CONTEO: para CUALQUIER secuencia de movimientos externos, conteos (AJUSTAR, «Falta movimiento»,
 * «Descartar»), cierres de pendientes («resuelto» y «ajustar», este último contra el saldo de HOY) y cancelaciones,
 *  - cancelar un conteo RESUELTO deja el saldo exactamente `lo que tenía - lo que ese conteo aplicó` (un modelo independiente lleva la cuenta de lo aplicado: no mira `ConteoFisico.diferencia`);
 *  - al terminar, las líneas del Kardex de cada conteo suman lo que aplicó, y 0 si fue cancelado (el original y su reversión se anulan);
 *  - el saldo real de la base coincide con el del modelo;
 *  - (M-2, D7) cancelar un conteo con OTRO conteo no cancelado posterior (escrito después, o con una línea de Kardex escrita después) se RECHAZA con `CONTEO_POSTERIOR` sin tocar nada.
 * Con Postgres real cada corrida escribe hasta ~10 operaciones: `NUM_RUNS` bajo (el archivo entero tarda unos segundos) para no inflar `npm test`. Si algo falla, fast-check reporta
 * `seed`/`path` para reproducirlo. Mutación: volver a revertir `conteo.diferencia` en `cancelarConteoFisicoCasoDeUso` → la propiedad cae (un pendiente cerrado como «resuelto» y después
 * cancelado escribe un ajuste que nunca se aplicó).
 */
type AccionDelConteo = "AJUSTAR" | "FALTA_MOVIMIENTO" | "DESCARTAR";
type Paso =
  | { t: "mover"; delta: number }
  | { t: "contar"; real: number; accion: AccionDelConteo }
  | { t: "resolver"; elegir: number; como: "resuelto" | "ajustar" }
  | { t: "cancelar"; elegir: number };

const arbPaso: fc.Arbitrary<Paso> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ t: fc.constant("mover" as const), delta: fc.integer({ min: -9, max: 12 }).filter((n) => n !== 0) }) },
  {
    weight: 4,
    arbitrary: fc.record({ t: fc.constant("contar" as const), real: fc.integer({ min: 0, max: 25 }), accion: fc.constantFrom<AccionDelConteo>("AJUSTAR", "FALTA_MOVIMIENTO", "DESCARTAR") }),
  },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("resolver" as const), elegir: fc.nat(5), como: fc.constantFrom("resuelto" as const, "ajustar" as const) }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant("cancelar" as const), elegir: fc.nat(5) }) }
);

interface ConteoDelModelo {
  id: string;
  real: number;
  estado: "PENDIENTE" | "RESUELTO" | "DESCARTADO" | "CANCELADO";
  /** Lo que aplicó al stock según el MODELO (no `ConteoFisico.diferencia`). */
  aplicado: number;
  /** Cómo llegó a RESUELTO: en el momento del conteo, o cerrando un pendiente (los dos caminos donde `diferencia` miente). */
  via: "directo" | "pendiente";
  /** El orden en que se escribió la fila del conteo (el reloj de la base, `creadoEn`, en el modelo). */
  creado: number;
  /** El orden en que se escribió la línea del Kardex que aplicó (`null` si no escribió ninguna): al contar, el mismo que `creado`; al cerrar un pendiente con «ajustar», el del cierre. */
  movimientoEn: number | null;
}

const NUM_RUNS = 300;

describe("propiedad (GT-6): cancelar un conteo revierte exactamente la suma de lo que ese conteo aplicó", () => {
  let sucursalId: string;
  let seccionId: string;
  let adminId: string;
  let unidadKgId: string;
  let insumoId: string;
  let corrida = 0;

  const actor = () => ({ usuarioId: adminId, sucursalId, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest });

  beforeAll(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin-prop-conteo@test.com", sucursalId, rolId: base.admin.id })).id;
  });

  it("con cualquier secuencia de movimientos, conteos, cierres de pendientes y cancelaciones", async () => {
    let cancelacionesVerificadas = 0;
    let cancelacionesDeUnPendienteCerrado = 0;
    let cancelacionesRechazadasPorPosterior = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(arbPaso, { minLength: 3, maxLength: 12 }), async (pasos) => {
        // Un producto nuevo por corrida: arranca en 0 y no hace falta limpiar la base entre corridas.
        const producto = await sembrarProductoDisponible({ codigo: `MP_PROP_${++corrida}`, nombre: `Insumo ${corrida}`, tipo: "MP", unidadStockId: unidadKgId, insumoId }, sucursalId);
        const productoId = producto.id;
        const saldoReal = () => calcularSaldoTotal(productoId, seccionId, prisma);
        let saldo = 0;
        let reloj = 0;
        const conteos: ConteoDelModelo[] = [];
        /**
         * M-2 / D7: un conteo no se cancela si hay otro, no cancelado, posterior —escrito después, o con una línea de Kardex escrita después (un pendiente cerrado con «ajustar» más tarde)—. El modelo lo
         * decide sin mirar la base: cuenta lo que el MODELO sabe de los otros conteos.
         */
        const hayPosterior = (c: ConteoDelModelo) => conteos.some((d) => d !== c && d.estado !== "CANCELADO" && (d.creado > c.creado || (d.movimientoEn !== null && d.movimientoEn > c.creado)));
        const elegirDe = (estado: ConteoDelModelo["estado"], elegir: number) => {
          const candidatos = conteos.filter((c) => c.estado === estado);
          return candidatos.length ? candidatos[elegir % candidatos.length] : null;
        };

        for (const paso of pasos) {
          if (paso.t === "mover") {
            const proceso = paso.delta < 0 ? "CONSUMO" : "COMPRA";
            const op = await prisma.operacion.create({ data: { sucursalId, proceso, fecha: new Date(), usuarioId: adminId } });
            await prisma.movimientoStock.create({
              data: { operacionId: op.id, productoId, seccionId, proceso, cantidad: paso.delta, detalle: "Movimiento de prueba", precioTotal: 0, precioPorUnidadStock: 0 },
            });
            saldo += paso.delta;
          } else if (paso.t === "contar") {
            const r = await registrarConteoFisicoCasoDeUso(actor(), { productoId, seccionId, conteoReal: paso.real, fechaConteo: new Date(), accion: paso.accion });
            expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
            if (!r.ok || r.datos.repetido) continue;
            const dif = paso.real - saldo;
            const aplica = dif !== 0 && paso.accion === "AJUSTAR";
            conteos.push({
              id: r.datos.conteoId,
              real: paso.real,
              estado: dif === 0 ? "RESUELTO" : paso.accion === "AJUSTAR" ? "RESUELTO" : paso.accion === "FALTA_MOVIMIENTO" ? "PENDIENTE" : "DESCARTADO",
              aplicado: aplica ? dif : 0,
              via: "directo",
              creado: ++reloj,
              movimientoEn: aplica ? reloj : null,
            });
            if (aplica) saldo = paso.real;
          } else if (paso.t === "resolver") {
            const c = elegirDe("PENDIENTE", paso.elegir);
            if (!c) continue;
            const r = await resolverConteoPendienteCasoDeUso(actor(), c.id, paso.como);
            expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
            c.estado = "RESUELTO";
            c.via = "pendiente";
            if (paso.como === "ajustar") {
              c.aplicado = c.real - saldo; // contra el saldo de HOY, no el del día del conteo
              saldo = c.real;
              if (c.aplicado !== 0) c.movimientoEn = ++reloj;
            }
          } else {
            const c = elegirDe("RESUELTO", paso.elegir);
            if (!c) continue;
            const movimientosAntes = await prisma.movimientoStock.count({ where: { productoId } });
            const r = await cancelarConteoFisicoCasoDeUso(actor(), c.id);
            if (hayPosterior(c)) {
              // M-2: se rechaza sin escribir nada, y el conteo sigue como estaba (se puede intentar de nuevo si el posterior se cancela).
              expect(r, "cancelar un conteo con otro posterior se rechaza").toMatchObject({ ok: false, codigo: "CONTEO_POSTERIOR" });
              expect(await prisma.movimientoStock.count({ where: { productoId } })).toBe(movimientosAntes);
              expect(await saldoReal()).toBe(saldo);
              cancelacionesRechazadasPorPosterior++;
              continue;
            }
            expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
            saldo -= c.aplicado;
            c.estado = "CANCELADO";
            // La cancelación escribe UNA línea de reversión si el conteo aplicó algo, y ninguna si no aplicó nada.
            expect(await prisma.movimientoStock.count({ where: { productoId } })).toBe(movimientosAntes + (c.aplicado !== 0 ? 1 : 0));
            expect(await saldoReal(), "el saldo después de cancelar es el de antes del conteo").toBe(saldo);
            cancelacionesVerificadas++;
            if (c.via === "pendiente") cancelacionesDeUnPendienteCerrado++;
          }
        }

        expect(await saldoReal()).toBe(saldo);
        for (const c of conteos) {
          const suma = await prisma.movimientoStock.aggregate({ where: { conteoFisicoId: c.id }, _sum: { cantidad: true } });
          expect(Number(suma._sum.cantidad ?? 0), `${c.estado} con aplicado ${c.aplicado}`).toBe(c.estado === "CANCELADO" ? 0 : c.aplicado);
        }
      }),
      { numRuns: NUM_RUNS }
    );
    // El generador tiene que producir cancelaciones: si dejara de hacerlo, la propiedad pasaría sin probar nada.
    expect(cancelacionesVerificadas).toBeGreaterThan(30);
    expect(cancelacionesDeUnPendienteCerrado).toBeGreaterThan(5);
    expect(cancelacionesRechazadasPorPosterior).toBeGreaterThan(5);
  }, 120_000);
});
