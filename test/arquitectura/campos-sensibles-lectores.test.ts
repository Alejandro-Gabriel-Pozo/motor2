import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCIONES, nivelMinimoDeAccion, type AccionClave, type NivelDeAccion } from "../../src/core/permisos/acciones";
import { nivelAlcanzaElPiso } from "../../src/core/permisos/jerarquia";
import { CAMPOS, hallarLectores } from "./guardas/campos-sensibles";
import { inventariarFuente } from "./guardas/inventario";
import { esPagina, exportadasQueAlcanzan, lectoresEnFuente, paginasQueAlcanzan } from "./guardas/lectores-de-campos";

/**
 * GT-1 COMPLETO (tanda T14 del plan de endurecimiento de seguridad; fila O.85b de `docs/pureza-integracion.md`): CAMPOS SENSIBLES CON PISO MÍNIMO, recorriendo cada lectura hasta
 * las páginas que la muestran. Completa a `campos-sensibles-con-su-clave.test.ts` (que fija los datos que salen por una OPCIÓN que la consulta niega por defecto): este mira a TODO
 * el que pida a Prisma uno de los campos de la lista, no solo a los que ya tienen su opción.
 *
 * Lo que fija (lista cerrada, en las dos direcciones; una lectura nueva de un campo sensible falla hasta que alguien la declare con su clase y su motivo):
 *  1. `CAMPOS`: cada campo sensible con el PISO que merece (`administrador`, `administrador_sistema`, o `NUNCA`: un secreto que no sale a ninguna persona). Existen en el schema, y toda
 *     columna del schema que parece un secreto (`token`, `secret…`, `hash…`) está en la lista o en `NO_SON_SECRETOS` con su motivo.
 *  2. `LECTORES`: los archivos que PIDEN esos campos a Prisma (un `select`/`include` anidado por las relaciones del schema, un agregado, un `groupBy`, SQL crudo; ver
 *     `guardas/lectores-de-campos.ts`), con los campos que piden y su clase:
 *       - `PAGINAS`: lo que pide llega a una pantalla. Por el grafo de imports (la capa de acceso a datos hacia arriba, con los nombres que importa cada página) se calculan las páginas
 *         que lo muestran, y cada una tiene que pedir al menos UNA clave del catálogo cuyo piso alcance el del campo. Una Server Action ("use server") es además una puerta HTTP:
 *         su propio archivo pide una clave de ese piso. Lo que no cumple va a `EXCEPCIONES_DE_PAGINA` con su motivo y su destino; la lista solo se achica (una excepción que ya
 *         no hace falta falla).
 *       - `INTERNO`: no devuelve el dato a una pantalla (escribe, anula, audita, o es un script del dueño): su motivo está escrito.
 *       - `SECRETO`: lee un secreto (`NUNCA`); ninguna página lo alcanza y el archivo no está en la capa de pantallas ni de lectura.
 * Qué NO hace: no sigue el dato dentro de `core/` ni de los barriles (un recorrido total alcanza a las 84 páginas por cualquier barril); no ve una fila entera (lo vigila GT-3a:
 * `sin-filas-enteras.test.ts`); no ve una página que arma el dato de otra fuente que no sea Prisma.
 *
 * Mutaciones (cada una pone un caso en rojo): `precioTotal: true` en una consulta nueva; `costoUnitarioVenta` pedido desde una consulta que llega a una página de piso operario; cambiar la
 * clave de `reportes/compras` por una de piso operario; una excepción de más; `hashToken` en una lectura de la capa de pantallas.
 */
const RAIZ = join(__dirname, "../..");

/** Columnas del schema que se parecen a un secreto (por el nombre) y no lo son. */
const NO_SON_SECRETOS: Readonly<Record<string, string>> = {
  "Account.token_type": "El tipo del token (`Bearer`), no el token.",
  "Operacion.payloadHash": "Huella del pedido para la idempotencia: no abre nada.",
  "ConteoFisico.payloadHash": "Huella del pedido para la idempotencia: no abre nada.",
  "PagoConsignante.payloadHash": "Huella del pedido para la idempotencia: no abre nada.",
};

type Clase = "PAGINAS" | "INTERNO" | "SECRETO";
interface Lector {
  campos: readonly string[];
  clase: Clase;
  /** Obligatorio en INTERNO y SECRETO. */
  motivo?: string;
}

