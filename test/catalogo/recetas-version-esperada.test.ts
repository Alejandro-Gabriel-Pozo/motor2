import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import type { Prisma } from "@prisma/client";
import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma, baseDeTest } from "../setup/test-db";
import type { Transaccion } from "../../src/lib/db-tipos";
import { guardarVersionDeRecetaCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/guardar-version-de-receta";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { darDeAltaProducto } from "../../src/server/actions/catalogo/productos";
import { agregarIngredienteAReceta, guardarReceta } from "../../src/server/actions/catalogo/recetas";
import { guardarRecetaACiegas } from "../../src/server/actions/catalogo/receta-a-ciegas";
import { versionVigenteDeReceta } from "../setup/version-de-receta";
import { agregarIngredienteARecetaPropia, crearRecetaPropiaDesdeLaCentral, volverALaRecetaCentral } from "../../src/server/actions/catalogo/receta-sucursal";

/**
 * H7 (Pureza Fase 4, decisión del dueño 2026-10-06: «rechazar con mensaje»): una edición de la receta que se armó leyendo la versión N NO puede pisar a otro que guardó N+1 en el medio.
 * Antes el caso de uso calculaba `version = MAX + 1` sobre lo que hubiera, así que el segundo guardado ganaba EN SILENCIO y el cambio del primero se perdía. Ahora quien lee y modifica manda
 * `versionEsperada` y, si la receta ya va por otra, el guardado se rechaza con un mensaje y no escribe nada.
 */
describe("guardar la receta con versión esperada (H7)", () => {
  let kgId: string;
  let pvId: string;
  let mp1Id: string;
  let mp2Id: string;
  let mp3Id: string;
  let adminId: string;
  const linea = (insumoProductoId: string, cantidad = 0.3) => ({ insumoProductoId, cantidad, unidadId: kgId });
  const versiones = (sucursalId: string | null = null) => prisma.recetaVersion.findMany({ where: { productoId: pvId, sucursalId }, orderBy: { version: "asc" }, include: { ingredientes: true } });
  const ingredientesDeLaUltima = async (sucursalId: string | null = null) => ((await versiones(sucursalId)).at(-1)?.ingredientes ?? []).map((i) => i.insumoProductoId).sort();

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    kgId = (await sembrarCatalogoBase()).kg.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    adminId = admin.id;
    for (const nombre of ["Pizza muzza", "Harina", "Muzzarella", "Tomate"]) {
      await darDeAltaProducto({ nombre, tipo: nombre === "Pizza muzza" ? "PV" : "MP", unidadStockId: kgId, factorConversion: 1 });
    }
    const id = async (nombre: string) => (await prisma.producto.findFirstOrThrow({ where: { nombre } })).id;
    pvId = await id("Pizza muzza");
    mp1Id = await id("Harina");
    mp2Id = await id("Muzzarella");
    mp3Id = await id("Tomate");
  });

  it("un guardado armado sobre una versión que ya cambió se rechaza con un mensaje y no escribe nada", async () => {
    expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true); // v1, sobre «todavía no hay receta»
    expect((await guardarReceta(pvId, [linea(mp1Id), linea(mp2Id)], [], {}, 1)).ok).toBe(true); // v2, sobre v1

    // Otro editor, que había leído la v1 y recién ahora guarda:
    const tarde = await guardarReceta(pvId, [linea(mp1Id), linea(mp3Id)], [], {}, 1);
    expect(tarde.ok).toBe(false);
    expect(!tarde.ok && tarde.mensaje).toMatch(/cambió mientras la editabas.*versión 2.*partiste de la 1.*Recargá/);
    expect((await versiones()).map((v) => v.version)).toEqual([1, 2]); // nada nuevo
    expect(await ingredientesDeLaUltima()).toEqual([mp1Id, mp2Id].sort()); // el cambio del primero NO se perdió
  });

  it("«todavía no hay receta» (0) también se compara: si alguien creó la primera versión, se rechaza", async () => {
    expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true);
    const otraPrimera = await guardarReceta(pvId, [linea(mp2Id)], [], {}, 0);
    expect(otraPrimera.ok).toBe(false);
    expect((await versiones()).map((v) => v.version)).toEqual([1]);
  });

  it("sin versión esperada es un reemplazo completo a ciegas (seeds y scripts): guarda sobre lo que haya", async () => {
    // O.1 (H4C-23): el reemplazo a ciegas ya no es la acción pública sin versión, es la función interna `guardarRecetaACiegas`.
    expect((await guardarRecetaACiegas(pvId, [linea(mp1Id)])).ok).toBe(true);
    expect((await guardarRecetaACiegas(pvId, [linea(mp2Id)])).ok).toBe(true);
    expect((await versiones()).map((v) => v.version)).toEqual([1, 2]);
  });

  it("una versión esperada que no es un entero ≥ 0 se rechaza antes de tocar nada", async () => {
    for (const mala of [-1, 1.5, Number.NaN, "2" as unknown as number]) {
      const r = await guardarReceta(pvId, [linea(mp1Id)], [], {}, mala);
      expect(r.ok, String(mala)).toBe(false);
    }
    expect(await versiones()).toHaveLength(0);
  });

  it("dos guardados simultáneos armados sobre la MISMA versión: gana uno solo y el otro recibe el mensaje (sin importar el orden)", async () => {
    expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true);
    for (let i = 0; i < 6; i++) {
      const esperada = (await versiones()).length;
      const [a, b] = await Promise.all([
        guardarReceta(pvId, [linea(mp1Id), linea(mp2Id, 0.1 + i)], [], {}, esperada),
        guardarReceta(pvId, [linea(mp1Id), linea(mp3Id, 0.1 + i)], [], {}, esperada),
      ]);
      expect([a.ok, b.ok].filter(Boolean), `vuelta ${i}: exactamente uno tiene que ganar`).toHaveLength(1);
      const perdedor = a.ok ? b : a;
      expect(!perdedor.ok && perdedor.mensaje, `vuelta ${i}`).toMatch(/cambió mientras la editabas/);
      expect((await versiones()).map((v) => v.version), `vuelta ${i}: una versión nueva, sin huecos`).toEqual(Array.from({ length: esperada + 1 }, (_, k) => k + 1));
    }
  });

  describe("las acciones puntuales piden la versión que la PANTALLA mostraba (`versionVista`)", () => {
    it("una pantalla vieja no pisa lo que otra persona ya guardó: se rechaza con el mensaje y la receta queda como la dejó la otra", async () => {
      expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true); // v1
      const vistaPorAmbos = await versionVigenteDeReceta(pvId); // las dos personas abren el editor en la v1

      expect((await agregarIngredienteAReceta(pvId, linea(mp2Id), vistaPorAmbos)).ok).toBe(true); // la primera guarda: v2
      const tarde = await agregarIngredienteAReceta(pvId, linea(mp3Id), vistaPorAmbos); // la segunda, con su pantalla vieja
      expect(tarde.ok).toBe(false);
      expect(!tarde.ok && tarde.mensaje).toMatch(/cambió mientras la editabas.*versión 2.*partiste de la 1/);
      expect((await versiones()).map((v) => v.version)).toEqual([1, 2]);
      expect(await ingredientesDeLaUltima()).toEqual([mp1Id, mp2Id].sort());

      // Con la pantalla recargada (v2) el mismo cambio sí entra, y suma al de la otra persona.
      expect((await agregarIngredienteAReceta(pvId, linea(mp3Id), await versionVigenteDeReceta(pvId))).ok).toBe(true);
      expect(await ingredientesDeLaUltima()).toEqual([mp1Id, mp2Id, mp3Id].sort());
    });

    it("dos pantallas que guardan A LA VEZ sobre la misma versión: gana una y la otra recibe el mensaje; nunca se pierde un cambio", async () => {
      expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true);
      const vista = await versionVigenteDeReceta(pvId);
      const [a, b] = await Promise.all([agregarIngredienteAReceta(pvId, linea(mp2Id), vista), agregarIngredienteAReceta(pvId, linea(mp3Id), vista)]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const perdedor = a.ok ? b : a;
      expect(!perdedor.ok && perdedor.mensaje).toMatch(/cambió mientras la editabas/);
      expect(await ingredientesDeLaUltima()).toEqual([mp1Id, a.ok ? mp2Id : mp3Id].sort());
    });

    it("la receta PROPIA de la sucursal también: una pantalla vieja de la serie propia se rechaza", async () => {
      expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true);
      expect((await crearRecetaPropiaDesdeLaCentral(pvId, 0, false)).ok).toBe(true); // propia v1 (la sucursal no tenía serie propia: la pantalla mostraba 0)
      const sucursalId = (await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pvId, sucursalId: { not: null } } })).sucursalId;
      const vista = await versionVigenteDeReceta(pvId, sucursalId); // las dos pantallas abren la propia en la v1

      expect((await agregarIngredienteARecetaPropia(pvId, linea(mp2Id), vista, true)).ok).toBe(true);
      const tarde = await agregarIngredienteARecetaPropia(pvId, linea(mp3Id), vista, true);
      expect(tarde.ok).toBe(false);
      expect(!tarde.ok && tarde.mensaje).toMatch(/cambió mientras la editabas/);
      expect(await ingredientesDeLaUltima(sucursalId)).toEqual([mp1Id, mp2Id].sort());
      expect(await versiones(null), "la central no se tocó").toHaveLength(1);
    });

    it("crear la receta propia con una pantalla que ya no es la vigente también se rechaza (alguien la creó antes)", async () => {
      expect((await guardarReceta(pvId, [linea(mp1Id)], [], {}, 0)).ok).toBe(true);
      expect((await crearRecetaPropiaDesdeLaCentral(pvId, 0, false)).ok).toBe(true);
      await volverALaRecetaCentral(pvId, true); // la propia queda en el historial, deshabilitada
      const tarde = await crearRecetaPropiaDesdeLaCentral(pvId, 0, false); // pantalla que no sabía de esa serie
      expect(tarde.ok).toBe(false);
      expect(!tarde.ok && tarde.mensaje).toMatch(/cambió mientras la editabas/);
    });
  });

  /**
   * D.4 (límite `habilitada` de H7; docs/plan-hito-4-pureza.md §4, F1/F2; aprobado por el dueño el 2026-10-08): volver a la receta central DESHABILITA la propia sin
   * crear una versión, así que la versión que la pantalla manda no alcanza para ver ese cambio. En un plato SIN receta central, una pantalla vieja (que veía la
   * propia habilitada) agregaba un ingrediente: el chequeo de versión pasaba, se creaba la versión N+1 solo con ese ingrediente (la base era «sin receta», porque
   * la propia ya no regía) y la propia se volvía a habilitar. Ahora las acciones de la propia mandan también si la pantalla la veía habilitada
   * (`habilitadaVista`) y el caso de uso lo compara DENTRO de su transacción.
   */
  describe("la receta propia exige que la pantalla viera el mismo estado `habilitada` (D.4)", () => {
    const MENSAJE = 'La receta de "Pizza muzza" en esta sucursal cambió mientras la editabas (alguien volvió a la receta central). Recargá la pantalla y volvé a hacer el cambio.';
    const habilitada = async () => (await prisma.recetaSucursal.findFirstOrThrow({ where: { productoId: pvId } })).habilitada;

    /** Propia v1 de un plato SIN receta central (se arma desde cero con el primer ingrediente), habilitada. Devuelve la sucursal. */
    async function propiaDesdeCero(): Promise<string> {
      expect((await agregarIngredienteARecetaPropia(pvId, linea(mp1Id), 0, false)).ok).toBe(true);
      expect(await versiones(null), "el plato no tiene receta central").toHaveLength(0);
      return (await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pvId, sucursalId: { not: null } } })).sucursalId!;
    }

    it("alguien volvió a la central y una pantalla vieja agrega un ingrediente: se rechaza, no se escribe ninguna versión y la propia sigue deshabilitada", async () => {
      const sucursalId = await propiaDesdeCero();
      const vista = await versionVigenteDeReceta(pvId, sucursalId); // la pantalla de B: propia v1, habilitada
      expect((await volverALaRecetaCentral(pvId, true)).ok).toBe(true); // A vuelve a la central: deshabilita sin versión nueva

      const tarde = await agregarIngredienteARecetaPropia(pvId, linea(mp2Id), vista, true); // B, con la pantalla vieja
      expect(tarde).toEqual({ ok: false, mensaje: MENSAJE });
      expect((await versiones(sucursalId)).map((v) => v.version), "ninguna versión nueva").toEqual([1]);
      expect(await habilitada(), "la propia sigue deshabilitada").toBe(false);

      // Con la pantalla recargada (deshabilitada) el cambio entra como siempre: sin central, arma la propia desde cero (v2) y la vuelve a habilitar.
      expect((await agregarIngredienteARecetaPropia(pvId, linea(mp2Id), vista, false)).ok).toBe(true);
      expect(await ingredientesDeLaUltima(sucursalId)).toEqual([mp2Id]);
      expect(await habilitada()).toBe(true);
    });

    it("`habilitadaVista` es obligatorio: una llamada sin él (o con otra cosa que un booleano) se rechaza sin escribir nada", async () => {
      const sucursalId = await propiaDesdeCero();
      for (const malo of [undefined, "true", 1]) {
        const r = await agregarIngredienteARecetaPropia(pvId, linea(mp2Id), 1, malo as unknown as boolean);
        expect(r, String(malo)).toEqual({ ok: false, mensaje: "No se pudo saber qué receta mostraba la pantalla. Recargá la pantalla y volvé a hacer el cambio." });
      }
      expect((await versiones(sucursalId)).map((v) => v.version)).toEqual([1]);
    });

    it("con volverALaRecetaCentral confirmándose EN MEDIO del guardado: la serialización repite la transacción y la relectura rechaza", async () => {
      const sucursalId = await propiaDesdeCero();
      // El guardado de B corre con una transacción que, en el primer intento, se frena justo después de su primera lectura de `RecetaSucursal` y deja que A
      // vuelva a la central y confirme. B sigue con su foto vieja (habilitada) y escribe: la SERIALIZABLE aborta (40001), el reintento abre otra transacción
      // y la relectura ve la propia deshabilitada.
      let intentos = 0;
      let volvio = false;
      const transaccion: Transaccion = Object.assign(
        <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, opciones?: Parameters<Transaccion>[1]) => {
          intentos += 1;
          const esElPrimero = intentos === 1;
          return baseDeTest.transaccion((tx) => fn(esElPrimero ? frenadaTrasLeerRecetaSucursal(tx) : tx), opciones);
        },
        { aleatorio: () => 0 }
      );
      function frenadaTrasLeerRecetaSucursal(tx: Prisma.TransactionClient): Prisma.TransactionClient {
        return new Proxy(tx, {
          get(objetivo, prop, receptor) {
            const valor: unknown = Reflect.get(objetivo, prop, receptor);
            if (prop !== "recetaSucursal") return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(objetivo) : valor;
            return new Proxy(valor as object, {
              get(modelo, operacion, r) {
                const f: unknown = Reflect.get(modelo, operacion, r);
                if (operacion !== "findUnique" || typeof f !== "function") return f;
                return async (...args: unknown[]) => {
                  const leido: unknown = await (f as (...a: unknown[]) => Promise<unknown>).apply(modelo, args);
                  if (!volvio) {
                    volvio = true;
                    expect((await volverALaRecetaCentral(pvId, true)).ok, "A vuelve a la central mientras B guarda").toBe(true);
                  }
                  return leido;
                };
              },
            });
          },
        });
      }

      const r = await guardarVersionDeRecetaCasoDeUso(
        { usuarioId: adminId, sucursalNombre: "Central", db: prisma, transaccion },
        { productoId: pvId, items: [linea(mp1Id), linea(mp2Id)], pasos: [], cabecera: {}, versionEsperada: 1 },
        { sucursalId, habilitadaEsperada: true }
      );
      expect(volvio, "A volvió a la central en medio del guardado de B").toBe(true);
      expect(intentos, "la serialización repitió la transacción").toBe(2);
      expect(r).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA", mensaje: MENSAJE });
      expect((await versiones(sucursalId)).map((v) => v.version), "ninguna versión nueva").toEqual([1]);
      expect(await habilitada(), "la propia sigue deshabilitada").toBe(false);
    });
  });
});
