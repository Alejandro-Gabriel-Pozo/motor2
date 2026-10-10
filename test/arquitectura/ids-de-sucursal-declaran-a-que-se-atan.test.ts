import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { esArchivoUseServer, funcionDeInicializador } from "./guardas/analizador";
import { ensanchesUsados, fuentesDe, llamadasAEnsanches } from "./guardas/ensanches";

/**
 * GT-4, PRIMERA MITAD (plan de endurecimiento de seguridad, tanda T3; fila O.89 de `docs/pureza-integracion.md`): **toda Server Action que recibe por parámetro un id de sucursal
 * declara a qué se ata ese id**. La RLS de hoy separa empresas, NO sucursales: dentro de la empresa, una sucursal que llega desde el cliente está protegida solo por lo que cada
 * acción se acuerde de hacer con ella (S-07 fue exactamente ese olvido: el origen de una copia se buscaba por id sin mirar la membresía). Una acción nueva con un parámetro
 * `sucursal…Id` que no figura acá falla: hay que decidir y escribir a qué se ata, y el guardián comprueba en el código que el atado es real. La segunda mitad (toda escritura con
 * `sucursalId` desde una acción de empresa declara la sucursal y su clave, D1) es `escrituras-en-sucursal-desde-empresa.test.ts` (tanda T6, fila O.59).
 * CONSOLIDADO (T14, M-8 y M-9 de la auditoría intermedia): el id puede llegar también DENTRO de un objeto (`input.sucursalId`, `datos.origenSucursalId`, un objeto desestructurado; el tipo se
 * resuelve en línea, en la misma fuente o por el índice de tipos de `src/`, con los esquemas `z.object` y `z.infer`), y la segunda mitad sigue las escrituras entre archivos de persistencia
 * y los modelos de traspaso (`origenSucursalId`/`destinoSucursalId`) y los que cuelgan de una sucursal. Dos formas nuevas de atarlo: `GATE_EN_ESA_SUCURSAL` y `CONTRAPARTE_DE_TRASPASO`.
 * Queda como residuo declarado: la evidencia de `SUCURSAL_ACTIVA` y `MEMBRESIA_PROPIA` sigue siendo una búsqueda de texto en la función.
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
 *
 * M.3-A4 (RLS por sucursal, `plan-m3-rls-por-sucursal`): con la RLS por sucursal, atar el id no alcanza: la base solo deja leer y escribir en las sucursales del ALCANCE del contexto (la activa por
 * defecto), así que cada forma que trabaja en OTRA sucursal queda además atada a su ENSANCHE (`src/server/acceso/alcance.ts`), que solo puede ocurrir DESPUÉS del gate de esa sucursal:
 *  - `SUCURSAL_CON_GATE` → `conAlcanceEnSucursal(…, "LECTURA")`, dentro de `requerirVerEnSucursal`/`requerirVerAlgunaEnSucursal` (`con-sesion.ts`); la primera sentencia de la acción es justo ese envoltorio, y
 *    `ensanches-de-alcance.test.ts` verifica que el ensanche va después del gate.
 *  - `GATE_EN_ESA_SUCURSAL` → `permisoYAlcanceEnSucursal(ctx, <id>, "<clave>")` (`con-permiso.ts`: pide la clave EN esa sucursal y ensancha lectura y escritura solo si dio ok).
 *  - `MEMBRESIA_EN_ORIGEN` → `conAlcanceEnSucursal(…, "LECTURA")` DESPUÉS de `leerOrigenDeCopia(…, "<clave>")`, en la evidencia.
 * Cada declaración de las dos últimas dice en `ensanche` si ya está `CABLEADO` (el código lo tiene, y el guardián lo comprueba) o `PENDIENTE` (A5 lo cablea con la pantalla que lo necesita; el guardián comprueba que
 * NO esté, para que nadie lo cablee sin pasar por acá, y `PENDIENTES_MAXIMOS` solo baja). La otra dirección: ninguna llamada a `conAlcanceEnSucursal`/`permisoYAlcanceEnSucursal` en `src/` fuera de
 * `con-sesion.ts`, `con-permiso.ts` y `alcance.ts` es válida si su archivo no es la acción o la evidencia de una declaración `CABLEADO`. Mutación: ensanche sin gate previo → rojo (casos sintéticos y `ensanches-de-alcance.test.ts`).
 */
const RAIZ = join(__dirname, "../..");
const ACCIONES = join(RAIZ, "src/server/actions");

