import { posix } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { arbolDe, leer, listarArchivos, probarCerco, RAIZ_DEL_REPO, sinComentarios, type Cerco, type Cuentas } from "./cercos/trinquete";

/**
 * Cerco «escritores de precio con visto» (ola «precio y carta», Fase 1; auditoría §19.2 cerco 5, «no sobrescribir»). Informativo, con
 * trinquete: lista los casos de uso que ESCRIBEN un precio —`Producto.precioVenta`, `PrecioLocalProducto` o `PromoCartaSucursal.precioLocal`—
 * y que NO declaran control del valor visto. Meta: 0 en la Fase 2 (cada uno compara lo que vio la pantalla con la base dentro de la
 * transacción y, si cambió, responde `PRECIO_DESACTUALIZADO` o `VERSION_DESACTUALIZADA` sin escribir; el patrón de
 * `fijar-precio-local-de-opcion` y `ajustar-precios-de-la-empresa`).
 *
 * Cómo se calcula:
 *  1. Escritores de precio en la persistencia: cada función exportada de `src/server/persistencia/**` que escribe
 *     `precioLocalProducto.<create|update|upsert|delete…>`, `producto.<update|updateMany|upsert>` con `precioVenta` en el cuerpo o
 *     `promoCartaSucursal.<create|update|upsert…>` con `precioLocal`. Más las que escriben el precio a través de un objeto tipado y el texto
 *     no lo muestra (`ESCRITORES_INDIRECTOS`, con motivo). El alta (`producto.create`) no cuenta: no hay un valor anterior que pisar.
 *  2. Un caso de uso (cualquier archivo de `server/actions/<d>/casos-de-uso/`) escribe un precio si importa una de esas funciones, o si importa
 *     un valor de otro caso de uso que lo escribe (`set-precio-local-producto` → `guardar-precio-local-en-tx` → `escribirPrecioLocal`).
 *  3. Declara control del valor visto si su código (fuera de los comentarios) usa el código `"PRECIO_DESACTUALIZADO"` o `"VERSION_DESACTUALIZADA"`.
 *     Un paso compartido que lo HEREDA de su llamador (`guardar-precio-local-en-tx` dentro de `ajustar-precios-de-la-carta`) no lo declara: cuenta,
 *     porque otros llamadores lo usan sin control.
 * Una entrada por caso de uso, un tipo por precio que escribe; cada entrada con su motivo.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
type Precio = "Producto.precioVenta" | "PrecioLocalProducto" | "PromoCartaSucursal.precioLocal";

const ESCRITORES_INDIRECTOS: readonly { ruta: string; funcion: string; precio: Precio; motivo: string }[] = [
  {
    ruta: "src/server/persistencia/catalogo/productos.ts",
    funcion: "actualizarCamposDeProducto",
    precio: "Producto.precioVenta",
    motivo: "Escribe `args.campos` (CamposDeEdicionDeProducto, que incluye `precioVenta`) con `producto.update`: el texto del cuerpo no nombra el precio.",
  },
];

const CODIGOS_DE_VISTO = /["'`](?:PRECIO_DESACTUALIZADO|VERSION_DESACTUALIZADA)["'`]/;
const RE_CASO_DE_USO = /^src\/server\/actions\/[^/]+\/casos-de-uso\/[^/]+\.ts$/;
const SIN_CONTROL = "Deuda de la ola precio y carta (Fase 2):";

const MOTIVOS: Readonly<Record<string, string>> = {
  "src/server/actions/carta/casos-de-uso/guardar-precio-local-promo-carta.ts": `${SIN_CONTROL} guarda el precio local de una promo en la sucursal sin precio visto.`,
  "src/server/actions/movimientos/casos-de-uso/guardar-precio-local-en-tx.ts": `${SIN_CONTROL} paso compartido que escribe el precio local; el control lo pone solo uno de sus llamadores (ajustar-precios-de-la-carta), no él.`,
};

/** Qué precios escribe el cuerpo de una función de persistencia (ya sin comentarios). */
function preciosQueEscribe(cuerpo: string): Precio[] {
  const precios: Precio[] = [];
  if (/\bprecioLocalProducto\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(cuerpo)) precios.push("PrecioLocalProducto");
  if (/\bproducto\s*\.\s*(?:update|updateMany|upsert)\b/.test(cuerpo) && /\bprecioVenta\b/.test(cuerpo)) precios.push("Producto.precioVenta");
  if (/\bpromoCartaSucursal\s*\.\s*(?:create|createMany|update|updateMany|upsert)\b/.test(cuerpo) && /\bprecioLocal\b/.test(cuerpo)) precios.push("PromoCartaSucursal.precioLocal");
  return precios;
}

