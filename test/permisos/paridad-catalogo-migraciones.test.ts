import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Paridad entre el catálogo de acciones del código (`ACCIONES`) y lo que una base REAL acaba teniendo en la tabla `Accion`.
 *
 * Una base real recibe el catálogo por dos caminos: (1) `prisma/seed.ts`, que lo inserta desde `ACCIONES` en el momento en que se corre, y (2)
 * las migraciones de datos, que agregan las claves nuevas a las bases que ya existían. Una clave nueva en `ACCIONES` SIN migración queda sembrada
 * en una base nueva y AUSENTE en las que ya existen: el código la pide y la matriz de permisos no la tiene, así que nadie (ni el admin) puede
 * usarla. Este test reproduce el camino de una base real: arma una base temporal, aplica las migraciones previas a la primera de datos, le inserta
 * el catálogo que sembró el seed original (congelado acá, no se actualiza) y aplica todas las demás; después exige que la tabla coincida con `ACCIONES`.
 *
 * Es el guardián de que cada clave nueva venga con su migración de datos. No corrige nada: si falla, la solución es una migración que inserte la
 * clave (con `ON CONFLICT DO NOTHING`), nunca tocar este test.
 */

/** Catálogo que sembró `prisma/seed.ts` en la primera versión (commit 0564c82). CONGELADO: es el punto de partida de las bases reales. */
const CATALOGO_SEMBRADO_ORIGINALMENTE: ReadonlyArray<{ clave: string; descripcion: string; roles: ReadonlyArray<"admin" | "operador"> }> = [
  { clave: "alta_producto", descripcion: "Dar de alta un producto", roles: ["admin", "operador"] },
  { clave: "editar_producto", descripcion: "Editar un producto existente", roles: ["admin", "operador"] },
  { clave: "guardar_receta", descripcion: "Crear/editar una receta (Editor de Recetas)", roles: ["admin"] },
  { clave: "grupos_familia", descripcion: "Renombrar/fusionar Familias y asignar Grupos", roles: ["admin"] },
  { clave: "secciones", descripcion: "Administrar el catálogo de Secciones", roles: ["admin"] },
  { clave: "unidades", descripcion: "Administrar el catálogo de Unidades de medida", roles: ["admin"] },
  { clave: "proveedores", descripcion: "Administrar el catálogo de Proveedores (activar/desactivar)", roles: ["admin"] },
  { clave: "categorias", descripcion: "Administrar el catálogo de Categorías", roles: ["admin"] },
  { clave: "stock_minimo", descripcion: "Fijar Stock Mínimo (global o por sección)", roles: ["admin"] },
  { clave: "ver_stock", descripcion: "Ver Stock consolidado, por familia y alertas", roles: ["admin", "operador"] },
  { clave: "precio_local", descripcion: "Fijar Precio Local por sucursal", roles: ["admin"] },
  { clave: "promociones_config", descripcion: "Activar Promociones y marcar productos como Combo", roles: ["admin"] },
  { clave: "comparar_precios", descripcion: "Comparar precios por proveedor", roles: ["admin"] },
  { clave: "notificar_alertas", descripcion: "Notificar alertas de stock por mail", roles: ["admin"] },
  { clave: "insumos_mezclados", descripcion: "Revisar insumos con unidad mezclada", roles: ["admin"] },
  { clave: "sincronizar_proveedores", descripcion: "Sincronizar Proveedores desde el historial", roles: ["admin"] },
  { clave: "ejecutar_tests", descripcion: "Ejecutar la suite de tests", roles: ["admin"] },
  { clave: "gestion_usuarios", descripcion: "Gestionar usuarios y roles", roles: ["admin"] },
  { clave: "gestion_permisos", descripcion: "Gestionar qué rol puede hacer cada acción", roles: ["admin"] },
  { clave: "proceso_compra", descripcion: "Registrar una Compra", roles: ["admin", "operador"] },
  { clave: "proceso_produccion", descripcion: "Registrar una Producción", roles: ["admin", "operador"] },
  { clave: "proceso_consumo", descripcion: "Registrar un Consumo", roles: ["admin", "operador"] },
  { clave: "proceso_ajuste", descripcion: "Registrar un Ajuste (corrección de stock)", roles: ["admin"] },
  { clave: "proceso_control", descripcion: "Registrar un Conteo Físico", roles: ["admin", "operador"] },
  { clave: "proceso_transferencia", descripcion: "Registrar una Transferencia entre secciones", roles: ["admin", "operador"] },
  { clave: "proceso_merma", descripcion: "Registrar una Merma", roles: ["admin", "operador"] },
  { clave: "proceso_venta", descripcion: "Registrar una Venta", roles: ["admin", "operador"] },
  { clave: "proceso_devolucion_consignacion", descripcion: "Devolver mercadería al consignante", roles: ["admin", "operador"] },
  { clave: "proceso_devolucion_cliente", descripcion: "Registrar una devolución de cliente (revendible)", roles: ["admin", "operador"] },
  { clave: "proceso_devolucion_proveedor", descripcion: "Devolver mercadería a un proveedor", roles: ["admin", "operador"] },
  { clave: "proceso_transferencia_sucursal", descripcion: "Solicitar/aprobar/aceptar transferencias con otra sucursal", roles: ["admin", "operador"] },
  { clave: "cancelar_conteo", descripcion: "Cancelar un conteo físico ya aplicado", roles: ["admin"] },
  { clave: "capacidades_sucursal", descripcion: "Habilitar/deshabilitar qué puede gestionar cada sucursal", roles: ["admin"] },
  { clave: "alta_sucursal", descripcion: "Dar de alta una sucursal nueva y asignar su primer admin", roles: ["admin"] },
];

