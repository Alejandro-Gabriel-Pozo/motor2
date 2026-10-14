import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { esDeGrupoProtegido, esPagina, esRouteHandler, listarArchivosDeApp } from "./guardas/entradas-de-app";
import { accesosA, accesosDeTexto, alcanzables, consultasCrudas, RAIZ, relativa } from "./guardas/lecturas-de-la-carta-publica";

/**
 * GT-13 · LA LISTA CERRADA DE LO QUE LA CARTA PÚBLICA PUEDE EXPONER (requisito nuevo 1 del dueño, plan de endurecimiento de seguridad, tanda T9).
 *
 * Método del dueño: **denegar por defecto**. Un anónimo no alcanza ningún dato; la carta pública es la ÚNICA excepción explícita, y el dueño pidió un guard con la lista cerrada
 * de lo que puede exponer «porque si después queremos incluir un sitio web u otro consumidor, es una excepción explícita contenida sobre los datos que puede tener la carta
 * pública y nada más». Este archivo es ese guard. Tres controles, todos por AST y sin base:
 *
 *  1. QUÉ LEE DE LA BASE (`PUBLICACION_CARTA`, modelo → campos, verificada en las DOS direcciones). Se recorre todo el código ALCANZABLE desde las páginas de `(carta-publica)`, sus
 *     componentes y la entrada `server/carta-publica/sin-sesion.ts` (por las importaciones de valor) y se juntan los campos de cada `select` de cada lectura de Prisma, siguiendo las
 *     relaciones por el esquema. Un campo leído que no está declarado falla (sumar `precioConsignacion: true` al select de productos); una entrada declarada que nadie lee también
 *     (sacar la lista de a poco no deja campos huérfanos). Además: toda lectura de fila lleva `select` (nada de `include` ni de filas enteras), solo hay lecturas (no se escribe, no se cuenta ni se
 *     agrega sin declararlo) y no hay SQL crudo de lectura.
 *  2. QUÉ ARCHIVOS LEEN LA BASE (`ARCHIVOS_QUE_LEEN_LA_BASE`, dos direcciones, con motivo): un archivo nuevo que la carta alcance y toque un modelo se declara a propósito.
 *  3. POR DÓNDE ENTRA CUALQUIER CONSUMIDOR PÚBLICO (el candado a un sitio web futuro): toda página o ruta pública que NO es de la carta tiene que estar declarada con motivo (`PUBLICAS_QUE_NO_SON_LA_CARTA`),
 *     toda otra ruta pública vive en `(carta-publica)`, y lo de `(carta-publica)` y sus componentes importa sus datos SOLO de `server/carta-publica/`. Así el dato que un anónimo puede alcanzar pasa por un
 *     único lugar, el de la lista cerrada de arriba.
 * Lo que SALE hacia el navegador (el HTML y el payload RSC) lo cierran `core/carta/carta-publica.ts` (la proyección sin ids), `test/carta/salida-publica-inventariada.test.ts` (sus claves) y los e2e de S-25.
 * Y el módulo (S-23) y el 404 sin nada publicado (S-24) están en `test/carta/carta-publica-con-modulo.test.ts` y `portal-sin-nada-publicado.test.ts` (GT-12, mitad de la carta pública).
 *
 * Mutaciones (rojo → revertido editando → verde): `precioConsignacion: true` en el select de productos de `menu.ts`; sacar una entrada usada de `PUBLICACION_CARTA`; un `include` en una lectura; sacar el
 * `select` a `empresa.findFirst`; una página pública nueva fuera de `(carta-publica)`; un import de `@/server/lecturas/...` desde una página de la carta; y los casos sintéticos del propio analizador.
 */

// ---------------------------------------------------------------------------------------------------------------------
// 1 y 2 · Lo que lee de la base
// ---------------------------------------------------------------------------------------------------------------------