const P = (...campos: string[]): Lector => ({ campos, clase: "PAGINAS" });
const I = (motivo: string, ...campos: string[]): Lector => ({ campos, clase: "INTERNO", motivo });
const S = (motivo: string, ...campos: string[]): Lector => ({ campos, clase: "SECRETO", motivo });

const CASO_DE_USO_DE_ESCRITURA = "Caso de uso de escritura: lee el correo para auditar o avisar y devuelve un ResultadoAccion; el correo no sale a la pantalla.";

/** `archivo` → los campos sensibles que pide, y su clase. Lista CERRADA: un lector nuevo, o un campo nuevo en uno viejo, falla hasta que se declara. */
const LECTORES: Readonly<Record<string, Lector>> = {
  "src/server/actions/auth/casos-de-uso/actualizar-activo-membresia.ts": I(CASO_DE_USO_DE_ESCRITURA, "User.email"),
  "src/server/actions/auth/casos-de-uso/actualizar-notas-membresia.ts": I(CASO_DE_USO_DE_ESCRITURA, "User.email"),
  "src/server/actions/auth/casos-de-uso/invitar-a-vincular.ts": I(CASO_DE_USO_DE_ESCRITURA, "User.email"),
  "src/server/actions/auth/casos-de-uso/transferir-gerencia-en-tx.ts": I(CASO_DE_USO_DE_ESCRITURA, "User.email"),
  "src/server/actions/auth/casos-de-uso/transferir-gerencia.ts": I(CASO_DE_USO_DE_ESCRITURA, "User.email"),
  "src/server/actions/auth/usuarios.ts": P("User.email"),
  "src/server/actions/catalogo/proveedores.ts": P("Proveedor.contacto"),
  "src/server/actions/traspasos/lecturas.ts": P("User.email"),
  "src/server/consultas/catalogo/productos.ts": P("Producto.proveedorConsignacion"),
  "src/server/consultas/catalogo/proveedores.ts": P("Proveedor.contacto", "Proveedor.telefono", "Proveedor.email", "Proveedor.cuit", "Proveedor.condicionesPago", "Proveedor.notas"),
  "src/server/consultas/permisos/auditoria.ts": P("User.email"),
  "src/server/consultas/permisos/gerencia.ts": P("User.email"),
  "src/server/consultas/pos/detalle-de-mesa.ts": P("User.email"),
  "src/server/consultas/pos/mesas.ts": P("User.email"),
  "src/server/consultas/pos/tickets.ts": P("User.email"),
  "src/server/consultas/reportes/compras-registradas.ts": P("Operacion.proveedor", "User.email"),
  "src/server/consultas/reportes/consignacion.ts": P("MovimientoStock.precioTotal", "Producto.proveedorConsignacion", "Producto.proveedorConsignacionId", "PagoConsignante.importe"),
  "src/server/consultas/reportes/costo-historico.ts": P("MovimientoStock.precioPorUnidadStock"),
  "src/server/consultas/reportes/descuentos-clientes.ts": P("MovimientoStock.precioTotal", "MovimientoStock.precioListaUnitario", "MovimientoStock.costoUnitarioVenta"),
  "src/server/consultas/reportes/devoluciones.ts": P("Operacion.proveedor"),
  "src/server/consultas/reportes/historial-producto.ts": P("MovimientoStock.precioTotal", "MovimientoStock.precioPorUnidadStock", "Operacion.nroFactura"),
  "src/server/consultas/reportes/margen-promociones.ts": P("MovimientoStock.precioTotal", "MovimientoStock.costoUnitarioVenta"),
  "src/server/consultas/reportes/periodo-precios.ts": P("MovimientoStock.precioTotal"),
  "src/server/consultas/reportes/periodo-ratio.ts": P("MovimientoStock.precioTotal"),
  "src/server/consultas/reportes/periodo.ts": P("MovimientoStock.precioTotal", "MovimientoStock.precioPorUnidadStock", "MovimientoStock.costoUnitarioVenta", "Operacion.nroFactura", "Operacion.proveedor", "Operacion.proveedorId"),
  "src/server/consultas/reportes/tickets-emitidos.ts": P("User.email"),
  "src/server/consultas/stock/sugerencia-clase-a.ts": P("MovimientoStock.precioTotal"),
  "src/server/lecturas/catalogo/ofertas-de-proveedor.ts": P("MovimientoStock.precioPorUnidadStock", "Operacion.proveedorId"),
  "src/server/lecturas/permisos/gerencia.ts": I("Lectura interna del caso de uso de la gerencia (quién la tiene hoy): no llega a ninguna pantalla.", "User.email"),
  "src/server/lecturas/reportes/comun.ts": P("MovimientoStock.precioPorUnidadStock", "Producto.proveedorConsignacion"),
  "src/server/persistencia/compras/cargar-compra-para-anular.ts": I("Carga la compra que `anularCompra` revierte (el nombre del proveedor para el mensaje): la acción devuelve un ResultadoAccion.", "Operacion.proveedor"),
  "src/server/persistencia/compras/cargar-compra-para-corregir.ts": I("Carga la compra que `corregirCompra` rehace (el proveedor, para repetirlo): la acción devuelve un ResultadoAccion.", "Operacion.proveedor"),
  "src/server/persistencia/movimientos/cargar-venta-para-anular.ts": I("Carga lo que `anularVenta` necesita (el consignante de lo vendido, para el rechazo D7): la acción devuelve un ResultadoAccion.", "Producto.proveedorConsignacionId"),
  "src/server/sesion/acceso.ts": I("El gate de login compara el correo de la cuenta con la membresía: lo resuelve el servidor y no lo devuelve.", "User.email"),
  "plataforma/src/servidor/ciclo-de-vida.ts": I("La consola busca la cuenta del gerente de una empresa por su correo; es la consola (otra app, rol de plataforma).", "User.email"),
  "plataforma/src/servidor/ingreso.ts": S("El ingreso a la consola verifica el código del mail y el segundo factor: lee el HMAC del código y el secreto TOTP cifrado para compararlos en el servidor y no los devuelve.", "CodigoDeIngresoPlataforma.hashCodigo", "AdminPlataforma.secretoTotp"),
  "scripts/benchmark-reportes.ts": I("Script de medición del dueño (benchmark de reportes): no es una pantalla.", "MovimientoStock.precioPorUnidadStock"),
  "scripts/lecturas-de-auth.ts": S("Script del dueño (`detectar-cuentas-vinculadas`), solo lectura, corre con tsx: compara el id_token de Google con el correo de la cuenta; no es parte de la app web.", "User.email", "Account.id_token"),
  "scripts/verificar-demo-invariantes.ts": I("Script del dueño que verifica la base demo: no es una pantalla.", "MovimientoStock.precioTotal", "MovimientoStock.precioPorUnidadStock", "Operacion.proveedorId"),
};

