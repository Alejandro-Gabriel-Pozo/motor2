import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { duplicarProducto } from "../../src/server/actions/catalogo/duplicar-producto";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { nuevoDuplicadoId, sembrarElBife, type EscenarioDelBife } from "../setup/duplicar-producto";

/**
 * COMBINACIONES de «Duplicar producto» (regla del dueño, 2026-10-28; nivel 10 del diseño): las dimensiones cuyas combinaciones cambian dinero, permisos, visibilidad o stock, con la tabla de lo ESPERADO escrita aparte
 * del código (un oráculo legible, abajo) y un test que recorre TODAS las combinaciones (son 2^5 = 32: exhaustivo) contra esa tabla, pasando por la Server Action real.
 *
 * Dimensiones (las cinco que cambian lo que se copia o se rechaza):
 *   R  = tiene `guardar_receta`            O  = tiene `producto_opciones_admitidas`            S  = tiene `producto_campos_sensibles`
 *   cR = el pedido pide copiar la receta   cO = el pedido pide copiar las opciones
 * (`alta_producto` la tienen todas las filas: sin ella no hay nada que combinar, y su rechazo está en `duplicar-producto-permisos.test.ts`.)
 *
 * Reglas esperadas, en palabras:
 *   1. Si pide la receta y no tiene `guardar_receta`: se rechaza el pedido ENTERO (nada se escribe), aunque también pida opciones.
 *   2. Si no (y pide las opciones sin tener `producto_opciones_admitidas`): se rechaza el pedido ENTERO.
 *   3. Si no, se crea el producto: con la receta (versión 1) si la pidió, con las dos filas de grupos y las tres de opciones si las pidió.
 *   4. El precio y la disponibilidad dependen SOLO de S: con la clave, el del original ($5.000) y disponible en las dos sucursales; sin ella, $0 y sin disponibilidad en ninguna.
 */
type Resultado = "OK" | "RECHAZA_POR_FALTA_DE_GUARDAR_RECETA" | "RECHAZA_POR_FALTA_DE_PRODUCTO_OPCIONES_ADMITIDAS";

// [R, O, S, cR, cO, resultado esperado]. La tabla va escrita fila por fila, a propósito: es lo que se lee, no lo que se calcula.
const ORACULO: readonly (readonly [boolean, boolean, boolean, boolean, boolean, Resultado])[] = [
  // R=no, O=no, S=no
  [false, false, false, false, false, "OK"],
  [false, false, false, false, true, "RECHAZA_POR_FALTA_DE_PRODUCTO_OPCIONES_ADMITIDAS"],
  [false, false, false, true, false, "RECHAZA_POR_FALTA_DE_GUARDAR_RECETA"],
  [false, false, false, true, true, "RECHAZA_POR_FALTA_DE_GUARDAR_RECETA"],
  // R=no, O=no, S=sí
  [false, false, true, false, false, "OK"],
  [false, false, true, false, true, "RECHAZA_POR_FALTA_DE_PRODUCTO_OPCIONES_ADMITIDAS"],
  [false, false, true, true, false, "RECHAZA_POR_FALTA_DE_GUARDAR_RECETA"],
  [false, false, true, true, true, "RECHAZA_POR_FALTA_DE_GUARDAR_RECETA"],
  // R=no, O=sí, S=no
  [false, true, false, false, false, "OK"],
  [false, true, false, false, true, "OK"],
  [false, true, false, true, false, "RECHAZA_POR_FALTA_DE_GUARDAR_RECETA"],
  [false, true, false, true, true, "RECHAZA_POR_FALTA_DE_GUARDAR_RECETA"],
  // R=no, O=sí, S=sí
  [false, true, true, false, false, "OK"],
  [false, true, true, false, true, "OK"],
  [false, true, true, true, false, "RECHAZA_POR_FALTA_DE_GUARDAR_RECETA"],
  [false, true, true, true, true, "RECHAZA_POR_FALTA_DE_GUARDAR_RECETA"],
  // R=sí, O=no, S=no
  [true, false, false, false, false, "OK"],
  [true, false, false, false, true, "RECHAZA_POR_FALTA_DE_PRODUCTO_OPCIONES_ADMITIDAS"],
  [true, false, false, true, false, "OK"],
  [true, false, false, true, true, "RECHAZA_POR_FALTA_DE_PRODUCTO_OPCIONES_ADMITIDAS"],
  // R=sí, O=no, S=sí
  [true, false, true, false, false, "OK"],
  [true, false, true, false, true, "RECHAZA_POR_FALTA_DE_PRODUCTO_OPCIONES_ADMITIDAS"],
  [true, false, true, true, false, "OK"],
  [true, false, true, true, true, "RECHAZA_POR_FALTA_DE_PRODUCTO_OPCIONES_ADMITIDAS"],
  // R=sí, O=sí, S=no
  [true, true, false, false, false, "OK"],
  [true, true, false, false, true, "OK"],
  [true, true, false, true, false, "OK"],
  [true, true, false, true, true, "OK"],
  // R=sí, O=sí, S=sí
  [true, true, true, false, false, "OK"],
  [true, true, true, false, true, "OK"],
  [true, true, true, true, false, "OK"],
  [true, true, true, true, true, "OK"],
];

