import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { llamadasALaBase } from "../../scripts/arquitectura/analizar-fuente";
import { leer, listarArchivos, probarCerco, RAIZ_DEL_REPO, sinComentarios, type Cerco, type Cuentas } from "./cercos/trinquete";

/**
 * Cerco «dueño único por modelo» (ola «precio y carta», Fase 1; contexto «dueño del dato» y regla 7: un atajo desde otra pantalla es
 * SIEMPRE un comando del dueño del dato). Regla: cada modelo de `prisma/schema.prisma` lo ESCRIBE un solo dominio, entendido como la
 * carpeta de primer nivel de `src/server/persistencia/` (`persistencia/<dominio>/…`), que es donde vive toda escritura de la base
 * (`escrituras-solo-en-persistencia.test.ts`).
 *
 * Qué cuenta como escritura, por archivo de `persistencia/` y fuera de los comentarios: `x.<modelo>.<create|createMany|
 * createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany>` y el mismo delegado suelto (mismo detector que
 * `escrituras-solo-en-persistencia`, `scripts/arquitectura/analizar-fuente.ts`), y el SQL crudo de escritura sobre la tabla
 * (`INSERT INTO "Modelo"`, `UPDATE "Modelo"`, `DELETE FROM "Modelo"`, con `$executeRaw` o `$queryRaw`).
 *
 * La línea de base (una entrada por MODELO, un tipo `dominio:<d>` por dominio escritor con su cantidad de archivos) registra:
 *  - los modelos con un DUEÑO DECLARADO (abajo, los del precio) que escribe otro dominio: solo los dominios que no son el dueño. Mover
 *    el precio local a Catálogo (DEC-22, Fase 2) saca `PrecioLocalProducto` y baja la línea de base;
 *  - los modelos sin dueño declarado (o con el dueño pendiente de decisión) que escriben DOS o más dominios: todos sus dominios.
 * Cada entrada lleva su motivo (`MOTIVOS`). Un modelo nuevo escrito desde dos dominios, o un dominio más escribiendo uno de la lista,
 * hace fallar el cerco.
 *
 * Lo que este cerco NO ve, a propósito: QUIÉN llama a la persistencia. Ese cruce lo cuenta la regla R2 de dependency-cruiser
 * (`persistencia-de-otro-dominio`): p. ej. `ProveedorPorProducto` lo escribe solo `persistencia/catalogo` (su dueño, DEC-36), y desde la
 * Fase 2b (D2) el registro de una compra de Movimientos ya no la llama directo sino por el comando de Catálogo `registrar-vinculo-de-compra-en-tx.ts`.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const PERSISTENCIA = "src/server/persistencia";
const PENDIENTE = "pendiente";

/** Dueño declarado de los modelos clave del precio (DEC-22, DEC-36, DEC-31). `pendiente`: el dueño no está decidido y queda como deuda. */
const DUENO_DECLARADO: Readonly<Record<string, string>> = {
  Producto: "catalogo",
  PrecioLocalProducto: "catalogo", // DEC-22: el precio local es de Catálogo (lo persiste persistencia/catalogo/precio-local.ts desde la Fase 2b).
  PromoCartaSucursal: "carta",
  PrecioLocalDeOpcion: "catalogo",
  GrupoDeOpciones: "catalogo",
  ProductoAdmiteGrupo: "catalogo",
  ProveedorPorProducto: "catalogo", // DEC-36.
  PagoConsignante: PENDIENTE, // DEC-31: se deja como está (reportes), registrado como deuda.
};

const MOTIVOS: Readonly<Record<string, string>> = {
  PagoConsignante:
    "Deuda de la ola precio y carta (DEC-31): el pago a consignante se deja en reportes (persistencia/reportes/pago-consignante.ts) sin dueño decidido; queda registrado hasta que se decida.",
  DisponibilidadProducto:
    "Deuda de la ola precio y carta: la disponibilidad la escribe Catálogo (productos.ts) y también el alta de sucursal de auth (sucursales.ts, la disponibilidad inicial de cada producto).",
  Invitacion:
    "Deuda de la ola precio y carta: la invitación la crea y revoca auth (invitaciones-de-usuario.ts) y la marcan enviada/aceptada los archivos de persistencia/invitaciones; dos carpetas para un mismo dominio.",
  MovimientoStock:
    "Deuda de la ola precio y carta: los movimientos de stock los escribe Movimientos y también Traspasos (escribir-movimiento-de-traspaso.ts), que arma los suyos por su cuenta.",
  Operacion:
    "Deuda de la ola precio y carta: la operación la escriben Movimientos, Compras (corrección de compra) y Traspasos; el asiento no tiene un único escritor.",
  Sucursal:
    "Deuda de la ola precio y carta: la sucursal la crea y edita auth (sucursales.ts) y el POS le fija el límite de mesas abiertas (pos/mesas.ts).",
  UsuarioEmpresa:
    "Deuda de la ola precio y carta: la pertenencia a la empresa la escriben permisos (membresias.ts) y auth (gerencia.ts, el traspaso de gerencia).",
  UsuarioSucursal:
    "Deuda de la ola precio y carta: la membresía de sucursal la escriben permisos (membresias.ts) y auth (gerencia.ts, el traspaso de gerencia).",
};

const RE_SQL_DE_ESCRITURA = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"(\w+)"/gi;
const OPERACIONES_DE_ESCRITURA = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);

/** Delegado de Prisma (`precioLocalProducto`) → nombre del modelo (`PrecioLocalProducto`), de los `model X {` del esquema (mismo criterio que `delegadosDeModelos`). */
function modelosDelEsquema(raizDelRepo: string): Map<string, string> {
  const esquema = readFileSync(join(raizDelRepo, "prisma/schema.prisma"), "utf8");
  return new Map([...esquema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => [m[1].charAt(0).toLowerCase() + m[1].slice(1), m[1]]));
}