/**
 * `pagina|campo` que no cumple el piso del campo, con su motivo y su destino. Solo se achica. (Una página no tiene que pedir el piso de TODO lo que su pantalla dibuja si el dato llega por
 * otra opción que ya lo niega por defecto: ver `campos-sensibles-con-su-clave.test.ts`.)
 */
const D_B =
  "Decisión D-B del dueño (2026-10-07, S-42): el último precio de compra de la empresa a un proveedor lo ve quien compra (`proceso_compra`, piso operario) para precargar el carrito; la página elige la clave del proceso en tiempo de ejecución (`ACCION_POR_PROCESO`), así que no se puede comparar con el piso. Destino: se deja (decidido).";
const SALUD =
  "«Salud por producto» (`reporte_salud`, piso operario) cruza cuatro reportes y arma el catálogo en memoria con los costos (`construirMapaProductos`) para clasificar y costear por dentro, pero NO devuelve ningún importe: su fila (`FilaSaludProducto`) son estados y nombres, sin un solo campo de dinero (`core/reportes/salud-por-producto.ts`). Falso positivo del recorrido por archivos; se queda mientras la fila no tenga dinero. Destino: se deja (el tipo de la fila lo fija).";
const EMAIL_DEL_QUE_OPERO =(que: string, destino: string) =>
  `${que} muestra el correo de quien operó (User.email, piso «administrador de sistema» en la lista de campos) en una pantalla de un piso menor. Hallazgo nuevo de GT-1 (T14), NO arreglado en esta tanda: cambia una etiqueta visible y no abre nada entre empresas ni entre sucursales. Destino: ${destino}.`;
