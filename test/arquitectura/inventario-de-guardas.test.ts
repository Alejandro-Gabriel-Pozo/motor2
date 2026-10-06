import { describe, expect, it } from "vitest";
import { clavesUsadas, inventariarFuente } from "./guardas/inventario";

/** Tests del inventario mismo, con fuentes en memoria: cada caso aísla un falso negativo/positivo que la regex vieja tenía. */

const claves = (fuente: string) => inventariarFuente("f.ts", fuente).usos.map((u) => u.clave);

describe("inventariarFuente: la clave de cada función de guarda", () => {
  it("encuentra la clave en las guardas de contexto empresa y en el helper del menú", () => {
    const fuente = [
      'return conPermisoDeEmpresa("unidades", async () => ({ ok: true }));',
      'await requerirVerDeEmpresa("proveedores");',
      'const g = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "clientes", ctx.db);',
      'const v = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "categorias", ctx.db);',
      'const m = await accionesDelMenuQueElUsuarioPuedeVer(usuarioId, empresaId, sucursalId, ["comparar_precios", "ver_stock"], db);',
    ].join("\n");
    expect(new Set(claves(fuente))).toEqual(new Set(["unidades", "proveedores", "clientes", "categorias", "comparar_precios", "ver_stock"]));
  });

  it("encuentra la clave en cada función, con la clave en su posición", () => {
    const fuente = [
      'return conPermiso("alta_producto", async () => {});',
      'await requierePermiso(usuarioId, sucursalId, "editar_producto", db);',
      'const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta", ctx.db);',
      'await requerirVer("reportes");',
      'await requerirVerEnSucursal(sucursalId, "precio_local");',
      'const { editar } = await obtenerMiNivelPermiso(usuarioId, sucursalId, "pos_mesas", db);',
      'const visibles = await sucursalesDondeElUsuarioPuedeVer(usuarioId, ids, "ver_auditoria", db);',
      'const puede = await accionesQueElUsuarioPuedeVer(usuarioId, sucursalId, ["comparar_precios", "carta"], db);',
    ].join("\n");
    expect(new Set(claves(fuente))).toEqual(
      new Set(["alta_producto", "editar_producto", "carta", "reportes", "precio_local", "pos_mesas", "ver_auditoria", "comparar_precios"]),
    );
  });

  it("ve conPermiso<T>(…) con genéricos (lo que la regex vieja no veía), también anidados", () => {
    const fuente = [
      'return conPermiso<ResultadoConId>("insumo_alta", async () => ({ ok: true }));',
      'return conPermiso<Awaited<ResultadoConId>>("categoria_alta", async () => ({ ok: true }));',
    ].join("\n");
    expect(claves(fuente)).toEqual(["insumo_alta", "categoria_alta"]);
  });

  it("encuentra la clave aunque la llamada ocupe varias líneas", () => {
    const fuente = 'return conPermiso(\n  "alta_producto",\n  async () => ({ ok: true }),\n);';
    expect(claves(fuente)).toEqual(["alta_producto"]);
  });

  it("registra la línea de la clave", () => {
    const uso = inventariarFuente("f.ts", '\n\nawait requerirVer("reportes");').usos[0];
    expect(uso).toMatchObject({ clave: "reportes", funcion: "requerirVer", archivo: "f.ts", linea: 3 });
  });
});

describe("inventariarFuente: lo que NO es una guarda", () => {
  it("un comentario o un string que menciona la llamada no cuenta", () => {
    const fuente = ['// conPermiso("alta_producto", fn) es un ejemplo', 'const t = \'conPermiso("carta", fn)\';', "/* requerirVer(\"reportes\") */"].join("\n");
    expect(claves(fuente)).toEqual([]);
  });

  it("un nombre de función parecido o un método con el mismo nombre no cuenta", () => {
    const fuente = ['otraFuncionConPermiso("x");', 'obj.conPermiso("y");', "const conPermiso = 3; conPermisoDe(\"z\");"].join("\n");
    expect(claves(fuente)).toEqual([]);
  });

  it("un literal en otra posición de argumento no se confunde con la clave", () => {
    expect(claves('await requierePermiso("no_es_la_clave", "tampoco", "carta", db);')).toEqual(["carta"]);
  });
});

describe("inventariarFuente: claves que no son un literal", () => {
  it("una variable queda en `dinamicos` (no se pierde en silencio) y no cuenta como clave", () => {
    const inv = inventariarFuente("f.ts", "await requierePermiso(usuarioId, sucursalId, accionClave, db);");
    expect(inv.usos).toEqual([]);
    expect(inv.dinamicos).toMatchObject([{ funcion: "requierePermiso", linea: 1, texto: "accionClave" }]);
  });

  it("un literal envuelto en `as const` se lee como literal", () => {
    expect(claves('await requerirVer("carta" as const);')).toEqual(["carta"]);
  });
});

describe("inventariarFuente: el mapa ACCION_POR_PROCESO", () => {
  it("encuentra los valores del mapa, con anotación de tipo o con `satisfies`", () => {
    const anotado = 'export const ACCION_POR_PROCESO: Record<Proceso, AccionClave> = {\n  PRODUCCION: "proceso_produccion",\n  CONSUMO: "proceso_consumo",\n};\n';
    const satisfecho = 'export const ACCION_POR_PROCESO = {\n  PRODUCCION: "proceso_produccion",\n  MERMA: "proceso_merma",\n} as const satisfies Record<Proceso, AccionClave>;\n';
    expect(inventariarFuente("f.ts", anotado).valoresDeMapa.map((u) => u.clave)).toEqual(["proceso_produccion", "proceso_consumo"]);
    expect(inventariarFuente("f.ts", satisfecho).valoresDeMapa.map((u) => u.clave)).toEqual(["proceso_produccion", "proceso_merma"]);
  });

  it("`clavesUsadas` junta los literales de guardas y los valores del mapa", () => {
    const fuente = 'await requerirVer("carta");\nexport const ACCION_POR_PROCESO = { A: "proceso_a" };';
    expect(clavesUsadas(inventariarFuente("f.ts", fuente))).toEqual(new Set(["carta", "proceso_a"]));
  });
});