/** Los modelos que escribe una fuente (ya sin comentarios). */
function modelosQueEscribe(fuente: string, ruta: string, modelos: ReadonlyMap<string, string>): Set<string> {
  const escritos = new Set<string>();
  const delegados = new Set(modelos.keys());
  for (const l of llamadasALaBase(fuente, ruta, delegados)) {
    if (l.clase === "escritura" && l.nombre.includes(".")) escritos.add(modelos.get(l.nombre.split(".")[0])!);
  }
  // El delegado suelto (`const { producto } = tx; producto.create(…)`), como en escrituras-solo-en-persistencia.
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression) && ts.isIdentifier(nodo.expression.expression)) {
      const modelo = modelos.get(nodo.expression.expression.text);
      if (modelo && OPERACIONES_DE_ESCRITURA.has(nodo.expression.name.text)) escritos.add(modelo);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(ts.createSourceFile(ruta, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  const porNombre = new Set(modelos.values());
  for (const m of fuente.matchAll(RE_SQL_DE_ESCRITURA)) if (porNombre.has(m[1])) escritos.add(m[1]);
  return escritos;
}

/** Modelo → dominio → archivos de `persistencia/` que lo escriben. */
function escritoresPorModelo(raizDelRepo: string): Map<string, Map<string, string[]>> {
  const modelos = modelosDelEsquema(raizDelRepo);
  const escritores = new Map<string, Map<string, string[]>>();
  for (const ruta of listarArchivos(raizDelRepo, [PERSISTENCIA], [".ts"])) {
    const partes = ruta.slice(PERSISTENCIA.length + 1).split("/");
    const dominio = partes.length > 1 ? partes[0] : "(raíz de persistencia)";
    for (const modelo of modelosQueEscribe(sinComentarios(leer(raizDelRepo, ruta), ruta), ruta, modelos)) {
      const porDominio = escritores.get(modelo) ?? new Map<string, string[]>();
      porDominio.set(dominio, [...(porDominio.get(dominio) ?? []), ruta]);
      escritores.set(modelo, porDominio);
    }
  }
  return escritores;
}

function medirDuenos(raizDelRepo: string): Cuentas {
  const cuentas: Cuentas = {};
  for (const [modelo, porDominio] of escritoresPorModelo(raizDelRepo)) {
    const dueno = DUENO_DECLARADO[modelo];
    const fuera = dueno && dueno !== PENDIENTE ? [...porDominio.keys()].filter((d) => d !== dueno) : porDominio.size > 1 || dueno === PENDIENTE ? [...porDominio.keys()] : [];
    if (fuera.length > 0) cuentas[modelo] = Object.fromEntries(fuera.map((d) => [`dominio:${d}`, porDominio.get(d)!.length]));
  }
  return cuentas;
}

const CERCO_DUENO_UNICO: Cerco = {
  regla: "dueno-unico-por-modelo",
  meta: "bajar: cada modelo lo escribe un solo dominio; la Fase 2 saca PrecioLocalProducto (DEC-22)",
  medir: medirDuenos,
  motivos: MOTIVOS,
};

describe("cerco «dueño único por modelo»: la declaración y el detector", () => {
  it("cada dueño declarado es un modelo del esquema y una carpeta de persistencia (o `pendiente`)", () => {
    const modelos = new Set(modelosDelEsquema(RAIZ_DEL_REPO).values());
    const problemas = Object.entries(DUENO_DECLARADO).flatMap(([modelo, dueno]) => [
      ...(modelos.has(modelo) ? [] : [`${modelo}: no es un modelo de prisma/schema.prisma`]),
      ...(dueno === PENDIENTE || existsSync(join(RAIZ_DEL_REPO, PERSISTENCIA, dueno)) ? [] : [`${modelo}: el dueño «${dueno}» no es una carpeta de ${PERSISTENCIA}`]),
    ]);
    expect(problemas).toEqual([]);
  });

  it("el detector ve el escritor real de los modelos del precio (no pasa en vacío)", () => {
    const escritores = escritoresPorModelo(RAIZ_DEL_REPO);
    expect([...(escritores.get("Producto")?.keys() ?? [])]).toEqual(["catalogo"]);
    expect(escritores.get("ProveedorPorProducto")?.get("catalogo")).toEqual(["src/server/persistencia/catalogo/upsert-proveedor-por-producto.ts"]);
    expect(escritores.size).toBeGreaterThan(50);
  });

  it("detecta create/update/delete por delegado (también suelto) y el SQL crudo de escritura; no una lectura ni un FOR UPDATE", () => {
    const modelos = new Map([
      ["producto", "Producto"],
      ["precioLocalProducto", "PrecioLocalProducto"],
      ["proveedorPorProducto", "ProveedorPorProducto"],
      ["sucursal", "Sucursal"],
      ["operacion", "Operacion"],
    ]);
    const fuente = [
      "await tx.producto.update({});",
      "const { precioLocalProducto } = tx; await precioLocalProducto.upsert({});",
      'await db.$executeRaw`INSERT INTO "ProveedorPorProducto" (a) VALUES (1) ON CONFLICT DO UPDATE SET a = 1`;',
      'await db.$queryRaw`SELECT id FROM "Sucursal" WHERE id = 1 FOR UPDATE`;',
      "await db.operacion.findMany({});",
    ].join("\n");
    expect([...modelosQueEscribe(fuente, "x.ts", modelos)].sort()).toEqual(["PrecioLocalProducto", "Producto", "ProveedorPorProducto"]);
  });
});

probarCerco(CERCO_DUENO_UNICO);