const S_44 = (pantalla: string) =>
  EMAIL_DEL_QUE_OPERO(`${pantalla} (POS)`, "S-44 del plan de endurecimiento (parte local del correo de los compañeros en el POS), rama «endurecimiento 2»");
const TRASPASOS = (pantalla: string) => EMAIL_DEL_QUE_OPERO(`La bandeja de ${pantalla} (el creador del traspaso)`, "B26 de la auditoría intermedia, rama «endurecimiento 2»");

const EXCEPCIONES_DE_PAGINA: Readonly<Record<string, string>> = {
  "src/app/(app)/movimientos/[proceso]/page.tsx|MovimientoStock.precioPorUnidadStock": D_B,
  "src/app/(app)/movimientos/[proceso]/page.tsx|Operacion.proveedorId": D_B,
  "src/app/(app)/reportes/compras/page.tsx|User.email": EMAIL_DEL_QUE_OPERO("«Compras registradas» (`reporte_compras`, administrador): quién anuló una compra,", "rama «endurecimiento 2» (mostrar el nombre y no el correo)"),
  "src/app/(app)/reportes/salud/page.tsx|MovimientoStock.precioPorUnidadStock": SALUD,
  "src/app/(app)/reportes/salud/page.tsx|Producto.proveedorConsignacion": SALUD,
  "src/app/(app)/reportes/tickets/page.tsx|User.email":EMAIL_DEL_QUE_OPERO("«Tickets emitidos» (`reporte_tickets`, administrador): quién emitió el ticket,", "rama «endurecimiento 2» (mostrar el nombre y no el correo)"),
  "src/app/(app)/traspasos/enviar/page.tsx|User.email": TRASPASOS("«Enviar directo»"),
  "src/app/(app)/traspasos/page.tsx|User.email": TRASPASOS("«Traspasos»"),
  "src/app/(app)/traspasos/solicitar/page.tsx|User.email": TRASPASOS("«Solicitar»"),
  "src/server/actions/traspasos/lecturas.ts|User.email": TRASPASOS("la Server Action `obtenerBandejaTransferencias` (`traspaso_ver_bandeja`, operario)"),
  "src/app/(pos)/mesas/[mesaId]/page.tsx|User.email": S_44("La mesa"),
  "src/app/(pos)/mesas/page.tsx|User.email": S_44("El mapa de mesas"),
};

const { modelos, hallados } = hallarLectores(RAIZ);

const clavesDe = (ruta: string): { claves: Set<string>; dinamicas: number } => {
  const inv = inventariarFuente(ruta, readFileSync(join(RAIZ, ruta), "utf8"));
  return { claves: new Set([...inv.usos, ...inv.valoresDeMapa].map((u) => u.clave)), dinamicas: inv.dinamicos.length };
};

/** ¿Alguna de las claves alcanza el piso? Una clave que no está en el catálogo no cuenta. */
const algunaAlcanza = (claves: ReadonlySet<string>, piso: NivelDeAccion): boolean => {
  const catalogo = new Set<string>(ACCIONES.map((a) => a.clave));
  return [...claves].some((c) => catalogo.has(c) && nivelAlcanzaElPiso(nivelMinimoDeAccion(c as AccionClave), piso));
};

/** El piso de un campo; `NUNCA` se trata como el más alto (ninguna clave lo alcanza, salvo `gerente`) y además lo prohíbe otro test. */
function pisoDelCampo(c: string): NivelDeAccion {
  const p = CAMPOS[c]!.piso;
  return p === "NUNCA" ? "gerente" : p;
}

/** Los incumplimientos de las clases PAGINAS: `pagina|campo` (o `archivo|campo` para la puerta HTTP de una Server Action). */
function incumplimientos(): string[] {
  const salida: string[] = [];
  for (const h of hallados) {
    const lector = LECTORES[h.ruta];
    if (lector?.clase !== "PAGINAS") continue;
    for (const campo of h.campos) {
      const piso = pisoDelCampo(campo);
      if (h.esAccionUseServer && !algunaAlcanza(clavesDe(h.ruta).claves, piso)) salida.push(`${h.ruta}|${campo}`);
      for (const pagina of h.paginas) {
        if (!algunaAlcanza(clavesDe(pagina).claves, piso)) salida.push(`${pagina}|${campo}`);
      }
    }
  }
  return [...new Set(salida)].sort();
}