type Ata = "SUCURSAL_CON_GATE" | "SUCURSAL_ACTIVA" | "MEMBRESIA_EN_ORIGEN" | "EMPRESA_RLS" | "MEMBRESIA_PROPIA" | "GATE_EN_ESA_SUCURSAL" | "CONTRAPARTE_DE_TRASPASO";
interface Declaracion {
  ata: Ata;
  motivo: string;
  /** `MEMBRESIA_EN_ORIGEN`: la clave literal con que se llama a `leerOrigenDeCopia`. `GATE_EN_ESA_SUCURSAL`: la clave con que se llama a `requierePermiso` sobre ESE id. */
  clave?: string;
  /** `MEMBRESIA_EN_ORIGEN` y `CONTRAPARTE_DE_TRASPASO` cuando el cuerpo vive en un caso de uso: el archivo (desde la raíz) donde está la evidencia. */
  evidencia?: string;
  /** `GATE_EN_ESA_SUCURSAL` y `MEMBRESIA_EN_ORIGEN` (M.3-A4): si el ensanche del alcance de esa forma ya está en el código (`CABLEADO`) o lo cablea A5 con la pantalla que lo usa (`PENDIENTE`). */
  ensanche?: "CABLEADO" | "PENDIENTE";
}

/** Cuántas declaraciones pueden estar `PENDIENTE` de cablear su ensanche (A5). Solo baja: cada una que se cablea, baja este número en el mismo commit. */
const PENDIENTES_MAXIMOS = 3;

/** `archivo|función` (el archivo desde `src/server/actions`) → a qué se ata el id de sucursal que recibe. Lista CERRADA: una puerta nueva o una que ya no existe falla. */
const DECLARADAS: Readonly<Record<string, Declaracion>> = {
  "auth/sucursal-activa.ts|cambiarSucursalActiva": { ata: "MEMBRESIA_PROPIA", motivo: "elige entre las sucursales donde el usuario ya tiene membresía ACTIVA; sin ella no hace nada" },
  "auth/sucursales.ts|actualizarActivoSucursal": { ata: "EMPRESA_RLS", motivo: "`activar_sucursal` es una clave de empresa (alta y baja de sucursales); el caso de uso mide el id contra las de la empresa" },
  "auth/sucursales.ts|renombrarSucursal": { ata: "EMPRESA_RLS", motivo: "`renombrar_sucursal` es una clave de empresa; el id solo alcanza sucursales de la empresa" },
  // M-8 de la auditoría intermedia: ids que llegan DENTRO de un objeto.
  "auth/usuarios.ts|agregarOActualizarUsuario": {
    ata: "GATE_EN_ESA_SUCURSAL",
    clave: "gestion_usuarios",
    ensanche: "PENDIENTE",
    motivo: "`input.sucursalId` es la sucursal donde se agrega al usuario: si no es la activa, la acción pide `gestion_usuarios` EN ESA sucursal (`requierePermiso`) antes del caso de uso",
  },
  "catalogo/rendimiento-local.ts|fijarRendimientoLocal": {
    ata: "SUCURSAL_ACTIVA",
    motivo: "`origen.sucursalCalculoId` es la sucursal con que se calculó la sugerencia: el guard del formato lo compara con la activa (`sucursalActivaId: ctx.sucursalId`) y rechaza otra; la escritura es siempre en la activa",
  },
  "traspasos/traspasos.ts|crearSolicitudTransferencia": {
    ata: "CONTRAPARTE_DE_TRASPASO",
    clave: "traspaso_solicitar",
    evidencia: "src/server/actions/traspasos/casos-de-uso/crear-solicitud-de-traspaso.ts",
    motivo: "`datos.origenSucursalId` es la OTRA punta del traspaso (a quien se le pide): se escribe en la activa (la sección de destino es propia) y la fila se ve en la bandeja de la otra por diseño (plan, 6.4 punto 1); el caso de uso rechaza la misma sucursal y una inactiva",
  },
  "traspasos/traspasos.ts|crearEnvioDirectoTransferencia": {
    ata: "CONTRAPARTE_DE_TRASPASO",
    clave: "traspaso_enviar_directo",
    evidencia: "src/server/actions/traspasos/casos-de-uso/crear-envio-directo-de-traspaso.ts",
    motivo: "`datos.destinoSucursalId` es la OTRA punta del traspaso (a quien se le manda): se descuenta de una sección propia de la activa y la fila se ve en la bandeja de la otra por diseño (plan, 6.4 punto 1); el caso de uso rechaza la misma sucursal y una inactiva",
  },
  "auth/usuarios.ts|listarUsuariosDeSucursal": { ata: "SUCURSAL_CON_GATE", motivo: "`gestion_usuarios` EN la sucursal pedida, antes de leer a nadie" },
  "auth/usuarios.ts|listarInvitacionesPendientes": { ata: "SUCURSAL_CON_GATE", motivo: "`gestion_usuarios` EN la sucursal pedida; S-16 (O.65) además recorta los accesos de las otras a los de las sucursales que también administra" },
  "carta/copiar-carta.ts|copiarCartaDeSucursal": {
    ata: "MEMBRESIA_EN_ORIGEN",
    clave: "carta_ver",
    ensanche: "PENDIENTE",
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
    ensanche: "PENDIENTE",
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

/** Un nombre de PROPIEDAD que lleva un id de sucursal: `sucursalId`, `origenSucursalId`, `sucursalOrigenId`, `traspasoSucursalId`… (M-8 de la auditoría intermedia). */
const PROPIEDAD_DE_SUCURSAL = /[sS]ucursal\w*Id$/;

/** Índice de TIPOS del proyecto: nombre → nombres de sus propiedades (`interface`, `type X = { … }` y los esquemas `z.object({ … })`, con `z.infer<typeof X>` resuelto). */
type IndiceDeTipos = ReadonlyMap<string, ReadonlySet<string>>;

function propiedadesDeUnTipo(tipo: ts.TypeNode | undefined, indice: IndiceDeTipos): string[] {
  if (!tipo) return [];
  if (ts.isTypeLiteralNode(tipo)) return tipo.members.flatMap((m) => (m.name && ts.isIdentifier(m.name) ? [m.name.text] : []));
  if (ts.isParenthesizedTypeNode(tipo)) return propiedadesDeUnTipo(tipo.type, indice);
  if (ts.isIntersectionTypeNode(tipo) || ts.isUnionTypeNode(tipo)) return tipo.types.flatMap((t) => propiedadesDeUnTipo(t, indice));
  if (ts.isTypeReferenceNode(tipo)) {
    const nombre = tipo.typeName.getText();
    if (indice.has(nombre)) return [...indice.get(nombre)!];
    // `z.infer<typeof Esquema>` y `Readonly<X>`/`Partial<X>`: se mira el argumento
    return (tipo.typeArguments ?? []).flatMap((a) => (ts.isTypeQueryNode(a) ? [...(indice.get(a.exprName.getText()) ?? [])] : propiedadesDeUnTipo(a, indice)));
  }
  return [];
}

/** Arma el índice de tipos con las fuentes dadas (`archivo → texto`). */
function indiceDeTipos(fuentes: Iterable<string>): IndiceDeTipos {
  const indice = new Map<string, Set<string>>();
  const alias: { nombre: string; tipo: ts.TypeNode }[] = [];
  for (const codigo of fuentes) {
    if (!/ucursal\w*Id/.test(codigo)) continue;
    const sf = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
    for (const s of sf.statements) {
      if (ts.isInterfaceDeclaration(s)) indice.set(s.name.text, new Set(s.members.flatMap((m) => (m.name && ts.isIdentifier(m.name) ? [m.name.text] : []))));
      if (ts.isTypeAliasDeclaration(s)) alias.push({ nombre: s.name.text, tipo: s.type });
      if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) {
          // `const Esquema = z.object({ … })`
          const init = d.initializer;
          const llamada = init && ts.isCallExpression(init) && init.arguments[0] && ts.isObjectLiteralExpression(init.arguments[0]) ? init.arguments[0] : undefined;
          if (ts.isIdentifier(d.name) && llamada) indice.set(d.name.text, new Set(llamada.properties.flatMap((p) => (p.name && ts.isIdentifier(p.name) ? [p.name.text] : []))));
        }
      }
    }
  }
  for (const { nombre, tipo } of alias) indice.set(nombre, new Set(propiedadesDeUnTipo(tipo, indice)));
  return indice;
}