/** Las funciones exportadas de una fuente (declaración o `export const f = …`), con su texto. */
function funcionesExportadas(fuente: string, ruta: string): { nombre: string; cuerpo: string }[] {
  const archivo = arbolDe(fuente, ruta);
  const exportada = (n: ts.Node) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  return archivo.statements.flatMap((s) => {
    if (ts.isFunctionDeclaration(s) && s.name && exportada(s)) return [{ nombre: s.name.text, cuerpo: s.getText(archivo) }];
    if (ts.isVariableStatement(s) && exportada(s)) return s.declarationList.declarations.filter((d) => ts.isIdentifier(d.name)).map((d) => ({ nombre: (d.name as ts.Identifier).text, cuerpo: d.getText(archivo) }));
    return [];
  });
}

/** Archivo → función exportada → precios que escribe. */
function escritoresEnPersistencia(raizDelRepo: string): Map<string, Map<string, Precio[]>> {
  const salida = new Map<string, Map<string, Precio[]>>();
  const anotar = (ruta: string, funcion: string, precios: Precio[]) => {
    const porFuncion = salida.get(ruta) ?? new Map<string, Precio[]>();
    porFuncion.set(funcion, [...new Set([...(porFuncion.get(funcion) ?? []), ...precios])]);
    salida.set(ruta, porFuncion);
  };
  for (const ruta of listarArchivos(raizDelRepo, ["src/server/persistencia"], [".ts"])) {
    for (const { nombre, cuerpo } of funcionesExportadas(sinComentarios(leer(raizDelRepo, ruta), ruta), ruta)) {
      const precios = preciosQueEscribe(cuerpo);
      if (precios.length > 0) anotar(ruta, nombre, precios);
    }
  }
  for (const e of ESCRITORES_INDIRECTOS) anotar(e.ruta, e.funcion, [e.precio]);
  return salida;
}

/** Los imports de VALOR de una fuente: módulo resuelto a una ruta de `src/` (o null) → nombres importados. */
function importsDeValor(fuente: string, ruta: string): { destino: string | null; nombres: string[] }[] {
  const archivo = arbolDe(fuente, ruta);
  return archivo.statements.flatMap((s) => {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.importClause?.isTypeOnly) return [];
    const especificador = s.moduleSpecifier.text;
    const base = especificador.startsWith("@/") ? `src/${especificador.slice(2)}` : especificador.startsWith(".") ? posix.join(posix.dirname(ruta), especificador) : null;
    const enlaces = s.importClause?.namedBindings;
    const nombres = enlaces && ts.isNamedImports(enlaces) ? enlaces.elements.filter((e) => !e.isTypeOnly).map((e) => (e.propertyName ?? e.name).text) : [];
    return [{ destino: base === null ? null : base.endsWith(".ts") ? base : `${base}.ts`, nombres }];
  });
}

/** Caso de uso → precios que escribe (directo o por otro caso de uso) y si declara control del valor visto. */
function escritoresDePrecio(raizDelRepo: string): Map<string, { precios: Set<Precio>; conVisto: boolean }> {
  const persistencia = escritoresEnPersistencia(raizDelRepo);
  const casos = listarArchivos(raizDelRepo, ["src/server/actions"], [".ts"]).filter((r) => RE_CASO_DE_USO.test(r));
  const fuentes = new Map(casos.map((r) => [r, sinComentarios(leer(raizDelRepo, r), r)]));
  const imports = new Map(casos.map((r) => [r, importsDeValor(fuentes.get(r)!, r)]));
  const resultado = new Map(casos.map((r) => [r, { precios: new Set<Precio>(), conVisto: CODIGOS_DE_VISTO.test(fuentes.get(r)!) }]));
  for (const caso of casos) {
    for (const { destino, nombres } of imports.get(caso)!) {
      const funciones = destino ? persistencia.get(destino) : undefined;
      for (const nombre of nombres) for (const precio of funciones?.get(nombre) ?? []) resultado.get(caso)!.precios.add(precio);
    }
  }
  // Transitivo por otros casos de uso (un paso compartido que escribe): hasta que no cambie nada.
  for (let cambio = true; cambio; ) {
    cambio = false;
    for (const caso of casos) {
      for (const { destino, nombres } of imports.get(caso)!) {
        if (!destino || !resultado.has(destino) || nombres.length === 0) continue;
        for (const precio of resultado.get(destino)!.precios) {
          if (!resultado.get(caso)!.precios.has(precio)) {
            resultado.get(caso)!.precios.add(precio);
            cambio = true;
          }
        }
      }
    }
  }
  return new Map([...resultado].filter(([, r]) => r.precios.size > 0));
}