describe("GT-1 completo — la lista de campos sensibles", () => {
  it("cada campo de la lista existe en el schema", () => {
    for (const clave of Object.keys(CAMPOS)) {
      const [modelo, campo] = clave.split(".") as [string, string];
      expect(modelos.get(modelo)?.has(campo), `${clave}: no existe en prisma/schema.prisma (¿se renombró o se borró? sacalo de CAMPOS)`).toBe(true);
    }
  });

  it("toda columna del schema que parece un secreto está en la lista o en NO_SON_SECRETOS, con su motivo", () => {
    const sospechosas: string[] = [];
    for (const [modelo, campos] of modelos) {
      for (const [campo, forma] of campos) {
        if (!forma.esModelo && /token|secret|secreto|hash|password/i.test(campo)) sospechosas.push(`${modelo}.${campo}`);
      }
    }
    expect(sospechosas.length, "sanidad: el detector ve las columnas de secretos del schema").toBeGreaterThan(8);
    const sinDeclarar = sospechosas.filter((c) => !(c in CAMPOS) && !(c in NO_SON_SECRETOS));
    expect(sinDeclarar, "una columna con aspecto de secreto se agrega a CAMPOS (piso NUNCA) o a NO_SON_SECRETOS con su motivo").toEqual([]);
    for (const [c, motivo] of Object.entries(NO_SON_SECRETOS)) {
      expect(sospechosas, `${c}: ya no existe o ya no parece un secreto; sacala de NO_SON_SECRETOS`).toContain(c);
      expect(motivo.length, c).toBeGreaterThan(15);
    }
  });

  it("cada campo declarado tiene un piso que existe", () => {
    for (const [c, { piso, dato }] of Object.entries(CAMPOS)) {
      expect(["operario", "administrador", "administrador_sistema", "gerente", "NUNCA"], c).toContain(piso);
      expect(dato.length, c).toBeGreaterThan(10);
    }
  });
});