/**
 * Las funciones exportadas de un archivo `"use server"` con algún id de sucursal: un parámetro `sucursal…Id`, o (M-8 de la auditoría intermedia: los ids que llegan DENTRO de un objeto
 * escapaban) una propiedad de sucursal en un parámetro de objeto —desestructurado, con un tipo en línea, o con un tipo nombrado que `indice` resuelve—, que se nombra `parametro.propiedad`.
 */
function puertasDe(rutaRelativa: string, fuente: string, indice: IndiceDeTipos = new Map()): Puerta[] {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  if (!esArchivoUseServer(fuente)) return [];
  const resultado: Puerta[] = [];
  const agregar = (nombre: string, parametros: readonly ts.ParameterDeclaration[], cuerpo: ts.ConciseBody | undefined, nodo: ts.Node) => {
    const delId = parametros.flatMap((p): string[] => {
      if (ts.isIdentifier(p.name)) {
        if (PARAMETRO_DE_SUCURSAL.test(p.name.text)) return [p.name.text];
        return propiedadesDeUnTipo(p.type, indice).filter((prop) => PROPIEDAD_DE_SUCURSAL.test(prop)).map((prop) => `${(p.name as ts.Identifier).text}.${prop}`);
      }
      if (ts.isObjectBindingPattern(p.name)) {
        const delPatron = p.name.elements.flatMap((e) => (ts.isIdentifier(e.name) && PROPIEDAD_DE_SUCURSAL.test((e.propertyName && ts.isIdentifier(e.propertyName) ? e.propertyName : e.name).getText()) ? [e.name.text] : []));
        return delPatron.length ? delPatron : propiedadesDeUnTipo(p.type, indice).filter((prop) => PROPIEDAD_DE_SUCURSAL.test(prop));
      }
      return [];
    });
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
        // I-2 de la auditoría final: también la acción exportada como constante con envoltorio o `as` (`export const borrar = conRegistro(async (sucursalId) => …)`).
        const funcion = ts.isIdentifier(d.name) && d.initializer ? funcionDeInicializador(d.initializer) : undefined;
        if (funcion && ts.isIdentifier(d.name)) agregar(d.name.text, funcion.parameters, funcion.body, stmt);
      }
    }
  }
  return resultado;
}

