import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ESTADOS_DE_RECEPCION } from "@/core/compras/public";
import { moduloDelCatalogo } from "@/core/modulos/catalogo";
import { MODULO_CON_GUARDA_DE_APAGADO } from "@/core/modulos/guarda-de-apagado";
import { dimensionesDeLaGuarda, filasDeApagado, filasDeCarga, tablaDeLaGuarda } from "../setup/oraculo-compras-guarda-de-apagado";

/**
 * GUARDIÁN de dimensiones nuevas de la guarda de apagado de la recepción separada (regla «Combinaciones» del dueño, AGENTS.md). El oráculo `docs/oraculo-combinaciones-compras-guarda-de-apagado-2026-11-17.md` declara las dimensiones, qué mira la base
 * al decidir (cada entrada responde a una dimensión o «no afecta» con su motivo) y qué archivos escriben el registro de módulos. Falla si:
 *  (a) la migración mira una columna que el oráculo no declara, o el oráculo declara una que la migración ya no mira;
 *  (b) una entrada responde a una dimensión que el oráculo no define, o «no afecta» sin motivo;
 *  (c) aparece un archivo que escribe `ModuloEmpresa` (una vía nueva) sin declarar, o uno declarado ya no lo escribe;
 *  (d) los estados del registro (el enum de Prisma), los de recepción (el código y el CHECK de la base) o el módulo con guarda dejan de ser los valores que el oráculo da por ciertos;
 *  (e) las tablas del oráculo no son el producto cartesiano de sus dimensiones (ya lo recorre el test de integración, acá se vigila que el lector las vea).
 */
const RAIZ = join(__dirname, "../..");
const MIGRACION = readFileSync(join(RAIZ, "prisma/migrations/20261117125000_compras_guarda_de_apagado/migration.sql"), "utf8");
const DIMENSIONES = dimensionesDeLaGuarda();

/** Cada entrada de la regla y la columna (o el parámetro de la base) con la que la migración la lee. Agregar una columna a la migración sin declararla acá y en el oráculo da rojo. */
const COLUMNA_DE_LA_ENTRADA: Record<string, string> = { modulo: '"modulo"', estadoDelRegistro: '"estado"', estadoRecepcion: '"estadoRecepcion"', anuladaEn: '"anuladaEn"', empresaId: '"empresaId"', nivelDeAislamiento: "transaction_isolation" };
/** Columnas que la migración nombra pero NO deciden nada (con su motivo). */
const NO_DECIDEN: Record<string, string> = {
  '"id"': "la clave de la fila de ModuloEmpresa: solo se usa para tomar la fila antes de contar",
  '"facturaProveedorId"': "la unión de la parte con su cabecera (para leer anuladaEn)",
  '"sucursalId"': "la unión de la parte con su sucursal (para el nombre en el mensaje)",
  '"nombre"': "el nombre de la sucursal: solo va en el mensaje del rechazo, no cambia si se rechaza",
};

function cuerpoDeLaFuncion(nombre: string): string {
  const desde = MIGRACION.indexOf(`CREATE FUNCTION ${nombre}`);
  if (desde < 0) throw new Error(`La migración no define ${nombre}.`);
  return MIGRACION.slice(desde, MIGRACION.indexOf("$$;", MIGRACION.indexOf("AS $$", desde) + 5));
}

