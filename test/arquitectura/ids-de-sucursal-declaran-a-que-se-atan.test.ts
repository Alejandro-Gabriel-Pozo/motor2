import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * GT-4, PRIMERA MITAD (plan de endurecimiento de seguridad, tanda T3; fila O.89 de `docs/pureza-integracion.md`): **toda Server Action que recibe por parámetro un id de sucursal
 * declara a qué se ata ese id**. La RLS de hoy separa empresas, NO sucursales: dentro de la empresa, una sucursal que llega desde el cliente está protegida solo por lo que cada
 * acción se acuerde de hacer con ella (S-07 fue exactamente ese olvido: el origen de una copia se buscaba por id sin mirar la membresía). Una acción nueva con un parámetro
 * `sucursal…Id` que no figura acá falla: hay que decidir y escribir a qué se ata, y el guardián comprueba en el código que el atado es real. La segunda mitad (toda escritura con
 * `sucursalId` desde una acción de empresa declara la sucursal y su clave, D1) es `escrituras-en-sucursal-desde-empresa.test.ts` (tanda T6, fila O.59); el consolidado, de T14.
 *
 * Las formas de atarlo (cada una con la evidencia que se exige en el código, leída por AST/texto de la función):
 *  - `SUCURSAL_CON_GATE`: la PRIMERA sentencia es `const ctx = await requerirVerEnSucursal(<id>, "<clave>")` (o `requerirVerAlgunaEnSucursal`): membresía y clave EN ESA sucursal, antes de leer nada.
 *  - `SUCURSAL_ACTIVA`: la acción es `return conPermiso(…)` (gate de la sucursal activa) y compara el id recibido con la activa (`sucursalActivaId: ctx.sucursalId`); un id ajeno se rechaza.
 *  - `MEMBRESIA_EN_ORIGEN`: la acción lee de OTRA sucursal (origen de una copia) y lo hace por `leerOrigenDeCopia(…, "<clave>")` (membresía vigente y «Ver» de la clave en el origen); la
 *    evidencia es la función misma o, si el cuerpo vive en un caso de uso, el archivo indicado.
 *  - `EMPRESA_RLS`: la acción es `return conPermisoDeEmpresa(…)`: la autoridad es una clave de EMPRESA (administración de sucursales o del portal de la carta, no de una sucursal en particular) y el
 *    id solo alcanza sucursales de la empresa del que actúa (la RLS esconde las ajenas). Una acción que escribe en la sucursal elegida con una clave de empresa es el defecto de S-10 (T6): acá no entra.
 *  - `MEMBRESIA_PROPIA`: la acción busca la membresía ACTIVA del usuario en esa sucursal (`usuarioSucursal` por `usuarioId: ctx.usuarioId`) y no hace nada si no la tiene.
 * Mutación: sacar la llamada a `leerOrigenDeCopia` de la copia de la carta o de la receta → rojo (también los casos sintéticos de abajo).
 */
const RAIZ = join(__dirname, "../..");
const ACCIONES = join(RAIZ, "src/server/actions");

type Ata = "SUCURSAL_CON_GATE" | "SUCURSAL_ACTIVA" | "MEMBRESIA_EN_ORIGEN" | "EMPRESA_RLS" | "MEMBRESIA_PROPIA";
interface Declaracion {
  ata: Ata;
  motivo: string;
  /** Solo `MEMBRESIA_EN_ORIGEN`: la clave literal con que se llama a `leerOrigenDeCopia`. */
  clave?: string;
  /** Solo `MEMBRESIA_EN_ORIGEN` cuando el cuerpo vive en un caso de uso: el archivo (desde la raíz) donde está la llamada. */
  evidencia?: string;
}