/**
 * M.3-A4: el ENSANCHE del alcance de una forma que trabaja en otra sucursal (`GATE_EN_ESA_SUCURSAL`, `MEMBRESIA_EN_ORIGEN`). `PENDIENTE`: el código NO lo tiene todavía (si lo tiene, hay que marcarlo
 * `CABLEADO`: el estado de la declaración no puede mentir). `CABLEADO`: `GATE_EN_ESA_SUCURSAL` llama a `permisoYAlcanceEnSucursal(ctx, <el id que llegó>, "<clave>")` (pide la clave allí y recién entonces
 * ensancha); `MEMBRESIA_EN_ORIGEN` llama a `conAlcanceEnSucursal(<ctx>, <el origen>, "LECTURA")` DESPUÉS de `leerOrigenDeCopia` (nunca antes: sin gate previo no hay ensanche) y nunca a la sucursal activa.
 */
function problemasDelEnsanche(p: Puerta, d: Declaracion, texto: string, id: string): string[] {
  if (!d.ensanche) return [`${p.clave}: ${d.ata} sin \`ensanche\` (CABLEADO o PENDIENTE): con la RLS por sucursal el id atado tiene que poder alcanzar su sucursal`];
  const llamadas = llamadasAEnsanches(texto, ["conAlcanceEnSucursal", "permisoYAlcanceEnSucursal"]);
  if (d.ensanche === "PENDIENTE") return llamadas.length ? [`${p.clave}: la declaración dice ensanche PENDIENTE y el código ya llama a \`${llamadas[0]!.ensanche}\`: marcala CABLEADO (y bajá PENDIENTES_MAXIMOS)`] : [];
  const propiedad = id.includes(".") ? id.split(".")[1]! : id;
  if (d.ata === "GATE_EN_ESA_SUCURSAL") {
    const ok = llamadas.some(
      (l) => l.ensanche === "permisoYAlcanceEnSucursal" && l.argumentos[0] === "ctx" && (l.argumentos[1] ?? "").endsWith(propiedad) && !/^(ctx|contexto)\./.test(l.argumentos[1] ?? "") && l.argumentos[2] === `"${d.clave}"`,
    );
    return ok ? [] : [`${p.clave}: declara ensanche CABLEADO y no llama a \`permisoYAlcanceEnSucursal(ctx, <el id que llegó: …${propiedad}>, "${d.clave}")\``];
  }
  // MEMBRESIA_EN_ORIGEN
  const ensanches = llamadas.filter((l) => l.ensanche === "conAlcanceEnSucursal" && l.argumentos[2] === '"LECTURA"' && !/^(ctx|actor)\.sucursalId$/.test(l.argumentos[1] ?? ""));
  const despuesDelGate = ensanches.length > 0 && texto.indexOf("leerOrigenDeCopia(") >= 0 && texto.indexOf("leerOrigenDeCopia(") < texto.indexOf("conAlcanceEnSucursal(");
  return despuesDelGate ? [] : [`${p.clave}: declara ensanche CABLEADO y no llama a \`conAlcanceEnSucursal(…, <el origen>, "LECTURA")\` DESPUÉS de \`leerOrigenDeCopia\` (sin gate previo no hay ensanche)`];
}

/**
 * La otra dirección: toda llamada a `conAlcanceEnSucursal`/`permisoYAlcanceEnSucursal` de `src/` fuera de la infraestructura (`alcance.ts`, `con-sesion.ts`, `con-permiso.ts`, que verifica
 * `ensanches-de-alcance.test.ts`) tiene que estar en la acción o en la evidencia de una declaración `CABLEADO`. Un ensanche que ninguna forma de GT-4 declara no existe.
 */