describe("guardián: la guarda de apagado declara todo lo que mira en el oráculo", () => {
  const declaradas = tablaDeLaGuarda("Entradas de la regla y su efecto").filas.map((f) => ({ entrada: (f["Entrada"] ?? "").trim(), efecto: (f["Efecto"] ?? "").trim() }));

  it("(a) lo que la migración lee al decidir un apagado es exactamente lo declarado (más lo que no decide, con motivo)", () => {
    const cuerpo = cuerpoDeLaFuncion("compras_pendientes_de_recepcion") + cuerpoDeLaFuncion("modulo_empresa_guarda_de_apagado_recepcion");
    // Todo identificador entre comillas de las dos funciones, menos los nombres de las cuatro tablas: lo que queda son columnas.
    const columnas = new Set([...cuerpo.matchAll(/"[A-Za-z]+"/g)].map((x) => x[0]));
    for (const tabla of ['"FacturaProveedorSucursal"', '"FacturaProveedor"', '"Sucursal"', '"ModuloEmpresa"']) columnas.delete(tabla);
    const permitidas = new Set([...Object.values(COLUMNA_DE_LA_ENTRADA).filter((c) => c.startsWith('"')), ...Object.keys(NO_DECIDEN)]);
    for (const c of columnas) expect(permitidas.has(c), `la migración lee la columna ${c} y el oráculo no la declara: declará la entrada (o su «no decide» con motivo)`).toBe(true);
    for (const c of Object.values(COLUMNA_DE_LA_ENTRADA).filter((x) => x.startsWith('"'))) expect(cuerpo.includes(c), `el oráculo declara ${c} y la migración ya no la lee`).toBe(true);
    expect(cuerpo.includes("transaction_isolation")).toBe(true);
    expect(declaradas.map((d) => d.entrada).sort()).toEqual(Object.keys(COLUMNA_DE_LA_ENTRADA).sort());
  });

  it("(b) cada entrada es una dimensión definida o «no afecta» con motivo", () => {
    for (const { entrada, efecto } of declaradas) {
      if (efecto.startsWith("no afecta")) expect(efecto.replace(/^no afecta:?\s*/, "").length, `${entrada}: «no afecta» sin motivo`).toBeGreaterThan(3);
      else expect(Object.keys(DIMENSIONES), `${entrada}: dimensión «${efecto}» no definida`).toContain(efecto);
    }
  });

  it("(c) los archivos que escriben ModuloEmpresa son exactamente los declarados como vías", () => {
    const declarados = tablaDeLaGuarda("Quién escribe el registro de módulos").filas.map((f) => (f["Archivo"] ?? "").trim()).sort();
    const escritores: string[] = [];
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        if (nombre === "node_modules" || nombre === ".next") continue;
        const ruta = join(dir, nombre);
        if (statSync(ruta).isDirectory()) recorrer(ruta);
        else if (/\.(ts|tsx|mjs|cjs|js)$/.test(nombre) && /moduloEmpresa\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b|(UPDATE|INSERT INTO|DELETE FROM)\s+"?ModuloEmpresa/i.test(readFileSync(ruta, "utf8"))) escritores.push(relative(RAIZ, ruta));
      }
    };
    for (const d of ["src", "plataforma/src", "scripts"]) recorrer(join(RAIZ, d));
    expect(escritores.sort()).toEqual(declarados);
    expect(DIMENSIONES["V"]).toEqual(["CONSOLA", "SCRIPT", "UPDATE_DIRECTO"]);
  });

  it("(d) los estados del registro, los de recepción y el módulo con guarda son lo que el oráculo da por cierto", () => {
    const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");
    const enumEstado = /enum EstadoModulo \{([^}]*)\}/.exec(schema)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
    expect(enumEstado.sort()).toEqual(["ACTIVO", "INACTIVO"]);
    expect(DIMENSIONES["A"]).toEqual(["DESACTIVAR", "ACTIVAR"]);
    expect([...ESTADOS_DE_RECEPCION].sort()).toEqual(["PENDIENTE", "RECIBIDA"]);
    expect(DIMENSIONES["P"]).toEqual(["CERO", "UNA_SIN_ANULAR", "SOLO_ANULADAS", "SOLO_RECIBIDAS"]);
    expect(DIMENSIONES["L"]).toEqual(["OTRA_SUCURSAL_DE_LA_EMPRESA", "OTRA_EMPRESA"]);
    // El disparador de ModuloEmpresa nombra UN solo módulo y es el del código; el catálogo lo conoce como vendible.
    const modulos = [...cuerpoDeLaFuncion("modulo_empresa_guarda_de_apagado_recepcion").matchAll(/"modulo" <> '(\w+)'/g)].map((x) => x[1]);
    expect(modulos).toEqual([MODULO_CON_GUARDA_DE_APAGADO]);
    expect(moduloDelCatalogo(MODULO_CON_GUARDA_DE_APAGADO)).toMatchObject({ tipo: "vendible" });
    const checkDeLaBase = /estado_recepcion_chk" CHECK \("estadoRecepcion" IN \(([^)]*)\)\)/.exec(readFileSync(join(RAIZ, "prisma/migrations/20261016101500_factura_proveedor_recepcion/migration.sql"), "utf8"));
    expect([...checkDeLaBase![1]!.matchAll(/'(\w+)'/g)].map((x) => x[1]).sort()).toEqual([...ESTADOS_DE_RECEPCION].sort());
  });

  it("(d) el rechazo deja su acción de auditoría declarada en la consola y en el script", () => {
    expect(readFileSync(join(RAIZ, "plataforma/src/servidor/auditoria.ts"), "utf8")).toContain('"modulo-desactivar-rechazado"');
    expect(readFileSync(join(RAIZ, "src/server/operaciones-de-plataforma/auditar-cambio-de-plataforma.ts"), "utf8")).toContain('"modulo-desactivar-rechazado"');
    expect(readFileSync(join(RAIZ, "plataforma/src/app/instalaciones/[instalacion]/empresas/textos.ts"), "utf8")).toContain('"modulo-desactivar-rechazado"');
  });

  it("(e) control de sanidad: el lector ve las dimensiones y las tablas completas", () => {
    expect(Object.keys(DIMENSIONES).sort()).toEqual(["A", "L", "P", "V"]);
    expect(declaradas).toHaveLength(6);
    expect(filasDeApagado()).toHaveLength(48);
    expect(filasDeCarga()).toHaveLength(6);
  });
});