/** Las dimensiones del COMANDO que cambian dinero, permisos, visibilidad o stock, y las que no. Una propiedad nueva en `ComandoDuplicarProducto` sin declarar acá hace fallar el guardián de abajo. */
const DIMENSIONES_DEL_COMANDO: Readonly<Record<string, string>> = {
  duplicadoId: "NO AFECTA: es el id del producto nuevo (clave de idempotencia); su efecto está en `duplicar-producto.test.ts`",
  origenId: "NO AFECTA a la combinación: qué producto se duplica (aislamiento entre empresas en `duplicar-producto.test.ts`)",
  nombre: "NO AFECTA a la combinación: obligatorio y único (probado en `duplicar-producto.test.ts`)",
  copiarReceta: "AFECTA (permisos y stock): cR, arriba",
  copiarOpciones: "AFECTA (permisos y dinero: precios por opción): cO, arriba",
  sucursalDeLaRecetaId: "AFECTA qué receta se copia, no si se copia: la propia o la central de otra sucursal (S-07, probado en `duplicar-producto.test.ts`)",
  precioVenta: "AFECTA (dinero): con S es el que se escribe, sin S solo vale 0 (probado en `duplicar-producto-permisos.test.ts`)",
};
/** Las claves de permiso que la Server Action consulta, y a qué dimensión corresponden. Una clave nueva en la acción sin declarar acá hace fallar el guardián de abajo. */
const CLAVES_DE_LA_ACCION: Readonly<Record<string, string>> = {
  alta_producto: "siempre (el envoltorio): sin ella no hay nada que combinar",
  guardar_receta: "R",
  producto_opciones_admitidas: "O",
  producto_campos_sensibles: "S (por `puedeEditarCamposSensiblesDelProducto`)",
};