function ensanchesSinDeclarar(fuentes: ReadonlyMap<string, string>, declaradas: Readonly<Record<string, Declaracion>>): string[] {
  const INFRAESTRUCTURA = new Set(["src/server/acceso/alcance.ts", "src/server/actions/con-sesion.ts", "src/server/actions/con-permiso.ts"]);
  const permitidos = new Set<string>();
  for (const [clave, d] of Object.entries(declaradas)) {
    if (d.ensanche !== "CABLEADO") continue;
    permitidos.add(`src/server/actions/${clave.split("|")[0]}`);
    if (d.evidencia) permitidos.add(d.evidencia);
  }
  const problemas: string[] = [];
  for (const [ruta, codigo] of fuentes) {
    if (INFRAESTRUCTURA.has(ruta) || permitidos.has(ruta)) continue;
    const usados = ensanchesUsados(codigo, ["conAlcanceEnSucursal", "permisoYAlcanceEnSucursal"]);
    if (usados.length) problemas.push(`${ruta}: usa \`${usados[0]}\` y ninguna declaración CABLEADO de DECLARADAS lo ata (un ensanche del alcance se declara en su forma de GT-4, después de su gate)`);
  }
  return problemas;
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
      case "GATE_EN_ESA_SUCURSAL": {
        // `requierePermiso(<usuario>, <expresión que nombra el id>, "<clave>", …)`: el permiso se pide EN la sucursal que llegó, no en la activa.
        const propiedad = id.includes(".") ? id.split(".")[1]! : id;
        if (!d.clave) {
          problemas.push(`${p.clave}: GATE_EN_ESA_SUCURSAL sin la clave`);
          break;
        }
        if (!p.primera.startsWith("return conPermiso(")) problemas.push(`${p.clave}: declara GATE_EN_ESA_SUCURSAL y no es \`return conPermiso(…)\``);
        // el segundo argumento NO puede ser la sucursal activa (`ctx.sucursalId`): pedir la clave en la activa no ata el id que llegó
        // M.3-A4: pedirla a mano (`requierePermiso`, ensanche PENDIENTE) o con el ayudante que pide la clave EN esa sucursal y además ensancha (`permisoYAlcanceEnSucursal`, ensanche CABLEADO).
        const pideLaClave = new RegExp(`requierePermiso\\(\\s*[\\w.]+\\s*,\\s*(?!ctx\\.|contexto\\.)[\\w.]*${propiedad}\\s*,\\s*"${d.clave}"`).test(p.texto);
        const pideYEnsancha = new RegExp(`permisoYAlcanceEnSucursal\\(\\s*ctx\\s*,\\s*(?!ctx\\.|contexto\\.)[\\w.]*${propiedad}\\s*,\\s*"${d.clave}"`).test(p.texto);
        if (!pideLaClave && !pideYEnsancha) problemas.push(`${p.clave}: declara GATE_EN_ESA_SUCURSAL y no llama a \`requierePermiso(…, <el id que llegó: …${propiedad}>, "${d.clave}", …)\` (la sucursal activa, \`ctx.sucursalId\`, no es el id que llegó)`);
        problemas.push(...problemasDelEnsanche(p, d, p.texto, id));
        break;
      }
      case "CONTRAPARTE_DE_TRASPASO": {
        if (!d.clave || !d.evidencia) {
          problemas.push(`${p.clave}: CONTRAPARTE_DE_TRASPASO sin la clave o sin el archivo de evidencia`);
          break;
        }
        if (!new RegExp(`^return conPermiso\\(\\s*"${d.clave}"`).test(p.primera)) problemas.push(`${p.clave}: declara CONTRAPARTE_DE_TRASPASO y no es \`return conPermiso("${d.clave}", …)\``);
        const evidencia = leer(d.evidencia);
        // el caso de uso rechaza la misma sucursal y toma la sección de la ACTIVA (`actor.sucursalId`): la escritura es del lado de quien actúa
        if (!/SucursalId\s*===\s*actor\.sucursalId/.test(evidencia) || !/obtenerSeccionPropia\([^)]*actor\.sucursalId/.test(evidencia)) {
          problemas.push(`${p.clave}: declara CONTRAPARTE_DE_TRASPASO y ${d.evidencia} no rechaza la misma sucursal ni toma la sección de la activa (\`actor.sucursalId\`)`);
        }
        break;
      }
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
        problemas.push(...problemasDelEnsanche(p, d, texto, id));
        break;
      }
    }
  }
  for (const k of Object.keys(declaradas)) if (!claves.has(k)) problemas.push(`${k}: está declarada y ya no recibe un id de sucursal (o no existe): sacala de DECLARADAS`);
  return problemas;
}

const leerDelDisco = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

/** Todo `src/` (los tipos de los parámetros viven en los archivos de las acciones, en `core/features/**` y donde se declaren). */
function todasLasFuentes(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return todasLasFuentes(ruta);
    return /\.tsx?$/.test(nombre) ? [readFileSync(ruta, "utf8")] : [];
  });
}

const INDICE = indiceDeTipos(todasLasFuentes(join(RAIZ, "src")));

function puertasDelCodigo(): Puerta[] {
  return archivosTs(ACCIONES).flatMap((ruta) => puertasDe(relative(ACCIONES, ruta).replace(/\\/g, "/"), readFileSync(ruta, "utf8"), INDICE));
}