/** Modelo → los campos que la carta pública LEE de él (con las relaciones que recorre). Cerrada: sumar o sacar uno es una decisión que se toma acá. */
const PUBLICACION_CARTA: Readonly<Record<string, readonly string[]>> = {
  CapacidadSucursal: ["accionClave", "habilitado", "sucursalId"],
  CategoriaProducto: ["nombre"],
  ContenidoCartaProducto: ["descripcion", "especial", "orden", "seccionCartaId", "tags"],
  DescuentoProductoSucursal: ["porcentaje", "productoId"],
  Empresa: ["id", "nombre", "slug"],
  ItemAgrupadoCarta: ["descripcion", "especial", "id", "nombre", "opciones", "orden", "seccionCartaId", "tags"],
  ModuloEmpresa: ["estado", "modulo"],
  OpcionItemAgrupadoCarta: ["orden", "producto"],
  PortalCartaEmpresa: ["valores"],
  PrecioLocalProducto: ["habilitado", "precio", "productoId"],
  // GO-2d: + `gruposAdmitidos` y `opcionesAdmitidas` (las opciones de venta que la carta muestra, decisión del dueño 2026-10-13; abajo, sus modelos).
  Producto: ["categoria", "contenidosCarta", "gruposAdmitidos", "id", "nombre", "opcionesAdmitidas", "precioVenta"],
  PromoCarta: ["descripcion", "id", "orden", "precio", "seccionCartaId", "sucursales", "titulo"],
  PromoCartaSucursal: ["activa", "precioLocal"],
  SeccionCarta: ["descripcion", "id", "imagenUrl", "nombre", "orden", "titulo"],
  Sucursal: ["activo", "empresaId", "id", "nombre", "temaCarta"],
  SucursalPublica: ["etiqueta", "orden", "posH", "posW", "posX", "posY", "publicada", "slug", "subtituloPortal", "sucursal"],
  TemaCartaSucursal: ["aplicarEnCarta", "valores"],
  // GO-2d (ADR-030; GO-0 §4, ampliación aprobada por el dueño el 2026-10-13: la carta muestra tamaños, variantes, guarniciones y adicionales con su precio). Se LEE para calcular el
  // precio con la regla de la venta; lo que SALE lo cierra `CLAVES_DE_LA_CARTA` (nombre del grupo y, por opción, nombre y precio o recargo: desde CARTA-B solo sale lo que CAMBIA EL PRECIO, decidido en el servidor, sin sumar ningún campo). NUNCA: `VersionDeOpcion.factorEscala`,
  // `ConsumoDeOpcion` (la receta), `OpcionDeGrupo.productoId` (el producto que respalda un adicional) ni la foto de lo vendido. `tipoDeDiferencia` y `porcentaje` (de la versión y del
  // producto) no estaban en GO-0 porque el recargo en % llegó con GO-2a: sin ellos un recargo en % se mostraría mal. Los de `PrecioLocalDeOpcion`, `OpcionDeGrupo.grupo/grupoId/
  // productosQueLaAdmiten` y `ProductoAdmiteGrupo.grupoId/productoId` / `ProductoAdmiteOpcion.id/productoId` son del lector ÚNICO de la grilla (`precio-local-de-opciones.ts`); `ProductoAdmiteGrupo.id`,
  // del aviso «admite algún grupo» de `menu.ts` (así una carta sin opciones hace las mismas consultas que antes: lo fija `lecturas-tramo-a.golden.json`).
  GrupoDeOpciones: ["activo", "cantidadMaxima", "cantidadMinima", "id", "nombre", "opciones", "tipo"],
  OpcionApagadaEnSucursal: ["apagada"],
  OpcionDeGrupo: ["activa", "apagadasEnSucursal", "esNinguna", "grupo", "grupoId", "id", "nombre", "orden", "productosQueLaAdmiten", "versiones"],
  PrecioLocalDeOpcion: ["habilitado", "opcion", "opcionId", "precio", "productoId"],
  ProductoAdmiteGrupo: ["activo", "cantidadMaxima", "cantidadMinima", "grupo", "grupoId", "id", "modoPrecio", "orden", "productoId"],
  ProductoAdmiteOpcion: ["activo", "cantidadMaxima", "diferenciaPrecio", "id", "opcionId", "porcentaje", "precioAbsoluto", "productoId", "tipoDeDiferencia"],
  VersionDeOpcion: ["diferenciaPrecio", "numero", "porcentaje", "tipoDeDiferencia"],
};

