import { beforeEach, describe, expect, it, vi } from "vitest";
import { cantidadesEfectivas, validarGrupo } from "../../src/core/opciones/public";
import { limpiarBaseDeTest, prisma, prismaSinEmpresa } from "../setup/test-db";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { editarGrupoDeOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/editar-grupo-de-opciones";
import { fijarAdmisionDeGrupoEnProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/fijar-admision-de-grupo-en-producto";

/**
 * GO-2a, paso 9: CONCURRENCIA REAL de lo que admite cada producto (Postgres real, como `motor2_app`), en loop y con la guarda contra el falso verde.
 *  - Dos administradores fijan el MISMO par (producto, grupo) a la vez sobre la misma versión: gana uno, el otro `VERSION_DESACTUALIZADA`; una sola fila.
 *  - WRITE SKEW: una persona baja el máximo de un grupo a 1 mientras otra le fija a un producto un mínimo propio de 2 (válido contra el máximo de antes). Cada transacción lee lo que
 *    la otra escribe (la edición lee las admisiones del grupo; la admisión lee el grupo): SERIALIZABLE aborta a una y su reintento rechaza. Nunca queda confirmada una combinación
 *    inválida (mínimo efectivo por encima del máximo efectivo).
 */
const ITERACIONES = 10;

describe("lo que admite cada producto — concurrencia real (GO-2a)", () => {
  let e: EscenarioDeOpciones;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
  });

  it("dos administradores sobre el mismo par a la vez: uno gana, el otro VERSION_DESACTUALIZADA, una sola fila del grupo", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    for (let i = 0; i < ITERACIONES; i++) {
      const productoId = (await prisma.producto.create({ data: { codigo: `PV_T${i}`, nombre: `Té ${i}`, tipo: "PV", unidadStockId: e.unidadId, precioVenta: "800.00" } })).id;
      const comando = (orden: number) => ({
        productoId,
        grupoId: e.grupoVarianteId,
        versionEsperada: 0,
        orden,
        cantidadMinima: null,
        cantidadMaxima: null,
        modoPrecio: null,
        activo: true,
        opciones: [{ opcionId: e.vacaId, versionEsperada: 0, cantidadMaxima: 1, precioAbsoluto: null, diferencia: null, activo: true }],
      });
      const [a, b] = await Promise.all([fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando(1)), fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando(2))]);
      expect([a, b].filter((r) => r.ok), `iteración ${i}: ${a.mensaje} | ${b.mensaje}`).toHaveLength(1);
      expect([a, b].filter((r) => !r.ok).map((r) => (r.ok ? "" : r.codigo))).toEqual(["VERSION_DESACTUALIZADA"]);
      const filas = await prisma.productoAdmiteGrupo.findMany({ where: { productoId } });
      expect(filas).toHaveLength(1);
      expect(filas[0]!.orden).toBe(a.ok ? 1 : 2);
      expect(await prisma.productoAdmiteOpcion.count({ where: { productoId } })).toBe(1);
    }
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración chocaron: el test no ejercitó el único ni el reintento").toBeGreaterThan(2 * ITERACIONES);
    intentos.mockRestore();
  });

  it("write skew: bajar el máximo del grupo y fijar un mínimo propio incompatible a la vez nunca deja confirmada una combinación inválida", async () => {
    const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
    intentos.mockClear();
    let ganoLaEdicion = 0;
    let ganoLaAdmision = 0;
    for (let i = 0; i < ITERACIONES; i++) {
      const grupo = await prisma.grupoDeOpciones.create({ data: { nombre: `Salsas ${i}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 3 } });
      const opciones = await Promise.all(["A", "B"].map((n) => prisma.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre: n } })));
      for (const o of opciones) await prisma.versionDeOpcion.create({ data: { opcionId: o.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: e.usuarioId } });

      // El orden de llegada se alterna: en las vueltas pares salen a la vez; en las impares la edición sale con una demora creciente, así también se ejercita «gana la admisión»
      // (sin esto la edición, que es más corta, ganaba siempre y nunca se probaba que ELLA mire las cantidades propias de los productos).
      const demora = i % 2 === 0 ? 0 : 20 * i;
      const [edicion, admision] = await Promise.all([
        new Promise((r) => setTimeout(r, demora)).then(() =>
          editarGrupoDeOpcionesCasoDeUso(actor(), { grupoId: grupo.id, versionEsperada: 1, nombre: grupo.nombre, cantidadMinima: 0, cantidadMaxima: 1, activo: true })
        ),
        fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), {
          productoId: e.cafeId,
          grupoId: grupo.id,
          versionEsperada: 0,
          orden: 9,
          cantidadMinima: 2,
          cantidadMaxima: null,
          modoPrecio: null,
          activo: true,
          opciones: opciones.map((o) => ({ opcionId: o.id, versionEsperada: 0, cantidadMaxima: 1, precioAbsoluto: null, diferencia: null, activo: true })),
        }),
      ]);
      expect([edicion.ok, admision.ok].filter(Boolean), `iteración ${i}: ${edicion.mensaje} | ${admision.mensaje}`).toHaveLength(1);
      if (edicion.ok) {
        ganoLaEdicion++;
        expect(admision).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      } else {
        ganoLaAdmision++;
        expect(edicion).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      }
      // Lo confirmado es coherente: el mínimo efectivo de cada producto no pasa el máximo efectivo.
      const g = await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: grupo.id } });
      for (const a of await prisma.productoAdmiteGrupo.findMany({ where: { grupoId: grupo.id, activo: true } })) {
        expect(validarGrupo({ tipo: "VARIANTE", ...cantidadesEfectivas({ tipo: "VARIANTE", cantidadMinima: g.cantidadMinima, cantidadMaxima: g.cantidadMaxima }, a) }).ok, `iteración ${i}`).toBe(true);
      }
    }
    expect(ganoLaEdicion + ganoLaAdmision).toBe(ITERACIONES);
    expect(ganoLaAdmision, "ninguna vuelta la ganó la admisión: no se probó que la edición mire lo que admiten los productos").toBeGreaterThan(0);
    const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
    expect(transacciones, "en ninguna iteración se cruzaron las dos transacciones: el test no ejercitó SERIALIZABLE").toBeGreaterThan(2 * ITERACIONES);
    intentos.mockRestore();
  });
});