describe("GT-4 (primera mitad): toda Server Action con un id de sucursal declara a qué se ata", () => {
  it("el código y la lista cerrada DECLARADAS coinciden, y cada atado tiene su evidencia en el código", () => {
    expect(problemasDe(puertasDelCodigo(), DECLARADAS, leerDelDisco)).toEqual([]);
  });

  it("M.3-A4: cada forma que trabaja en otra sucursal está atada a su ensanche del alcance, en las dos direcciones, y los pendientes de A5 no aumentan", () => {
    expect(ensanchesSinDeclarar(fuentesDe(RAIZ, "src"), DECLARADAS)).toEqual([]);
    const pendientes = Object.entries(DECLARADAS).filter(([, d]) => d.ensanche === "PENDIENTE").map(([k]) => k);
    expect(pendientes.length, `ensanches PENDIENTES (los cablea A5 con la pantalla que los usa): ${pendientes.join(", ")}`).toBeLessThanOrEqual(PENDIENTES_MAXIMOS);
    // Las formas con ensanche declaran siempre su estado; las otras no lo llevan.
    for (const [k, d] of Object.entries(DECLARADAS)) {
      const lleva = d.ata === "GATE_EN_ESA_SUCURSAL" || d.ata === "MEMBRESIA_EN_ORIGEN";
      expect(d.ensanche !== undefined, `${k}: ${d.ata} ${lleva ? "debe" : "no debe"} declarar \`ensanche\``).toBe(lleva);
    }
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

    it("I-2: una acción exportada como CONSTANTE con envoltorio, `as` o satisfies también es una puerta (antes quedaba fuera del inventario)", () => {
      const fuente = (inicializador: string) => `"use server";\nexport const accion = ${inicializador};\n`;
      for (const inicializador of [
        "conRegistro(async (sucursalOrigenId: string) => ok())",
        "(async (sucursalOrigenId: string) => ok()) as Accion",
        "((async (sucursalOrigenId: string) => ok()) satisfies Accion)",
        "conRegistro(conPermiso(\"a\", async (sucursalOrigenId: string) => ok()))",
      ]) {
        expect(puertasDe("x.ts", fuente(inicializador)).map((p) => p.clave), inicializador).toEqual(["x.ts|accion"]);
      }
      // y un comentario antes de la directiva no saca el archivo del alcance
      expect(puertasDe("x.ts", `/* nota */\n"use server";\nexport async function accion(sucursalOrigenId: string) {}`)).toHaveLength(1);
    });

    it("una declaración que ya no corresponde a ninguna acción falla", () => {
      expect(problemasDe([], declarar({ ata: "EMPRESA_RLS", motivo: "x" }), () => "")).toHaveLength(1);
    });

    it("MEMBRESIA_EN_ORIGEN sin la llamada a leerOrigenDeCopia (la mutación de S-07) falla; con ella, pasa", () => {
      const sin = puertasDeFuente('return conPermiso("a", async (ctx) => { const o = await prisma.sucursal.findUnique({ where: { id: sucursalOrigenId } }); return ok(); });');
      const con = puertasDeFuente('return conPermiso("a", async (ctx) => { const o = await leerOrigenDeCopia(ctx, sucursalOrigenId, "carta_ver"); return ok(); });');
      const d = declarar({ ata: "MEMBRESIA_EN_ORIGEN", clave: "carta_ver", ensanche: "PENDIENTE", motivo: "x" });
      expect(problemasDe(sin, d, () => "")).toHaveLength(1);
      expect(problemasDe(con, d, () => "")).toEqual([]);
    });

    describe("M.3-A4: el ensanche de cada forma", () => {
      const ORIGEN = (cuerpo: string) => puertasDeFuente(`return conPermiso("a", async (ctx) => { ${cuerpo} return ok(); });`);
      const dOrigen = (ensanche?: "CABLEADO" | "PENDIENTE") => declarar({ ata: "MEMBRESIA_EN_ORIGEN", clave: "carta_ver", ...(ensanche ? { ensanche } : {}), motivo: "x" });
      const LEE = 'const o = await leerOrigenDeCopia(ctx, sucursalOrigenId, "carta_ver");';
      const ENSANCHA = 'const c2 = conAlcanceEnSucursal(ctx, sucursalOrigenId, "LECTURA");';

      it("MEMBRESIA_EN_ORIGEN: CABLEADO exige el ensanche DESPUÉS de leerOrigenDeCopia, en LECTURA y sobre el origen; antes del gate (la mutación) o sobre la activa falla", () => {
        expect(problemasDe(ORIGEN(`${LEE} ${ENSANCHA}`), dOrigen("CABLEADO"), () => "")).toEqual([]);
        expect(problemasDe(ORIGEN(`${ENSANCHA} ${LEE}`), dOrigen("CABLEADO"), () => "")).toHaveLength(1);
        expect(problemasDe(ORIGEN(LEE), dOrigen("CABLEADO"), () => "")).toHaveLength(1);
        expect(problemasDe(ORIGEN(`${LEE} ${ENSANCHA.replace('"LECTURA"', '"LECTURA_Y_ESCRITURA"')}`), dOrigen("CABLEADO"), () => "")).toHaveLength(1);
        expect(problemasDe(ORIGEN(`${LEE} ${ENSANCHA.replace("sucursalOrigenId", "ctx.sucursalId")}`), dOrigen("CABLEADO"), () => "")).toHaveLength(1);
      });

      it("PENDIENTE no puede tener ya el ensanche (el estado no miente); sin `ensanche` declarado falla", () => {
        expect(problemasDe(ORIGEN(LEE), dOrigen("PENDIENTE"), () => "")).toEqual([]);
        expect(problemasDe(ORIGEN(`${LEE} ${ENSANCHA}`), dOrigen("PENDIENTE"), () => "")).toHaveLength(1);
        expect(problemasDe(ORIGEN(LEE), dOrigen(), () => "")).toHaveLength(1);
      });

      it("GATE_EN_ESA_SUCURSAL: CABLEADO con permisoYAlcanceEnSucursal(ctx, <el id>, <clave>) pasa; con la clave o el id equivocados, o PENDIENTE con el ensanche puesto, falla", () => {
        const accion = (llamada: string) => `"use server";\nexport async function agregar(input: { sucursalId: string }) {\n  return conPermiso("gestion_usuarios", async (ctx) => {\n    ${llamada}\n    return ok();\n  });\n}\n`;
        const d = (ensanche: "CABLEADO" | "PENDIENTE") => ({ "x.ts|agregar": { ata: "GATE_EN_ESA_SUCURSAL", clave: "gestion_usuarios", ensanche, motivo: "x" } satisfies Declaracion });
        const bien = accion('const g = await permisoYAlcanceEnSucursal(ctx, comando.valor.sucursalId, "gestion_usuarios");');
        expect(problemasDe(puertasDe("x.ts", bien, new Map()), d("CABLEADO"), () => "")).toEqual([]);
        expect(problemasDe(puertasDe("x.ts", bien.replace('"gestion_usuarios");', '"otra");'), new Map()), d("CABLEADO"), () => "")).not.toEqual([]);
        expect(problemasDe(puertasDe("x.ts", bien.replace("comando.valor.sucursalId", "ctx.sucursalId"), new Map()), d("CABLEADO"), () => "")).not.toEqual([]);
        expect(problemasDe(puertasDe("x.ts", bien, new Map()), d("PENDIENTE"), () => "")).not.toEqual([]);
        const aMano = accion('const gate = await requierePermiso(ctx.usuarioId, comando.valor.sucursalId, "gestion_usuarios", ctx.db);');
        expect(problemasDe(puertasDe("x.ts", aMano, new Map()), d("PENDIENTE"), () => "")).toEqual([]);
        expect(problemasDe(puertasDe("x.ts", aMano, new Map()), d("CABLEADO"), () => "")).not.toEqual([]);
      });

      it("la otra dirección: un ensanche en un archivo que ninguna declaración CABLEADO ata (o con la declaración PENDIENTE) falla; con la declaración CABLEADO, pasa", () => {
        const evidencia = "src/server/actions/carta/casos-de-uso/copiar-carta-de-sucursal.ts";
        const fuentes = new Map([[evidencia, `export async function f(ctx) { ${LEE} ${ENSANCHA} }`]]);
        const declaracion = (ensanche: "CABLEADO" | "PENDIENTE") => ({ "carta/copiar-carta.ts|copiarCartaDeSucursal": { ata: "MEMBRESIA_EN_ORIGEN", clave: "carta_ver", ensanche, evidencia, motivo: "x" } satisfies Declaracion });
        expect(ensanchesSinDeclarar(fuentes, declaracion("CABLEADO"))).toEqual([]);
        expect(ensanchesSinDeclarar(fuentes, declaracion("PENDIENTE"))).toHaveLength(1);
        expect(ensanchesSinDeclarar(fuentes, {})).toHaveLength(1);
        // la infraestructura (alcance.ts, con-sesion.ts, con-permiso.ts) está fuera de esta dirección: la verifica ensanches-de-alcance.test.ts
        expect(ensanchesSinDeclarar(new Map([["src/server/actions/con-sesion.ts", "export async function f(ctx) { conAlcanceEnSucursal(ctx, s, 'LECTURA'); }"]]), {})).toEqual([]);
      });
    });

    it("MEMBRESIA_EN_ORIGEN con otra clave que la declarada falla", () => {
      const otra = puertasDeFuente('return conPermiso("a", async (ctx) => { await leerOrigenDeCopia(ctx, sucursalOrigenId, "otra_clave"); return ok(); });');
      expect(problemasDe(otra, declarar({ ata: "MEMBRESIA_EN_ORIGEN", clave: "carta_ver", ensanche: "PENDIENTE", motivo: "x" }), () => "")).toHaveLength(1);
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

    describe("ids que llegan DENTRO de un objeto (M-8 de la auditoría intermedia)", () => {
      const ACCION_CON = (firma: string) => `"use server";\nexport async function copiarX(${firma}) {\n  return conPermiso("a", async (ctx) => ok());\n}\n`;
      const claves = (firma: string, indice: IndiceDeTipos = new Map()) => puertasDe("x.ts", ACCION_CON(firma), indice).map((p) => `${p.clave}:${p.parametros.join(",")}`);

      it("un tipo en línea, un objeto desestructurado y un tipo nombrado de la misma fuente o de otra, todos con su id", () => {
        expect(claves("input: { sucursalOrigenId: string; otro: string }")).toEqual(["x.ts|copiarX:input.sucursalOrigenId"]);
        expect(claves("{ origenSucursalId, otro }: { origenSucursalId: string; otro: string }")).toEqual(["x.ts|copiarX:origenSucursalId"]);
        const indice = indiceDeTipos([
          "export interface DatosDeCopia { destinoSucursalId: string; productoId: string }",
          "export const EsquemaA = z.object({ sucursalId: z.string(), nombre: z.string() });\nexport type DatosA = z.infer<typeof EsquemaA>;",
          'export type Alias = { traspasoSucursalId: string } & { x: 1 };',
        ]);
        expect(claves("d: DatosDeCopia", indice)).toEqual(["x.ts|copiarX:d.destinoSucursalId"]);
        expect(claves("d: DatosA", indice)).toEqual(["x.ts|copiarX:d.sucursalId"]);
        expect(claves("d: Alias", indice)).toEqual(["x.ts|copiarX:d.traspasoSucursalId"]);
      });

      it("un objeto sin id de sucursal, o un tipo que no se conoce, no es una puerta (no se inventa)", () => {
        expect(claves("d: { productoId: string; cantidad: number }")).toEqual([]);
        expect(claves("d: TipoQueNoSeResuelve")).toEqual([]);
      });

      it("GATE_EN_ESA_SUCURSAL exige pedir la clave EN ese id; sin el gate extra (la mutación de agregarOActualizarUsuario) falla", () => {
        const con = `"use server";\nexport async function agregar(input: { sucursalId: string }) {\n  return conPermiso("gestion_usuarios", async (ctx) => {\n    const gate = await requierePermiso(ctx.usuarioId, comando.valor.sucursalId, "gestion_usuarios", ctx.db);\n    return ok();\n  });\n}\n`;
        const sin = con.replace(/const gate = await requierePermiso\([^;]*;/, "");
        const d = { "x.ts|agregar": { ata: "GATE_EN_ESA_SUCURSAL", clave: "gestion_usuarios", ensanche: "PENDIENTE", motivo: "x" } satisfies Declaracion };
        expect(problemasDe(puertasDe("x.ts", con, new Map()), d, () => "")).toEqual([]);
        expect(problemasDe(puertasDe("x.ts", sin, new Map()), d, () => "")).toHaveLength(1);
        expect(problemasDe(puertasDe("x.ts", con.replace('"gestion_usuarios", ctx.db', '"otra", ctx.db'), new Map()), d, () => "")).toHaveLength(1);
        // pedir la clave en la sucursal ACTIVA no ata el id que llegó (la mutación real de usuarios.ts)
        expect(problemasDe(puertasDe("x.ts", con.replace("comando.valor.sucursalId", "ctx.sucursalId"), new Map()), d, () => "")).toHaveLength(1);
      });

      it("CONTRAPARTE_DE_TRASPASO exige la clave en el conPermiso y que el caso de uso rechace la misma sucursal y tome la sección de la activa", () => {
        const accion = `"use server";\nexport async function pedir(datos: { origenSucursalId: string }) {\n  return conPermiso("traspaso_solicitar", async (ctx) => ok());\n}\n`;
        const d = { "x.ts|pedir": { ata: "CONTRAPARTE_DE_TRASPASO", clave: "traspaso_solicitar", evidencia: "caso.ts", motivo: "x" } satisfies Declaracion };
        const bueno = "if (comando.origenSucursalId === actor.sucursalId) return fracaso();\nconst s = await obtenerSeccionPropia(comando.seccionId, actor.sucursalId, tx);";
        expect(problemasDe(puertasDe("x.ts", accion, new Map()), d, () => bueno)).toEqual([]);
        expect(problemasDe(puertasDe("x.ts", accion, new Map()), d, () => bueno.replace("=== actor.sucursalId", "=== otra"))).toHaveLength(1);
        expect(problemasDe(puertasDe("x.ts", accion.replace("traspaso_solicitar", "otra"), new Map()), d, () => bueno)).toHaveLength(1);
      });
    });

    it("un archivo sin \"use server\" no tiene puertas", () => {
      expect(puertasDe("x.ts", "export async function accion(sucursalId: string) { return 1; }")).toEqual([]);
    });
  });
});