/** Los archivos del alcance de la carta que tocan un modelo de Prisma, con lo que hacen. Cerrada en las dos direcciones. */
const ARCHIVOS_QUE_LEEN_LA_BASE: Readonly<Record<string, string>> = {
  "src/server/acceso/capacidades-sucursal.ts": "Las capacidades por sucursal: la carta las lee para saber si rige el precio local (devuelve un booleano; pide solo las tres columnas de la regla).",
  "src/server/acceso/modulos-de-empresa.ts": "El único lector del registro de módulos: la carta pregunta si la empresa tiene Carta y Promociones (S-23).",
  "src/server/lecturas/carta/descuentos.ts": "El descuento de producto de la sucursal (R1): cambia el precio que muestra la carta.",
  "src/server/lecturas/carta/empresa.ts": "La empresa ACTIVE por su slug, con {id, slug, nombre}.",
  "src/server/lecturas/carta/menu.ts": "La carta armada de una sucursal: secciones, productos disponibles y visibles, promos e ítems agrupados.",
  "src/server/lecturas/carta/publica.ts": "El registro público de la empresa (portal y carta de cada sucursal publicada), el tema y la apariencia del portal.",
  "src/server/lecturas/catalogo/precio-local.ts": "El precio local vigente de los productos de la sucursal.",
  // GO-2d
  "src/server/lecturas/carta/opciones.ts": "Las opciones de venta de los PV de la carta (grupos, opciones, la versión vigente y lo agotado en la sucursal), para mostrarlas con su precio.",
  "src/server/lecturas/catalogo/precio-local-de-opciones.ts": "El lector único de la grilla de la sucursal: el precio propio de un tamaño (MEDIDA en ABSOLUTO) en esta sucursal.",
};

/** Operaciones que no son una lectura de fila y SÍ están en el alcance: archivo|operación|modelo → por qué no es un problema. Vacía desde P2.1 (se borró `productoTieneDescuentoEnAlgunaSucursal`, el único `count` que estaba acá). */
const OPERACIONES_DECLARADAS: Readonly<Record<string, string>> = {};