/** `archivo|función` (el archivo desde `src/server/actions`) → a qué se ata el id de sucursal que recibe. Lista CERRADA: una puerta nueva o una que ya no existe falla. */
const DECLARADAS: Readonly<Record<string, Declaracion>> = {
  "auth/sucursal-activa.ts|cambiarSucursalActiva": { ata: "MEMBRESIA_PROPIA", motivo: "elige entre las sucursales donde el usuario ya tiene membresía ACTIVA; sin ella no hace nada" },
  "auth/sucursales.ts|actualizarActivoSucursal": { ata: "EMPRESA_RLS", motivo: "`activar_sucursal` es una clave de empresa (alta y baja de sucursales); el caso de uso mide el id contra las de la empresa" },
  "auth/sucursales.ts|renombrarSucursal": { ata: "EMPRESA_RLS", motivo: "`renombrar_sucursal` es una clave de empresa; el id solo alcanza sucursales de la empresa" },
  "auth/usuarios.ts|listarUsuariosDeSucursal": { ata: "SUCURSAL_CON_GATE", motivo: "`gestion_usuarios` EN la sucursal pedida, antes de leer a nadie" },
  "auth/usuarios.ts|listarInvitacionesPendientes": { ata: "SUCURSAL_CON_GATE", motivo: "`gestion_usuarios` EN la sucursal pedida; S-16 (O.65) además recorta los accesos de las otras a los de las sucursales que también administra" },
  "carta/copiar-carta.ts|copiarCartaDeSucursal": {
    ata: "MEMBRESIA_EN_ORIGEN",
    clave: "carta_ver",
    evidencia: "src/server/actions/carta/casos-de-uso/copiar-carta-de-sucursal.ts",
    motivo: "S-07 (O.56): el origen se lee con membresía vigente y «Ver» de la carta ALLÍ (`leerOrigenDeCopia` en el caso de uso)",
  },
  "carta/registro-publico.ts|agregarSucursalAlPortal": { ata: "EMPRESA_RLS", motivo: "el portal es de la empresa (`carta_portal`, clave de empresa): administra el registro de todas sus sucursales" },
  "carta/registro-publico.ts|guardarSucursalPublica": { ata: "EMPRESA_RLS", motivo: "el portal es de la empresa (`carta_portal`, clave de empresa)" },
  "carta/registro-publico.ts|quitarSucursalDelPortal": { ata: "EMPRESA_RLS", motivo: "el portal es de la empresa (`carta_portal`, clave de empresa)" },
  "carta/registro-publico.ts|moverSucursalEnMapa": { ata: "EMPRESA_RLS", motivo: "el portal es de la empresa (`carta_portal`, clave de empresa)" },
  "carta/tema.ts|guardarTemaCarta": { ata: "SUCURSAL_ACTIVA", motivo: "`carta_tema` en la sucursal activa; el guard rechaza un id distinto de `ctx.sucursalId`" },
  "carta/tema.ts|cambiarAplicacionTema": { ata: "SUCURSAL_ACTIVA", motivo: "`carta_tema` en la sucursal activa; el guard rechaza un id distinto de `ctx.sucursalId`" },
  "catalogo/receta-sucursal.ts|copiarRecetaPropiaDeOtraSucursal": {
    ata: "MEMBRESIA_EN_ORIGEN",
    clave: "receta_sucursal_copiar",
    motivo: "S-07 (O.56): el origen se lee con membresía vigente y «Ver» de la copia ALLÍ (`leerOrigenDeCopia` en la propia acción)",
  },
  "movimientos/lecturas-conteo-fisico.ts|obtenerHistorialConteosFisicos": { ata: "SUCURSAL_CON_GATE", motivo: "`reporte_conteos` EN la sucursal pedida" },
  "movimientos/precio-local.ts|obtenerPrecioLocalProducto": { ata: "SUCURSAL_CON_GATE", motivo: "`precio_local` EN la sucursal pedida" },
  "movimientos/precio-local.ts|listarPreciosLocales": { ata: "SUCURSAL_CON_GATE", motivo: "`precio_local` EN la sucursal pedida" },
  "movimientos/precio-local.ts|sincronizarPrecioLocalGrupoCarta": { ata: "SUCURSAL_ACTIVA", motivo: "`precio_local` en la sucursal activa; el guard exige que el id sea la activa" },
  "movimientos/secciones.ts|listarSeccionesActivas": { ata: "SUCURSAL_CON_GATE", motivo: "alguna de las pantallas que usan secciones, EN la sucursal pedida" },
  "movimientos/secciones.ts|listarSeccionesParaPanel": { ata: "SUCURSAL_CON_GATE", motivo: "`secciones` EN la sucursal pedida" },
  "permisos/capacidades-sucursal.ts|actualizarCapacidad": { ata: "EMPRESA_RLS", motivo: "`capacidades_sucursal` es una clave de empresa y el caso de uso la limita al gerente (O.41); el id (o `null` = la fila por defecto) solo alcanza sucursales de la empresa" },
  "stock/frecuencia-conteo.ts|listarFrecuenciasConteo": { ata: "SUCURSAL_CON_GATE", motivo: "`conteo_frecuencia` EN la sucursal pedida" },
  "stock/seccion-habitual.ts|listarSeccionesHabituales": { ata: "SUCURSAL_CON_GATE", motivo: "`stock_seccion_habitual` EN la sucursal pedida" },
  "stock/stock-minimo.ts|listarStockMinimo": { ata: "SUCURSAL_CON_GATE", motivo: "`stock_minimo` EN la sucursal pedida" },
  "traspasos/lecturas.ts|obtenerBandejaTransferencias": { ata: "SUCURSAL_CON_GATE", motivo: "`traspaso_ver_bandeja` EN la sucursal pedida; los traspasos de otra sucursal que la tocan son filas de ESTA bandeja por diseño" },
  "traspasos/lecturas.ts|listarSucursalesParaSolicitar": { ata: "SUCURSAL_CON_GATE", motivo: "`traspaso_solicitar` EN la sucursal pedida; devuelve las otras sucursales activas (solo id y nombre) para elegir contraparte" },
  "traspasos/lecturas.ts|listarSucursalesParaEnviar": { ata: "SUCURSAL_CON_GATE", motivo: "`traspaso_enviar_directo` EN la sucursal pedida; devuelve las otras sucursales activas (solo id y nombre) para elegir contraparte" },
};

