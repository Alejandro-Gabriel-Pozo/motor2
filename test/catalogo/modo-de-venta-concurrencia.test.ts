import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import type { Transaccion } from "../../src/lib/db-tipos";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { sembrarSalon } from "../pos/salon-fixture";
import { sembrarCatalogoPrecioYCarta, type CatalogoPrecioYCarta } from "../setup/siembra-precio-y-carta";
import { actualizarProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/actualizar-producto";
import { vincularGrupoEnProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/vincular-grupo-en-producto";
import { guardComandoDatosDeProducto } from "../../src/core/features/catalogo/productos.guard";

/**
 * Fase 4 de la ola «precio y carta» (ADR-035), CONCURRENCIA: dos personas a la vez, una pasa «Pizzas» a «se vende por opción» y otra le quita «Tipos de Pizza» (su grupo de precio final). Nunca
 * puede quedar una base sin grupo de precio (se vendería suelta a su precio guardado).
 *
 * Los dos lados toman la fila del producto (`tomarFilaDeProducto`, `FOR UPDATE`) ANTES de leer lo que deciden: la edición del producto antes de leer lo que admite, y quitar un grupo antes de leer
 * su admisión. Los dos son SERIALIZABLE, así que además el control de serialización de Postgres aborta a uno si se cruzan (y su reintento ve lo del otro); la toma de la fila hace que no se
 * crucen: el segundo espera al primero y decide con lo que el primero confirmó.
 *
 * Se prueba: (1) la carrera real entre los dos casos de uso, varias veces: gana uno solo y el estado final es coherente; (2) quitar el grupo ESPERA la fila del producto y, si el otro lo dejó base en
 * el medio, rechaza (`BASE_SIN_PRECIO_FINAL`); (3) la edición del producto no lee lo que admite hasta tener la fila.
 * Mutaciones: sacar `tomarFilaDeProducto` de `vincular-grupo-en-producto.ts` rompe (2); sacarla de `actualizar-producto.ts` rompe (3).
 */
describe("Fase 4: pasar a base y quitar el grupo de precio a la vez", () => {
  let s: Awaited<ReturnType<typeof sembrarSalon>>;
  let cat: CatalogoPrecioYCarta;
  let grupoId: string;

  const contexto = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: s.sucursalId, ahora: new Date(), ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }) });

  /** El contexto con una transacción ESPÍA: avisa cada vez que alguien lee `ProductoAdmiteGrupo` dentro de ella. */
  function contextoEspia(alLeerAdmisiones: () => void) {
    const base = contexto();
    const transaccion: Transaccion = (async (fn: Parameters<Transaccion>[0], opciones?: Parameters<Transaccion>[1]) =>
      base.transaccion(async (tx) => {
        const espia = new Proxy(tx, {
          get(objetivo, propiedad) {
            const valor = (objetivo as unknown as Record<string | symbol, unknown>)[propiedad];
            if (propiedad === "productoAdmiteGrupo") alLeerAdmisiones();
            return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(objetivo) : valor;
          },
        });
        return fn(espia);
      }, opciones)) as Transaccion;
    return { ...base, transaccion };
  }

  async function pasarABase(ctx = contexto()) {
    const p = await prisma.producto.findUniqueOrThrow({ where: { id: cat.producto.pizzas! } });
    const datos = { nombre: p.nombre, tipo: p.tipo, unidadStockId: p.unidadStockId, factorConversion: Number(p.factorConversion), modoDeVenta: "BASE_CONFIGURABLE" as const };
    return actualizarProductoCasoDeUso(ctx, { productoId: p.id, datos, puerta: guardComandoDatosDeProducto({ datos }), puedeGestionarConsignacion: true, puedeEditarCamposSensibles: true });
  }
  const quitar = () => vincularGrupoEnProductoCasoDeUso(contexto(), { productoId: cat.producto.pizzas!, grupoId, vinculado: false });
  const estado = async () => ({
    modo: (await prismaAdmin.producto.findUniqueOrThrow({ where: { id: cat.producto.pizzas! }, select: { modoDeVenta: true } })).modoDeVenta,
    grupoActivo: (await prismaAdmin.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: cat.producto.pizzas!, grupoId }, select: { activo: true } })).activo,
  });
  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Otra conexión (SERIALIZABLE) toma la fila del producto y la retiene hasta `soltar()`; antes de confirmar corre `alSoltar`. */
  function retenerFila(alSoltar: (tx: Parameters<Parameters<typeof prismaAdmin.$transaction>[0]>[0]) => Promise<unknown> = async () => undefined) {
    let soltar!: () => void;
    let tomada!: () => void;
    const suelta = new Promise<void>((r) => (soltar = r));
    const yaTomada = new Promise<void>((r) => (tomada = r));
    const fin = prismaAdmin.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Producto" WHERE id = ${cat.producto.pizzas!} FOR UPDATE`;
        await tx.productoAdmiteGrupo.findMany({ where: { productoId: cat.producto.pizzas! }, select: { activo: true } });
        tomada();
        await suelta;
        await alSoltar(tx);
      },
      { isolationLevel: "Serializable", timeout: 30_000 },
    );
    return { yaTomada, soltar, fin };
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    s = await sembrarSalon();
    cat = await sembrarCatalogoPrecioYCarta(s);
    grupoId = (await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: cat.producto.pizzas! }, select: { grupoId: true } })).grupoId;
  });

  it("(1) la carrera real, cinco veces: gana uno solo y nunca queda una base sin su grupo de precio", async () => {
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      await prismaAdmin.producto.update({ where: { id: cat.producto.pizzas! }, data: { modoDeVenta: "DIRECTO" } });
      await prismaAdmin.productoAdmiteGrupo.updateMany({ where: { productoId: cat.producto.pizzas!, grupoId }, data: { activo: true } });
      const [base, quitado] = vuelta % 2 === 0 ? await Promise.all([pasarABase(), quitar()]) : (await Promise.all([quitar(), pasarABase()])).reverse();
      const final = await estado();
      expect(base.ok !== quitado.ok, `vuelta ${vuelta}: gana uno solo (${JSON.stringify([base, quitado])})`).toBe(true);
      expect(final.modo === "BASE_CONFIGURABLE" && !final.grupoActivo, `vuelta ${vuelta}: una base sin grupo de precio`).toBe(false);
      if (base.ok) expect(quitado).toMatchObject({ ok: false, codigo: "BASE_SIN_PRECIO_FINAL" });
      else expect(base).toMatchObject({ ok: false, codigo: "BASE_INVALIDA" });
    }
  }, 60_000);

  it("(2) quitar el grupo ESPERA la fila del producto; si el otro lo dejó base en el medio, rechaza y el grupo queda", async () => {
    const otro = retenerFila((tx) => tx.producto.update({ where: { id: cat.producto.pizzas! }, data: { modoDeVenta: "BASE_CONFIGURABLE" } }));
    await otro.yaTomada;
    let terminado = false;
    const pedido = quitar().then((r) => ((terminado = true), r));
    try {
      await esperar(600);
      expect(terminado, "quitar no avanza mientras otro tiene la fila del producto").toBe(false);
    } finally {
      otro.soltar();
      await otro.fin.catch(() => undefined);
    }
    expect(await pedido).toMatchObject({ ok: false, codigo: "BASE_SIN_PRECIO_FINAL" });
    expect(await estado()).toEqual({ modo: "BASE_CONFIGURABLE", grupoActivo: true });
  });

  it("(3) pasar a base no lee lo que el producto admite hasta tener la fila del producto", async () => {
    const otro = retenerFila();
    await otro.yaTomada;
    let leyoMientrasEsperaba = false;
    let retenida = true;
    const pedido = pasarABase(contextoEspia(() => (leyoMientrasEsperaba ||= retenida)));
    try {
      await esperar(600);
      expect(leyoMientrasEsperaba, "leyó lo que admite el producto sin tener su fila").toBe(false);
    } finally {
      retenida = false;
      otro.soltar();
      await otro.fin.catch(() => undefined);
    }
    expect(await pedido).toMatchObject({ ok: true });
    expect(await estado()).toEqual({ modo: "BASE_CONFIGURABLE", grupoActivo: true });
  });
});
