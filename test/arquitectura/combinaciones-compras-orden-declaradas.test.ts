import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ESTADOS_DE_ORDEN, MOTIVOS_DE_CIERRE, NIVELES_DE_CONTROL, decidirAnularOrden, decidirCerrarOrden, decidirExcesoContraLaOrden, decidirPedirOrden, decidirVinculoConOrden, validarDatosDeOrden } from "@/core/compras/public";
import { moduloDelCatalogo } from "@/core/modulos/catalogo";
import { ACCIONES } from "@/core/permisos/acciones";
import { nivelDe } from "@/core/permisos/jerarquia";
import { dimensionesDeOrden, tablaDeOrden } from "../setup/oraculo-compras-orden";

/**
 * GUARDIÁN de dimensiones nuevas de la orden de compra (regla «Combinaciones» del dueño, AGENTS.md). El oráculo `docs/oraculo-combinaciones-compras-orden-2026-11-17.md` declara las dimensiones y, para cada entrada de las reglas puras y cada
 * columna de las tablas de la orden, la dimensión a la que responde o «no afecta» con su motivo. Falla si:
 *  (a) una regla tiene una entrada que el oráculo no declara (los tipos de abajo obligan a sumarla acá: `tsc` se pone rojo), el oráculo declara una que ya no existe, una entrada «afecta» a una dimensión que el oráculo no define, o «no afecta» sin motivo;
 *  (b) una tabla de la orden tiene una columna que el oráculo no declara (o declara una que ya no existe);
 *  (c) los estados, los niveles y los motivos de cierre del código y del CHECK de la base no son los valores declarados;
 *  (d) los niveles de persona no son los de la dimensión O, o el módulo y las acciones dejaron de ser lo que el oráculo da por cierto.
 */
const DIMENSIONES = dimensionesDeOrden();
const RAIZ = join(__dirname, "../..");

/** Las entradas de cada regla pura como objeto: agregar una al tipo sin sumarla acá no compila. */
type Entrada<F extends (...args: never[]) => unknown> = Parameters<F>[0];
const ENTRADAS = {
  validarDatosDeOrden: { proveedorId: true, sucursalId: true, fechaDeEntregaPrevista: true, lineas: true, hoy: true } satisfies Record<keyof Entrada<typeof validarDatosDeOrden>, true>,
  decidirPedirOrden: { estado: true, lineasNoRetiradas: true, fechaDeEntregaPrevista: true, hoy: true } satisfies Record<keyof Entrada<typeof decidirPedirOrden>, true>,
  decidirAnularOrden: { estado: true, hayRecepcionesVigentes: true, motivo: true } satisfies Record<keyof Entrada<typeof decidirAnularOrden>, true>,
  decidirCerrarOrden: { estado: true, hayRecepcionesPendientes: true } satisfies Record<keyof Entrada<typeof decidirCerrarOrden>, true>,
  decidirVinculoConOrden: {
    estadoDeLaOrden: true,
    mismoProveedor: true,
    lineaRetirada: true,
    mismoProducto: true,
    nivel: true,
    confirmoExceso: true,
    recibidaHasta: true,
    cantidad: true,
    pedida: true,
  } satisfies Record<keyof Entrada<typeof decidirVinculoConOrden>, true>,
  decidirExcesoContraLaOrden: { nivel: true, confirmoExceso: true, recibidaHasta: true, cantidad: true, pedida: true, rechazadoPorElControl: true } satisfies Record<keyof Entrada<typeof decidirExcesoContraLaOrden>, true>,
};

const MODELOS = ["OrdenDeCompra", "LineaDeOrdenDeCompra", "SaldoDeLineaDeOrden", "VinculoDeRenglonConOrden", "NivelDeControl"] as const;

/** Las columnas escalares (no relaciones) de un modelo de Prisma. */
function columnasDelModelo(schema: string, modelo: string): string[] {
  const cuerpo = new RegExp(`^model ${modelo} \\{([\\s\\S]*?)^\\}`, "m").exec(schema)?.[1];
  if (!cuerpo) throw new Error(`El schema no tiene el modelo ${modelo}.`);
  const modelosConocidos = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]!));
  return cuerpo
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("//") && !l.startsWith("@@"))
    .map((l) => l.split(/\s+/))
    .filter(([nombre, tipo]) => nombre && tipo && !modelosConocidos.has(tipo.replace(/[?[\]]/g, "")))
    .map(([nombre]) => nombre!);
}