interface Puerta {
  clave: string;
  /** El texto completo de la función. */
  texto: string;
  /** Los parámetros `sucursal…Id`. */
  parametros: string[];
  /** El texto de la primera sentencia del cuerpo. */
  primera: string;
}

const PARAMETRO_DE_SUCURSAL = /^sucursal\w*Id$/;

function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "casos-de-uso" ? [] : archivosTs(ruta);
    return /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** Las funciones exportadas de un archivo `"use server"` con algún parámetro `sucursal…Id`. */
function puertasDe(rutaRelativa: string, fuente: string): Puerta[] {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const primera = sf.statements[0];
  const esUseServer = primera && ts.isExpressionStatement(primera) && ts.isStringLiteral(primera.expression) && primera.expression.text === "use server";
  if (!esUseServer) return [];
  const resultado: Puerta[] = [];
  const agregar = (nombre: string, parametros: readonly ts.ParameterDeclaration[], cuerpo: ts.ConciseBody | undefined, nodo: ts.Node) => {
    const delId = parametros.filter((p) => ts.isIdentifier(p.name) && PARAMETRO_DE_SUCURSAL.test(p.name.text)).map((p) => (p.name as ts.Identifier).text);
    if (!delId.length) return;
    const sentencia = cuerpo && ts.isBlock(cuerpo) ? cuerpo.statements[0] : undefined;
    resultado.push({ clave: `${rutaRelativa}|${nombre}`, texto: nodo.getText(sf), parametros: delId, primera: sentencia?.getText(sf) ?? "" });
  };
  for (const stmt of sf.statements) {
    const exportada = ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exportada) continue;
    if (ts.isFunctionDeclaration(stmt) && stmt.name) agregar(stmt.name.text, stmt.parameters, stmt.body, stmt);
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) agregar(d.name.text, d.initializer.parameters, d.initializer.body, stmt);
      }
    }
  }
  return resultado;
}