describe("GT-1 completo — los lectores de esos campos", () => {
  it("el detector ve cada forma de pedir un campo, sabiendo de qué MODELO es (casos sintéticos)", () => {
    const sens = new Map([
      ["Proveedor", new Set(["email"])],
      ["User", new Set(["email"])],
      ["MovimientoStock", new Set(["precioTotal"])],
    ]);
    const campos = (c: string) => lectoresEnFuente(c, "x.ts", modelos, sens).map((h) => `${h.campo}/${h.via}`).sort();
    expect(campos("async function f(db) { return db.proveedor.findMany({ select: { email: true } }); }")).toEqual(["Proveedor.email/select"]);
    // el mismo nombre en otro modelo es OTRO dato
    expect(campos("async function f(db) { return db.user.findMany({ select: { email: true } }); }")).toEqual(["User.email/select"]);
    expect(campos("async function f(db) { return db.sucursal.findMany({ select: { email: true } }); }")).toEqual([]);
    // anidado por las relaciones del schema: `creadoPor` es un `User`
    expect(campos("async function f(db) { return db.traspasoSucursal.findMany({ select: { creadoPor: { select: { email: true } } } }); }")).toEqual(["User.email/select"]);
    expect(campos("async function f(db) { return db.operacion.findMany({ include: { proveedor: { select: { email: true } } } }); }")).toEqual(["Proveedor.email/select"]);
    // una constante que el `select` toma por nombre
    expect(campos("const SELECT_X = { email: true };\nasync function f(db) { return db.user.findMany({ select: SELECT_X }); }")).toEqual(["User.email/select"]);
    // un `where` no devuelve el dato; `false` tampoco; la forma abreviada sí
    expect(campos("async function f(db) { return db.user.findMany({ where: { email: 'a' } }); }")).toEqual([]);
    expect(campos("async function f(db) { return db.user.findMany({ select: { email: false } }); }")).toEqual([]);
    expect(campos("async function f(db, email) { return db.user.findMany({ select: { email } }); }")).toEqual(["User.email/select"]);
    // agregados, `groupBy` y SQL crudo
    expect(campos("async function f(db) { return db.movimientoStock.aggregate({ _sum: { precioTotal: true } }); }")).toEqual(["MovimientoStock.precioTotal/agregado"]);
    expect(campos("async function f(db) { return db.movimientoStock.groupBy({ by: ['precioTotal'] }); }")).toEqual(["MovimientoStock.precioTotal/agregado"]);
    expect(campos('async function f(db) { return db.$queryRaw`SELECT "precioTotal" FROM "MovimientoStock"`; }')).toEqual(["MovimientoStock.precioTotal/sql"]);
    expect(campos('async function f(db) { return db.$queryRaw`SELECT "nombre" FROM "MovimientoStock"`; }')).toEqual([]);
    // en el SQL cuenta lo que se DEVUELVE (la lista del SELECT), no lo que filtra el WHERE; un `*` devuelve todo
    expect(campos('async function f(db) { return db.$queryRaw`SELECT DISTINCT m."productoId" FROM "MovimientoStock" m WHERE m."precioTotal" > 0`; }')).toEqual([]);
    expect(campos('async function f(db) { return db.$queryRaw`SELECT SUM(m."precioTotal") FROM "MovimientoStock" m`; }')).toEqual(["MovimientoStock.precioTotal/sql"]);
    expect(campos('async function f(db) { return db.$queryRaw`SELECT m.* FROM "MovimientoStock" m`; }')).toEqual(["MovimientoStock.precioTotal/sql"]);
    expect(campos('async function f(db) { return db.$queryRaw`SELECT COUNT(*) FROM "MovimientoStock"`; }')).toEqual([]);
    // un comentario o un texto no cuentan
    expect(campos("// db.user.findMany({ select: { email: true } })\nconst s = 'db.user.findMany({ select: { email: true } })';")).toEqual([]);
  });

  it("el grafo: un primer salto solo cuenta a quien importa una función que llega al campo (la ficha del proveedor y su selector viven en el mismo archivo)", () => {
    const a = "src/server/consultas/x.ts";
    const imp = new Map([[a, [{ desde: "src/app/(app)/uno/page.tsx", nombres: ["lee"] }, { desde: "src/app/(app)/dos/page.tsx", nombres: ["otra"] }, { desde: "src/app/(app)/tres/page.tsx", nombres: null }]]]);
    expect(paginasQueAlcanzan(a, imp, ["lee"])).toEqual(["src/app/(app)/tres/page.tsx", "src/app/(app)/uno/page.tsx"]);
    expect(paginasQueAlcanzan(a, imp, null)).toHaveLength(3);
    const codigo = "export async function lee() { return ayuda(); }\nasync function ayuda() { return 1; }\nexport async function otra() { return 2; }\nexport async function usaAyuda() { return ayuda(); }";
    expect(exportadasQueAlcanzan(codigo, ["ayuda"])).toEqual(["lee", "usaAyuda"]);
    expect(exportadasQueAlcanzan(codigo, ["noExiste"])).toBeNull();
    expect(esPagina("src/app/(app)/x/page.tsx")).toBe(true);
    expect(esPagina("src/app/api/cron/x/route.ts")).toBe(true);
    expect(esPagina("src/app/(app)/x/form.tsx")).toBe(false);
  });

  it("I-2: una lectura dentro de una acción exportada como CONSTANTE con envoltorio o `as` se atribuye a la constante y la exportada se ve", () => {
    const sens = new Map([["User", new Set(["email"])]]);
    const envuelta = "export const verCorreo = conRegistro(async (db) => { return db.user.findMany({ select: { email: true } }); });";
    expect(lectoresEnFuente(envuelta, "x.ts", modelos, sens)).toEqual([expect.objectContaining({ campo: "User.email", funcion: "verCorreo" })]);
    expect(exportadasQueAlcanzan(envuelta, ["verCorreo"])).toEqual(["verCorreo"]);
    const conAs = "export const verCorreo = (async (db) => db.user.findMany({ select: { email: true } })) as Accion;";
    expect(exportadasQueAlcanzan(conAs, ["verCorreo"])).toEqual(["verCorreo"]);
  });

  it("sanidad: el recorrido encuentra lectores y páginas (no pasa en vacío)", () => {
    expect(hallados.length).toBeGreaterThan(25);
    expect(hallados.some((h) => h.paginas.length > 0)).toBe(true);
    expect(modelos.get("Proveedor")?.get("cuit")).toEqual({ tipo: "String", lista: false, esModelo: false });
    expect(modelos.get("Operacion")?.get("proveedor")?.esModelo).toBe(true);
  });

  it("los archivos que piden un campo sensible, y los campos que piden, son exactamente los de LECTORES", () => {
    const reales = Object.fromEntries(hallados.map((h) => [h.ruta, h.campos]));
    const declarados = Object.fromEntries(Object.entries(LECTORES).map(([r, l]) => [r, [...l.campos].sort()]));
    expect(reales, "un lector nuevo (o un campo nuevo en uno viejo) se declara en LECTORES con su clase; uno que ya no pide el campo sale de la lista").toEqual(declarados);
  });

  it("cada lector declara campos que están en la lista, y los INTERNO y SECRETO tienen su motivo", () => {
    for (const [ruta, l] of Object.entries(LECTORES)) {
      for (const c of l.campos) expect(c in CAMPOS, `${ruta}: «${c}» no está en CAMPOS`).toBe(true);
      if (l.clase !== "PAGINAS") expect((l.motivo ?? "").length, `${ruta}: falta el motivo`).toBeGreaterThan(30);
    }
  });

  it("los SECRETO leen solo secretos o van por una vía que no es una pantalla; ninguna página los alcanza y no viven en la capa de pantallas ni de lectura", () => {
    for (const h of hallados) {
      const l = LECTORES[h.ruta];
      if (l?.clase !== "SECRETO") continue;
      expect(h.paginas, `${h.ruta} lee un secreto y lo alcanza una página`).toEqual([]);
      expect(h.ruta, `${h.ruta}: un secreto no se lee en la capa de pantallas`).not.toMatch(/^src\/(app|components|server\/(consultas|lecturas))\//);
      expect(h.campos.some((c) => CAMPOS[c]!.piso === "NUNCA"), `${h.ruta} está marcado SECRETO y no pide ningún campo NUNCA`).toBe(true);
    }
  });

  it("los campos de piso NUNCA solo los piden archivos SECRETO o INTERNO (nunca los de PAGINAS)", () => {
    for (const h of hallados) {
      if (LECTORES[h.ruta]?.clase !== "PAGINAS") continue;
      for (const c of h.campos) expect(CAMPOS[c]!.piso, `${h.ruta} muestra «${c}», que no sale a nadie`).not.toBe("NUNCA");
    }
  });

  it("los INTERNO no están en la capa de pantallas ni los alcanza ninguna página por el mismo archivo (un lector que llega a una pantalla es PAGINAS)", () => {
    for (const h of hallados) {
      if (LECTORES[h.ruta]?.clase !== "INTERNO") continue;
      expect(h.ruta, `${h.ruta}: un componente o una página no es INTERNO`).not.toMatch(/^src\/(app|components)\//);
    }
  });

  it("cada página que muestra un campo sensible pide una clave de piso suficiente, salvo las EXCEPCIONES_DE_PAGINA (y la lista no tiene sobrantes)", () => {
    const reales = incumplimientos();
    expect(
      reales,
      "una página (o una Server Action de lectura) que muestra un campo sensible pide una clave cuyo piso lo alcance; si no, va a EXCEPCIONES_DE_PAGINA con su motivo y su destino",
    ).toEqual(Object.keys(EXCEPCIONES_DE_PAGINA).sort());
    for (const [k, motivo] of Object.entries(EXCEPCIONES_DE_PAGINA)) expect(motivo.length, k).toBeGreaterThan(40);
  });

  it("una página con la clave dinámica y ninguna literal no se puede comparar con el piso: cae en las excepciones (falla cerrado), no pasa", () => {
    const sinClaves = [...new Set(hallados.filter((h) => LECTORES[h.ruta]?.clase === "PAGINAS").flatMap((h) => h.paginas))].filter((p) => clavesDe(p).claves.size === 0);
    for (const p of sinClaves) expect(Object.keys(EXCEPCIONES_DE_PAGINA).some((k) => k.startsWith(`${p}|`)), `${p}: sin claves literales y sin excepción`).toBe(true);
  });
});