/** La primera migración de datos del catálogo: lo sembrado originalmente ya está en la base cuando corre. */
const PRIMERA_MIGRACION_DE_CATALOGO = "20260919120000_permisos_reportes_y_acciones_faltantes";

/**
 * Claves que una base real conserva en `Accion` pero que ya no están en `ACCIONES`: las migraciones de partición NO las borran (fase «expandir»),
 * y las que se retiraron del código nunca se limpiaron de las bases. Cada una con el motivo. Se revisa en las dos direcciones.
 */
const RETIRADAS: Record<string, string> = {
  editar_producto: "reemplazada por las claves de producto de la partición (producto_*)",
  ejecutar_tests: "la suite de tests de Apps Script no existe acá",
  proceso_transferencia_sucursal: "reemplazada por las claves de traspasos (traspaso_*)",
  promociones_config: "partida en promociones_activar / promociones_marcar_combo y luego en la clave de empresa",
  sincronizar_proveedores: "reservada sin server action: nunca se usó",
  carta: "padre de las claves de carta: la partición no lo borra",
  carta_promos: "padre de las claves de promos: la partición no lo borra",
  motivos_movimiento: "padre de las claves de motivos: la partición no lo borra",
  promociones_activar: "reemplazada por la clave de promos de empresa",
  promociones_marcar_combo: "reemplazada por la clave de descuento de producto",
  ver_reportes_dinero: "padre de las claves reporte_*: la partición no lo borra",
  ver_reportes_control: "padre de las claves reporte_*: la partición no lo borra",
  ver_reportes_operativos: "padre de las claves reporte_*: la partición no lo borra",
  ver_reportes_catalogo: "padre de las claves reporte_*: la partición no lo borra",
};