/** Comprueba la evidencia de cada declaración contra el código. Devuelve un problema por cada puerta sin declarar, declaración sobrante o atado que el código no cumple. */
function problemasDe(puertas: readonly Puerta[], declaradas: Readonly<Record<string, Declaracion>>, leer: (rutaDesdeLaRaiz: string) => string): string[] {
  const problemas: string[] = [];
  const claves = new Set(puertas.map((p) => p.clave));
  for (const p of puertas) {
    const d = declaradas[p.clave];
    if (!d) {
      problemas.push(`${p.clave}: recibe ${p.parametros.join(", ")} y no declara a qué se ata (agregala a DECLARADAS con su atado y el motivo)`);
      continue;
    }
    if (!d.motivo.trim()) problemas.push(`${p.clave}: la declaración no tiene motivo`);
    const id = p.parametros[0];
    switch (d.ata) {
      case "SUCURSAL_CON_GATE":
        if (!new RegExp(`^const ctx = await requerirVer(?:Alguna)?EnSucursal\\(\\s*${id}\\s*,`).test(p.primera)) problemas.push(`${p.clave}: declara SUCURSAL_CON_GATE y su primera sentencia no es \`const ctx = await requerirVer…EnSucursal(${id}, …)\``);
        break;
      case "SUCURSAL_ACTIVA":
        if (!p.primera.startsWith("return conPermiso(") || !p.texto.includes("sucursalActivaId: ctx.sucursalId")) problemas.push(`${p.clave}: declara SUCURSAL_ACTIVA y no es \`return conPermiso(…)\` que compare el id con \`sucursalActivaId: ctx.sucursalId\``);
        break;
      case "EMPRESA_RLS":
        if (!p.primera.startsWith("return conPermisoDeEmpresa(")) problemas.push(`${p.clave}: declara EMPRESA_RLS y su primera sentencia no es \`return conPermisoDeEmpresa(…)\``);
        break;
      case "MEMBRESIA_PROPIA":
        if (!p.texto.includes("usuarioSucursal.findUnique") || !p.texto.includes("usuarioId: ctx.usuarioId") || !p.texto.includes("membresia?.activo")) problemas.push(`${p.clave}: declara MEMBRESIA_PROPIA y no busca la membresía activa del usuario`);
        break;
      case "MEMBRESIA_EN_ORIGEN": {
        if (!d.clave) {
          problemas.push(`${p.clave}: MEMBRESIA_EN_ORIGEN sin la clave de \`leerOrigenDeCopia\``);
          break;
        }
        if (!p.primera.startsWith("return conPermiso(")) problemas.push(`${p.clave}: declara MEMBRESIA_EN_ORIGEN y no es \`return conPermiso(…)\``);
        const texto = d.evidencia ? leer(d.evidencia) : p.texto;
        if (!new RegExp(`leerOrigenDeCopia\\(\\s*\\w+\\s*,\\s*\\w+\\s*,\\s*"${d.clave}"\\s*\\)`).test(texto)) problemas.push(`${p.clave}: declara MEMBRESIA_EN_ORIGEN y ${d.evidencia ?? "la acción"} no llama a \`leerOrigenDeCopia(…, "${d.clave}")\``);
        break;
      }
    }
  }
  for (const k of Object.keys(declaradas)) if (!claves.has(k)) problemas.push(`${k}: está declarada y ya no recibe un id de sucursal (o no existe): sacala de DECLARADAS`);
  return problemas;
}

const leerDelDisco = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

function puertasDelCodigo(): Puerta[] {
  return archivosTs(ACCIONES).flatMap((ruta) => puertasDe(relative(ACCIONES, ruta).replace(/\\/g, "/"), readFileSync(ruta, "utf8")));
}