function medirSinVisto(raizDelRepo: string): Cuentas {
  const cuentas: Cuentas = {};
  for (const [caso, { precios, conVisto }] of escritoresDePrecio(raizDelRepo)) if (!conVisto) cuentas[caso] = Object.fromEntries([...precios].map((p) => [p, 1]));
  return cuentas;
}

const CERCO_ESCRITORES_DE_PRECIO: Cerco = {
  regla: "escritores-de-precio-con-visto",
  meta: "0 en la Fase 2: todo caso de uso que escribe un precio compara el valor visto y responde PRECIO_DESACTUALIZADO/VERSION_DESACTUALIZADA",
  medir: medirSinVisto,
  motivos: MOTIVOS,
};

describe("cerco «escritores de precio con visto»: el cálculo", () => {
  it("encuentra los escritores de precio de la persistencia (y los indirectos declarados existen y escriben el producto)", () => {
    const persistencia = escritoresEnPersistencia(RAIZ_DEL_REPO);
    expect(persistencia.get("src/server/persistencia/movimientos/precio-local.ts")?.get("escribirPrecioLocal")).toEqual(["PrecioLocalProducto"]);
    expect(persistencia.get("src/server/persistencia/carta/promos.ts")?.get("fijarPrecioLocalDePromo")).toEqual(["PromoCartaSucursal.precioLocal"]);
    expect(persistencia.get("src/server/persistencia/catalogo/productos.ts")?.get("fijarPrecioVentaDeProducto")).toEqual(["Producto.precioVenta"]);
    for (const e of ESCRITORES_INDIRECTOS) {
      const funcion = funcionesExportadas(sinComentarios(leer(RAIZ_DEL_REPO, e.ruta), e.ruta), e.ruta).find((f) => f.nombre === e.funcion);
      expect(funcion?.cuerpo, `${e.ruta}: ${e.funcion} ya no existe`).toBeDefined();
      expect(funcion!.cuerpo, `${e.ruta}: ${e.funcion} ya no escribe el producto`).toMatch(/\bproducto\s*\.\s*(?:update|updateMany|upsert)\b/);
    }
  });

  it("ve los escritores CON control del valor visto (no pasa en vacío) y el paso compartido por transitividad", () => {
    const escritores = escritoresDePrecio(RAIZ_DEL_REPO);
    expect(escritores.get("src/server/actions/catalogo/casos-de-uso/ajustar-precios-de-la-empresa.ts")).toEqual({ precios: new Set(["Producto.precioVenta"]), conVisto: true });
    expect(escritores.get("src/server/actions/movimientos/casos-de-uso/ajustar-precios-de-la-carta.ts")).toEqual({ precios: new Set(["PrecioLocalProducto"]), conVisto: true });
    expect(escritores.get("src/server/actions/movimientos/casos-de-uso/set-precio-local-producto.ts")?.precios).toEqual(new Set(["PrecioLocalProducto"]));
  });

  it("el detector de la persistencia: escritura con el campo de precio sí; un alta, una lectura u otra columna, no", () => {
    expect(preciosQueEscribe("await db.producto.update({ data: { precioVenta: 1 } });")).toEqual(["Producto.precioVenta"]);
    expect(preciosQueEscribe("await db.producto.create({ data: { precioVenta: 1 } });")).toEqual([]);
    expect(preciosQueEscribe("await db.producto.update({ data: { nombre: 'x' } });")).toEqual([]);
    expect(preciosQueEscribe("await db.precioLocalProducto.findUnique({});")).toEqual([]);
    expect(preciosQueEscribe("await tx.precioLocalProducto.upsert({});")).toEqual(["PrecioLocalProducto"]);
    expect(preciosQueEscribe("await db.promoCartaSucursal.upsert({ update: { activa: true } });")).toEqual([]);
  });
});

probarCerco(CERCO_ESCRITORES_DE_PRECIO);