describe("guardián: la orden de compra declara todas sus dimensiones en el oráculo", () => {
  const declaradas = tablaDeOrden("Entradas de las reglas y su efecto").filas.map((f) => ({ regla: (f["Regla"] ?? "").trim(), entrada: (f["Entrada"] ?? "").trim(), efecto: (f["Efecto"] ?? "").trim() }));

  it("(a) cada entrada de cada regla está declarada (y ninguna declarada sobra)", () => {
    const reales = Object.entries(ENTRADAS).flatMap(([regla, entradas]) => Object.keys(entradas).map((e) => `${regla}.${e}`));
    expect(declaradas.map((d) => `${d.regla}.${d.entrada}`).sort()).toEqual(reales.sort());
  });

  it("(a) cada declaración es una dimensión definida o «no afecta» con motivo", () => {
    for (const { regla, entrada, efecto } of declaradas) {
      if (efecto.startsWith("no afecta")) expect(efecto.replace(/^no afecta:?\s*/, "").length, `${regla}.${entrada}: «no afecta» sin motivo`).toBeGreaterThan(3);
      else expect(Object.keys(DIMENSIONES), `${regla}.${entrada}: dimensión «${efecto}» no definida`).toContain(efecto);
    }
  });

  it("(b) cada columna de las tablas de la orden está declarada (y ninguna declarada sobra), con una dimensión definida o «no afecta» con motivo", () => {
    const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");
    const reales = MODELOS.flatMap((m) => columnasDelModelo(schema, m).map((c) => `${m}.${c}`));
    const tabla = tablaDeOrden("Columnas de las tablas de la orden y su efecto").filas.map((f) => ({ columna: (f["Columna"] ?? "").trim(), efecto: (f["Efecto"] ?? "").trim() }));
    expect(tabla.map((t) => t.columna).sort()).toEqual(reales.sort());
    for (const { columna, efecto } of tabla) {
      if (efecto.startsWith("no afecta")) expect(efecto.replace(/^no afecta:?\s*/, "").length, `${columna}: «no afecta» sin motivo`).toBeGreaterThan(3);
      else expect(Object.keys(DIMENSIONES), `${columna}: dimensión «${efecto}» no definida`).toContain(efecto);
    }
  });

  it("(c) los estados, los niveles y los motivos de cierre del código y de los CHECK de la base son los declarados", () => {
    expect([...ESTADOS_DE_ORDEN].sort()).toEqual([...(DIMENSIONES["E"] ?? [])].sort());
    expect([...NIVELES_DE_CONTROL].sort()).toEqual((DIMENSIONES["N"] ?? []).filter((v) => v !== "SIN_FILA").sort());
    const migracion = readFileSync(join(RAIZ, "prisma/migrations/20261117130000_compras_orden_de_compra/migration.sql"), "utf8");
    const valoresDelCheck = (nombre: string) => {
      const check = new RegExp(`"${nombre}" CHECK \\([^']*IN \\(([^)]*)\\)`).exec(migracion);
      expect(check, `el CHECK ${nombre} existe en la migración`).not.toBeNull();
      return [...check![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    };
    expect(valoresDelCheck("OrdenDeCompra_estado_chk")).toEqual([...ESTADOS_DE_ORDEN].sort());
    expect(valoresDelCheck("NivelDeControl_nivel_chk")).toEqual([...NIVELES_DE_CONTROL].sort());
    expect(valoresDelCheck("OrdenDeCompra_cierreMotivo_chk")).toEqual([...MOTIVOS_DE_CIERRE].sort());
  });

  it("(d) los niveles de persona son los de la dimensión O; el módulo y las acciones son lo que el oráculo da por cierto", () => {
    const niveles = new Set([nivelDe({ rolEmpresa: null, esAdminEnElContexto: false }), nivelDe({ rolEmpresa: null, esAdminEnElContexto: true }), nivelDe({ rolEmpresa: "gerente", esAdminEnElContexto: false }), nivelDe({ rolEmpresa: "gerente", esAdminEnElContexto: true })]);
    const declarados = (DIMENSIONES["O"] ?? []).map((v) => (v === "OPERADOR" ? "operario" : v.toLowerCase()));
    expect([...niveles].sort()).toEqual(declarados.sort());
    expect(DIMENSIONES["M"]).toEqual(["APAGADO", "ENCENDIDO"]);
    expect(moduloDelCatalogo("ordenes_de_compra")).toMatchObject({ tipo: "vendible", estado: "disponible", requiere: ["recepcion_de_compras"] });
    const de = (clave: string) => ACCIONES.find((a) => a.clave === clave);
    expect(de("orden_de_compra_gestionar")).toMatchObject({ modulo: "ordenes_de_compra", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] });
    expect(de("compras_configurar")).toMatchObject({ modulo: "ordenes_de_compra", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] });
    expect(de("orden_de_compra_ver")).toMatchObject({ modulo: "ordenes_de_compra", contexto: "empresa", nivelMinimo: "operario", soloVer: true, rolesEditarSemilla: ["admin", "operador"] });
    expect(ACCIONES.filter((a) => a.modulo === "ordenes_de_compra").map((a) => a.clave).sort()).toEqual(["compras_configurar", "orden_de_compra_gestionar", "orden_de_compra_ver"]);
  });

  it("control de sanidad: el lector ve las entradas y las dimensiones declaradas", () => {
    expect(declaradas.length).toBe(29);
    expect(Object.keys(DIMENSIONES).sort()).toEqual(["A", "D", "E", "F", "G", "H", "I", "K", "L", "M", "N", "O", "P", "T", "V", "W", "X", "Y", "Z"]);
  });
});