describe("GT-4 (primera mitad): toda Server Action con un id de sucursal declara a qué se ata", () => {
  it("el código y la lista cerrada DECLARADAS coinciden, y cada atado tiene su evidencia en el código", () => {
    expect(problemasDe(puertasDelCodigo(), DECLARADAS, leerDelDisco)).toEqual([]);
  });

  it("encuentra las puertas de la copia entre sucursales (la zona de S-07)", () => {
    const claves = puertasDelCodigo().map((p) => p.clave);
    expect(claves).toContain("carta/copiar-carta.ts|copiarCartaDeSucursal");
    expect(claves).toContain("catalogo/receta-sucursal.ts|copiarRecetaPropiaDeOtraSucursal");
  });

  describe("el guardián en sí (casos sintéticos)", () => {
    const FUENTE = (cuerpo: string) => `"use server";\nexport async function accion(sucursalOrigenId: string) {\n${cuerpo}\n}\n`;
    const puertasDeFuente = (cuerpo: string) => puertasDe("x.ts", FUENTE(cuerpo));
    const declarar = (d: Declaracion) => ({ "x.ts|accion": d });

    it("una acción nueva con un id de sucursal y sin declarar falla", () => {
      expect(problemasDe(puertasDeFuente("return conPermiso(\"a\", async () => ok());"), {}, () => "")).toHaveLength(1);
    });

    it("una declaración que ya no corresponde a ninguna acción falla", () => {
      expect(problemasDe([], declarar({ ata: "EMPRESA_RLS", motivo: "x" }), () => "")).toHaveLength(1);
    });

    it("MEMBRESIA_EN_ORIGEN sin la llamada a leerOrigenDeCopia (la mutación de S-07) falla; con ella, pasa", () => {
      const sin = puertasDeFuente('return conPermiso("a", async (ctx) => { const o = await prisma.sucursal.findUnique({ where: { id: sucursalOrigenId } }); return ok(); });');
      const con = puertasDeFuente('return conPermiso("a", async (ctx) => { const o = await leerOrigenDeCopia(ctx, sucursalOrigenId, "carta_ver"); return ok(); });');
      const d = declarar({ ata: "MEMBRESIA_EN_ORIGEN", clave: "carta_ver", motivo: "x" });
      expect(problemasDe(sin, d, () => "")).toHaveLength(1);
      expect(problemasDe(con, d, () => "")).toEqual([]);
    });

    it("MEMBRESIA_EN_ORIGEN con otra clave que la declarada falla", () => {
      const otra = puertasDeFuente('return conPermiso("a", async (ctx) => { await leerOrigenDeCopia(ctx, sucursalOrigenId, "otra_clave"); return ok(); });');
      expect(problemasDe(otra, declarar({ ata: "MEMBRESIA_EN_ORIGEN", clave: "carta_ver", motivo: "x" }), () => "")).toHaveLength(1);
    });

    it("SUCURSAL_CON_GATE exige el gate del MISMO id como primera sentencia", () => {
      const bien = puertasDeFuente('const ctx = await requerirVerEnSucursal(sucursalOrigenId, "a");\nreturn ctx.db.x.findMany({});');
      const tarde = puertasDeFuente('const x = 1;\nconst ctx = await requerirVerEnSucursal(sucursalOrigenId, "a");\nreturn x;');
      const d = declarar({ ata: "SUCURSAL_CON_GATE", motivo: "x" });
      expect(problemasDe(bien, d, () => "")).toEqual([]);
      expect(problemasDe(tarde, d, () => "")).toHaveLength(1);
    });

    it("EMPRESA_RLS exige conPermisoDeEmpresa, no conPermiso", () => {
      const d = declarar({ ata: "EMPRESA_RLS", motivo: "x" });
      expect(problemasDe(puertasDeFuente('return conPermisoDeEmpresa("a", async () => ok());'), d, () => "")).toEqual([]);
      expect(problemasDe(puertasDeFuente('return conPermiso("a", async () => ok());'), d, () => "")).toHaveLength(1);
    });

    it("un archivo sin \"use server\" no tiene puertas", () => {
      expect(puertasDe("x.ts", "export async function accion(sucursalId: string) { return 1; }")).toEqual([]);
    });
  });
});