describe("paridad ACCIONES ↔ migraciones: una base real termina con el catálogo del código", () => {
  let base: BaseTemporalMigrada;
  let enBase: Map<string, string>;
  let editaElAdmin: Set<string>;

  beforeAll(async () => {
    base = await crearBaseTemporalMigrada();
    await base.aplicarAntesDe(PRIMERA_MIGRACION_DE_CATALOGO);

    // Lo que hizo el seed original: dos roles globales y, por cada acción, su fila en la matriz (Ver arranca igual a Editar).
    for (const nombre of ["admin", "operador"]) {
      await base.cliente.query(`INSERT INTO "Rol" ("id", "nombre") VALUES ($1, $1)`, [nombre]);
    }
    for (const a of CATALOGO_SEMBRADO_ORIGINALMENTE) {
      await base.cliente.query(`INSERT INTO "Accion" ("clave", "descripcion") VALUES ($1, $2)`, [a.clave, a.descripcion]);
      for (const rol of ["admin", "operador"] as const) {
        const edita = a.roles.includes(rol);
        await base.cliente.query(`INSERT INTO "PermisoRol" ("id", "rolId", "accionClave", "puedeVer", "puedeEditar") VALUES ($1, $2, $3, $4, $4)`, [
          `${rol}-${a.clave}`,
          rol,
          a.clave,
          edita,
        ]);
      }
    }

    await base.aplicarRestantes();
    const filas = await base.cliente.query<{ clave: string; descripcion: string }>(`SELECT "clave", "descripcion" FROM "Accion"`);
    enBase = new Map(filas.rows.map((f) => [f.clave, f.descripcion]));
    const matriz = await base.cliente.query<{ accionClave: string }>(
      `SELECT p."accionClave" FROM "PermisoRol" p JOIN "Rol" r ON r."id" = p."rolId" WHERE r."nombre" = $1 AND p."puedeEditar" = true`,
      ["admin"]
    );
    editaElAdmin = new Set(matriz.rows.map((f) => f.accionClave));
  }, 180_000);

  afterAll(async () => {
    await base?.eliminar();
  }, 60_000);

  it("el catálogo sembrado originalmente tiene las 34 claves de aquel momento", () => {
    expect(CATALOGO_SEMBRADO_ORIGINALMENTE).toHaveLength(34);
  });

  it("toda clave de ACCIONES existe en la tabla Accion de una base migrada (una clave nueva exige su migración de datos)", () => {
    const faltantes = ACCIONES.map((a) => a.clave).filter((c) => !enBase.has(c));
    expect(faltantes, "claves de ACCIONES que una base real NO recibe: agregar una migración de datos con INSERT … ON CONFLICT DO NOTHING").toEqual([]);
  });

  it("la descripción de cada clave es la misma en el código y en la base migrada", () => {
    const distintas = ACCIONES.filter((a) => enBase.has(a.clave) && enBase.get(a.clave) !== a.descripcion).map((a) => ({
      clave: a.clave,
      codigo: a.descripcion,
      base: enBase.get(a.clave),
    }));
    expect(distintas, "descripciones que difieren: la migración tiene que actualizarla (UPDATE) o el código volver a la anterior").toEqual([]);
  });

  it("toda clave de la base que ya no está en ACCIONES está declarada como retirada, con motivo", () => {
    const enCodigo = new Set<string>(ACCIONES.map((a) => a.clave));
    const sobrantes = [...enBase.keys()].filter((c) => !enCodigo.has(c) && !(c in RETIRADAS));
    expect(sobrantes, "claves en la base que el código no conoce y nadie declaró retiradas").toEqual([]);
  });

  it("RETIRADAS no tiene entradas viejas, repetidas con ACCIONES ni sin motivo (se revisa en las dos direcciones)", () => {
    const enCodigo = new Set<string>(ACCIONES.map((a) => a.clave));
    for (const [clave, motivo] of Object.entries(RETIRADAS)) {
      expect(enCodigo.has(clave), `"${clave}" figura como retirada pero sigue en ACCIONES`).toBe(false);
      expect(enBase.has(clave), `"${clave}" figura como retirada y una base migrada ya no la tiene: sacala de RETIRADAS`).toBe(true);
      expect(motivo.trim().length, `"${clave}" sin motivo`).toBeGreaterThan(10);
    }
  });

  it("el admin edita, en una base migrada, toda acción que de fábrica es suya (sin su fila en la matriz, ni el admin puede usarla)", () => {
    const sinFila = ACCIONES.filter((a) => (a.rolesEditarSemilla as readonly string[]).includes("admin") && !editaElAdmin.has(a.clave)).map((a) => a.clave);
    expect(sinFila, "acciones de fábrica del admin que su matriz no tiene en una base migrada: la migración tiene que darle la fila").toEqual([]);
  });
});