/** SQL crudo de lectura que está en el alcance: archivo → por qué no es de negocio. */
const CONSULTAS_CRUDAS_DECLARADAS: Readonly<Record<string, string>> = {
  "src/server/sesion/rol-de-ejecucion.ts": "Lee el rol de la conexión (`current_user`, `rolbypassrls`) para negarse a operar con un rol que salta el RLS: ningún dato de negocio.",
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

const ENTRADAS = [...archivos(join(RAIZ, "src/app/(carta-publica)")), ...archivos(join(RAIZ, "src/components/carta-publica")), join(RAIZ, "src/server/carta-publica/sin-sesion.ts")];
const alcance = alcanzables(ENTRADAS);
const accesos = accesosA(alcance);

/** Modelo → campos leídos (sin repetir, ordenados), a partir de los accesos. */
function camposLeidos(a: readonly { modelo: string; campos: string[] }[]): Record<string, string[]> {
  const porModelo: Record<string, Set<string>> = {};
  for (const acceso of a) {
    for (const c of acceso.campos) {
      const [modelo, campo] = c.split(".");
      (porModelo[modelo] ??= new Set()).add(campo);
    }
  }
  return Object.fromEntries(Object.entries(porModelo).map(([m, cs]) => [m, [...cs].sort()]).sort(([a1], [b1]) => String(a1).localeCompare(String(b1))));
}

describe("GT-13 · lo que la carta pública lee de la base es una lista cerrada", () => {
  it("el análisis llega a las lecturas (que el guardián no pase en vacío)", () => {
    expect(alcance.length, "archivos alcanzados").toBeGreaterThan(30);
    expect(accesos.length, "lecturas de Prisma halladas").toBeGreaterThan(10);
  });

  it("los campos que lee son EXACTAMENTE los de PUBLICACION_CARTA (ni uno más, ni uno menos)", () => {
    const leidos = camposLeidos(accesos);
    const sobrantes = Object.entries(leidos).flatMap(([m, cs]) => cs.filter((c) => !(PUBLICACION_CARTA[m] ?? []).includes(c)).map((c) => `${m}.${c}`));
    expect(sobrantes, "la carta pública lee un campo que la lista cerrada no declara: si es público, sumalo a PUBLICACION_CARTA a propósito; si no, sacalo del select").toEqual([]);
    const huerfanos = Object.entries(PUBLICACION_CARTA).flatMap(([m, cs]) => cs.filter((c) => !(leidos[m] ?? []).includes(c)).map((c) => `${m}.${c}`));
    expect(huerfanos, "PUBLICACION_CARTA declara un campo que la carta ya no lee: sacalo").toEqual([]);
  });

  it("toda lectura de fila lleva `select` (sin `include`, sin filas enteras) y resuelve todas sus relaciones", () => {
    const malas = accesos.filter((a) => a.problemas.length > 0 && !(`${a.archivo}|${a.operacion}|${a.modelo}` in OPERACIONES_DECLARADAS));
    expect(malas.map((a) => `${a.archivo}:${a.linea} ${a.modelo}.${a.operacion}: ${a.problemas.join("; ")}`)).toEqual([]);
  });

  it("las operaciones que no son una lectura de fila están declaradas con motivo, y las declaradas existen", () => {
    const noLecturas = accesos.filter((a) => a.problemas.some((p) => p.startsWith("la operación"))).map((a) => `${a.archivo}|${a.operacion}|${a.modelo}`);
    expect([...new Set(noLecturas)].sort()).toEqual(Object.keys(OPERACIONES_DECLARADAS).sort());
    for (const [clave, motivo] of Object.entries(OPERACIONES_DECLARADAS)) expect(motivo.trim().length, clave).toBeGreaterThan(30);
  });

  it("no hay SQL crudo de lectura en el alcance, salvo el declarado", () => {
    const crudas = [...new Set(consultasCrudas(alcance).map((c) => c.split(":")[0]))].sort();
    expect(crudas).toEqual(Object.keys(CONSULTAS_CRUDAS_DECLARADAS).sort());
    for (const [archivo, motivo] of Object.entries(CONSULTAS_CRUDAS_DECLARADAS)) expect(motivo.trim().length, archivo).toBeGreaterThan(30);
  });

  it("los archivos del alcance que tocan un modelo son EXACTAMENTE los declarados", () => {
    expect([...new Set(accesos.map((a) => a.archivo))].sort()).toEqual(Object.keys(ARCHIVOS_QUE_LEEN_LA_BASE).sort());
    for (const [archivo, motivo] of Object.entries(ARCHIVOS_QUE_LEEN_LA_BASE)) expect(motivo.trim().length, archivo).toBeGreaterThan(30);
  });

  describe("el propio analizador (casos sintéticos)", () => {
    it("junta los campos de un select, siguiendo la relación por el esquema", () => {
      const [a] = accesosDeTexto(`export const f = (db: any) => db.producto.findMany({ select: { id: true, nombre: true, categoria: { select: { nombre: true } }, observaciones: false } });`);
      expect(a.problemas).toEqual([]);
      expect(a.campos.sort()).toEqual(["CategoriaProducto.nombre", "Producto.categoria", "Producto.id", "Producto.nombre"]);
    });
    it("marca un campo sensible nuevo en el select", () => {
      const [a] = accesosDeTexto(`export const f = (db: any) => db.producto.findMany({ select: { id: true, precioConsignacion: true } });`);
      expect(a.campos).toContain("Producto.precioConsignacion");
    });
    it("marca `include`, una lectura sin `select`, una relación sin `select` y un select con spread", () => {
      expect(accesosDeTexto(`export const f = (db: any) => db.producto.findMany({ include: { categoria: true } });`)[0].problemas.join()).toMatch(/include/);
      expect(accesosDeTexto(`export const f = (db: any) => db.producto.findMany({ where: { id: "x" } });`)[0].problemas.join()).toMatch(/sin select/);
      expect(accesosDeTexto(`export const f = (db: any) => db.producto.findMany({ select: { categoria: { where: {} } } });`)[0].problemas.join()).toMatch(/relación sin select/);
      expect(accesosDeTexto(`const base = { id: true }; export const f = (db: any) => db.producto.findMany({ select: { ...base } });`)[0].problemas.join()).toMatch(/spread/);
    });
    it("marca una escritura y un conteo", () => {
      expect(accesosDeTexto(`export const f = (db: any) => db.producto.update({ where: { id: "x" }, data: {} });`)[0].problemas.join()).toMatch(/update/);
      expect(accesosDeTexto(`export const f = (db: any) => db.producto.count({});`)[0].problemas.join()).toMatch(/count/);
    });
    it("resuelve un select escrito en una constante del archivo y en una función de otro archivo", () => {
      const [a, b] = accesosDeTexto(
        `import { seleccionDeSucursalDePromo } from "@/core/carta/public";\nconst S = { id: true, slug: true } as const;\nexport const f = (db: any) => [db.empresa.findFirst({ select: S }), db.promoCarta.findMany({ select: { sucursales: seleccionDeSucursalDePromo("x") } })];`
      );
      expect(a.campos.sort()).toEqual(["Empresa.id", "Empresa.slug"]);
      expect(b.problemas).toEqual([]);
      expect(b.campos.sort()).toEqual(["PromoCarta.sucursales", "PromoCartaSucursal.activa", "PromoCartaSucursal.precioLocal"]);
    });
    it("no ve lo que no es un modelo de Prisma", () => {
      expect(accesosDeTexto(`export const f = (m: any) => m.coso.findMany({ select: { id: true } });`)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3 · Por dónde entra cualquier consumidor público
// ---------------------------------------------------------------------------------------------------------------------

/** Las páginas y rutas públicas que NO son la carta (ruta relativa a `src/app`), con su motivo. Todo lo demás público vive en `(carta-publica)`. */
const PUBLICAS_QUE_NO_SON_LA_CARTA: Readonly<Record<string, string>> = {
  "page.tsx": "La raíz `/`: solo redirige (al login sin sesión, a la pantalla de inicio con sesión); no lee datos.",
  "login/page.tsx": "El formulario de ingreso: tiene que poder abrirse sin sesión; no lee datos de negocio.",
  "invitacion/page.tsx": "Aceptar la invitación del primer gerente (ADR-020): el acceso lo dan el token del enlace y la cuenta de Google del email invitado.",
  "api/auth/[...nextauth]/route.ts": "Auth.js: su propio protocolo decide qué responde.",
};
const esCron = (ruta: string) => /^api\/cron\/[^/]+\/route\.ts$/.test(ruta);

/** Los `@/server/...`, `@/lib/db`, `@/core/auth/...` que un archivo importa por valor y no son de `server/carta-publica/`. */
function importacionesAjenas(texto: string, nombre: string): string[] {
  const sf = ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true, nombre.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ajenas: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.importClause?.isTypeOnly) continue;
    const m = st.moduleSpecifier.text;
    if ((m.startsWith("@/server/") && !m.startsWith("@/server/carta-publica/")) || m === "@/lib/db" || m.startsWith("@/core/auth/") || m.startsWith("@/lib/auth")) ajenas.push(m);
  }
  return ajenas;
}

describe("GT-13 · todo consumidor público entra por server/carta-publica", () => {
  const entradasHttp = listarArchivosDeApp().filter((a) => (esPagina(a) || esRouteHandler(a)) && !esDeGrupoProtegido(a) && !esCron(a));

  it("toda página o ruta pública es de la carta (`(carta-publica)/`) o está declarada con motivo; las declaradas existen", () => {
    const fueraDeLugar = entradasHttp.filter((a) => !a.startsWith("(carta-publica)/") && !(a in PUBLICAS_QUE_NO_SON_LA_CARTA));
    expect(fueraDeLugar, "una ruta pública nueva se pone en (carta-publica) y lee solo de server/carta-publica, o se declara en PUBLICAS_QUE_NO_SON_LA_CARTA con su motivo").toEqual([]);
    for (const [ruta, motivo] of Object.entries(PUBLICAS_QUE_NO_SON_LA_CARTA)) {
      expect(entradasHttp, `${ruta} ya no es una ruta pública`).toContain(ruta);
      expect(motivo.trim().length, ruta).toBeGreaterThan(20);
    }
  });

  it("lo de `(carta-publica)` y los componentes de la carta pública importan sus datos SOLO de server/carta-publica (nada de lecturas, base ni sesión)", () => {
    // La puerta misma (`sin-sesion.ts`) es la que habla con la base: queda afuera de este control y adentro de los de arriba (lo que lee).
    const hallazgos = ENTRADAS.filter((ruta) => !ruta.endsWith("sin-sesion.ts")).flatMap((ruta) => importacionesAjenas(readFileSync(ruta, "utf8"), ruta).map((m) => `${relative(RAIZ, ruta).split(sep).join("/")} importa ${m}`));
    expect(hallazgos).toEqual([]);
  });

  it("hay páginas de la carta que revisar (que una mudanza de carpetas no vacíe el guardián)", () => {
    expect(entradasHttp.filter((a) => a.startsWith("(carta-publica)/")).length).toBeGreaterThanOrEqual(2);
    expect(ENTRADAS.map(relativa).some((r) => r.startsWith("src/components/carta-publica/"))).toBe(true);
  });

  describe("el propio analizador (casos sintéticos)", () => {
    it("ve una lectura, la base y la sesión importadas, y no ve server/carta-publica ni un import de tipos", () => {
      const texto = [
        `import { a } from "@/server/lecturas/carta/menu";`,
        `import { prisma } from "@/lib/db";`,
        `import { auth } from "@/server/sesion/session";`,
        `import { cartaPublica } from "@/server/carta-publica/sin-sesion";`,
        `import type { X } from "@/server/lecturas/carta/menu";`,
      ].join("\n");
      expect(importacionesAjenas(texto, "x.ts")).toEqual(["@/server/lecturas/carta/menu", "@/lib/db", "@/server/sesion/session"]);
    });
  });
});