describe("Duplicar producto: combinaciones (las 32, contra el oráculo)", () => {
  let e: EscenarioDelBife;
  let n = 0;
  const CLAVES = ["guardar_receta", "producto_opciones_admitidas", "producto_campos_sensibles"] as const;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarElBife();
    await mockearUsuarioActual({ id: e.adminId, email: "admin@test.com", nombre: null });
  });

  it("el oráculo cubre las 32 combinaciones, cada una una sola vez", () => {
    expect(ORACULO).toHaveLength(32);
    expect(new Set(ORACULO.map((f) => f.slice(0, 5).join(","))).size).toBe(32);
  });

  it("cada combinación hace exactamente lo que dice la tabla: qué se rechaza, qué se copia, con qué precio y con qué disponibilidad", async () => {
    for (const [R, O, S, cR, cO, esperado] of ORACULO) {
      const tiene = { guardar_receta: R, producto_opciones_admitidas: O, producto_campos_sensibles: S };
      for (const clave of CLAVES) await prismaAdmin.permisoRol.updateMany({ where: { rolId: e.rolAdminId, accionClave: clave }, data: { puedeVer: tiene[clave], puedeEditar: tiene[clave] } });
      n += 1;
      const nombre = `Bife combinación ${n}`;
      const etiqueta = `R=${R} O=${O} S=${S} cR=${cR} cO=${cO}`;
      const antes = await prismaAdmin.producto.count();
      const r = await duplicarProducto({ duplicadoId: nuevoDuplicadoId(), origenId: e.bifeId, nombre, copiarReceta: cR, copiarOpciones: cO, sucursalDeLaRecetaId: null });

      if (esperado === "OK") {
        expect(r.ok, `${etiqueta}: ${r.mensaje}`).toBe(true);
        const nuevo = await prisma.producto.findFirstOrThrow({ where: { nombre } });
        expect(await prisma.recetaVersion.count({ where: { productoId: nuevo.id } }), `${etiqueta}: receta`).toBe(cR ? 1 : 0);
        expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: nuevo.id } }), `${etiqueta}: grupos`).toBe(cO ? 2 : 0);
        expect(await prisma.productoAdmiteOpcion.count({ where: { productoId: nuevo.id } }), `${etiqueta}: opciones`).toBe(cO ? 3 : 0);
        expect(Number(nuevo.precioVenta), `${etiqueta}: precio`).toBe(S ? 5000 : 0);
        const disponibilidad = await prisma.disponibilidadProducto.findMany({ where: { productoId: nuevo.id } });
        expect(disponibilidad, `${etiqueta}: disponibilidad`).toHaveLength(2);
        expect(disponibilidad.every((d) => d.disponible === S), `${etiqueta}: disponible`).toBe(true);
      } else {
        const clave = esperado === "RECHAZA_POR_FALTA_DE_GUARDAR_RECETA" ? "guardar_receta" : "producto_opciones_admitidas";
        expect(r.ok, etiqueta).toBe(false);
        expect(r.mensaje, etiqueta).toMatch(new RegExp(clave));
        expect(await prismaAdmin.producto.count(), `${etiqueta}: no se escribió nada`).toBe(antes);
        expect(await prisma.producto.count({ where: { nombre } }), etiqueta).toBe(0);
      }
    }
  });

  it("guardián: una propiedad nueva del comando o una clave de permiso nueva en la acción sin declarar si afecta (dinero, permisos, visibilidad, stock) hace fallar este test", () => {
    const raiz = join(__dirname, "../..");
    const schema = readFileSync(join(raiz, "src/core/features/catalogo/duplicar-producto.schema.ts"), "utf8");
    const cuerpo = /export interface ComandoDuplicarProducto \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    const propiedades = [...cuerpo.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!);
    expect(propiedades.length).toBeGreaterThan(0);
    expect([...propiedades].sort(), "ComandoDuplicarProducto vs DIMENSIONES_DEL_COMANDO").toEqual(Object.keys(DIMENSIONES_DEL_COMANDO).sort());

    const accion = readFileSync(join(raiz, "src/server/actions/catalogo/duplicar-producto.ts"), "utf8");
    const claves = new Set([...accion.matchAll(/(?:conPermisoDeEmpresa\(|exigirTambienPermisoDeEmpresa\(ctx, )"(\w+)"/g)].map((m) => m[1]!));
    if (accion.includes("puedeEditarCamposSensiblesDelProducto(ctx)")) claves.add("producto_campos_sensibles");
    expect([...claves].sort(), "claves de la acción vs CLAVES_DE_LA_ACCION").toEqual(Object.keys(CLAVES_DE_LA_ACCION).sort());
  });
});
