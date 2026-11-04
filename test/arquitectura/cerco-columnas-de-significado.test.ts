import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probarCerco } from "./cercos/probar-cerco";
import { RAIZ_DEL_REPO, type Cerco, type Cuentas } from "./cercos/trinquete";
import { AFECTA_VALIDOS, DECLARACIONES, MODELOS_EN_ALCANCE, TODOS_LOS_MODELOS_EN_ALCANCE } from "./guardas/columnas-de-significado";
import { columnasDelEsquema, esColumnaDeSignificado, type ColumnaDelEsquema } from "./guardas/columnas-del-esquema";

/**
 * Guardián de COLUMNAS DE SIGNIFICADO (etapa E2 del arnés de matrices, `docs/diseno-arnes-de-matrices-2026-11-03.md` §10; matriz 8 de
 * `docs/mapa-cobertura-de-combinaciones-2026-10-28.md`). Necesidad (AGENTS.md, regla «Combinaciones», dueño, 2026-10-28): «un guardián debe fallar si aparece una dimensión nueva
 * (una columna, una opción, una clave) sin declarar si afecta o no».
 *
 * Qué hace: lee `prisma/schema.prisma`, recorre las columnas de significado (`esColumnaDeSignificado`: Boolean, fecha de estado, enum, columna con CHECK anotado en su `///`)
 * de los modelos en alcance (`MODELOS_EN_ALCANCE`: dinero, visibilidad y stock) y exige que cada una esté declarada a mano en `DECLARACIONES` (afecta + motivo).
 *  - Una columna NUEVA sin declarar hace fallar el test, con el modelo y la columna en el mensaje y cómo declararla.
 *  - Las columnas que YA existían sin declarar son deuda con nombre en `cercos/linea-de-base/columnas-de-significado.json`: el trinquete solo deja BAJAR esa cuenta.
 *
 * Límites (declarados): (1) los `Decimal` no entran, los cubre `escrituras-auditadas.test.ts`; (2) un CHECK que solo vive en la migración y no está anotado en el `///` de su columna no
 * se ve (Prisma no modela los CHECK; leer el SQL de las migraciones sería más frágil: hay CHECK que se borran y se rehacen); (3) un modelo NUEVO fuera de `MODELOS_EN_ALCANCE` no se
 * mira: decidir si entra es parte de declararlo en `clasificacion-de-tablas.ts`, que sí exige que toda tabla nueva se clasifique.
 */
const ESQUEMA = readFileSync(join(RAIZ_DEL_REPO, "prisma/schema.prisma"), "utf8");

const AYUDA = [
  "Cómo se arregla: en test/arquitectura/guardas/columnas-de-significado.ts agregá la columna a DECLARACIONES con `Modelo.columna`, `afecta`",
  "(dinero | visibilidad | stock | ninguna) y un `motivo` de verdad (qué decide la columna). Si era deuda de la línea de base, después corré",
  "`BAJAR_CERCOS=1 npx vitest run test/arquitectura/cerco-columnas-de-significado.test.ts` para fijar que bajó. «ninguna» también lleva motivo.",
].join(" ");

/** Las columnas de significado de los modelos en alcance, en el orden del esquema. */
function columnasEnAlcance(esquema: string, modelos: readonly string[]): ColumnaDelEsquema[] {
  const enAlcance = new Set(modelos);
  return columnasDelEsquema(esquema).filter((c) => enAlcance.has(c.modelo) && esColumnaDeSignificado(c));
}

/** Entrada `Modelo.columna` → `sin-declarar` de cada columna de significado sin declaración. */
function medirSinDeclarar(esquema: string, modelos: readonly string[], declaraciones: Readonly<Record<string, unknown>>): Cuentas {
  const cuentas: Cuentas = {};
  for (const c of columnasEnAlcance(esquema, modelos)) {
    const clave = `${c.modelo}.${c.columna}`;
    if (!(clave in declaraciones)) cuentas[clave] = { "sin-declarar": 1 };
  }
  return cuentas;
}

const CERCO_COLUMNAS: Cerco = {
  regla: "columnas-de-significado",
  meta: "bajar a 0: toda columna de significado de un modelo de dinero, visibilidad o stock declara si afecta o no, con motivo (E2)",
  medir: () => medirSinDeclarar(ESQUEMA, TODOS_LOS_MODELOS_EN_ALCANCE, DECLARACIONES),
};

describe("guardián de columnas de significado: las declaraciones", () => {
  const columnas = columnasDelEsquema(ESQUEMA);
  const nombresDeModelos = new Set(columnas.map((c) => c.modelo));
  const deSignificado = new Set(columnasEnAlcance(ESQUEMA, TODOS_LOS_MODELOS_EN_ALCANCE).map((c) => `${c.modelo}.${c.columna}`));

  it("cada modelo en alcance existe en el esquema y está en un solo grupo", () => {
    const sinModelo = TODOS_LOS_MODELOS_EN_ALCANCE.filter((m) => !nombresDeModelos.has(m));
    const repetidos = TODOS_LOS_MODELOS_EN_ALCANCE.filter((m, i, todos) => todos.indexOf(m) !== i);
    expect({ sinModelo, repetidos }).toEqual({ sinModelo: [], repetidos: [] });
  });

  it("el alcance tiene el tamaño declarado (quitar o sumar un modelo es una decisión visible en el diff)", () => {
    expect(Object.fromEntries(Object.entries(MODELOS_EN_ALCANCE).map(([clase, g]) => [clase, g.modelos.length]))).toEqual({ dinero: 36, visibilidad: 22, stock: 11 });
    expect(TODOS_LOS_MODELOS_EN_ALCANCE).toHaveLength(69);
    for (const g of Object.values(MODELOS_EN_ALCANCE)) expect(g.motivo.trim().length).toBeGreaterThanOrEqual(40);
  });

  it("cada declaración usa un `afecta` válido, trae un motivo de verdad y apunta a una columna de significado que existe", () => {
    const problemas: string[] = [];
    for (const [clave, d] of Object.entries(DECLARACIONES)) {
      if (!AFECTA_VALIDOS.includes(d.afecta)) problemas.push(`${clave}: afecta «${String(d.afecta)}» no es válido (${AFECTA_VALIDOS.join(" | ")})`);
      if (typeof d.motivo !== "string" || d.motivo.trim().length < 20) problemas.push(`${clave}: falta el motivo (al menos 20 caracteres: qué decide la columna)`);
      if (!deSignificado.has(clave)) problemas.push(`${clave}: no es una columna de significado de un modelo en alcance (¿se renombró, se borró, o el modelo no está en MODELOS_EN_ALCANCE? sacala de DECLARACIONES)`);
    }
    expect(problemas, problemas.join("\n")).toEqual([]);
  });

  it("el detector no pasa en vacío: ve cientos de columnas, las ya declaradas y las que siguen en la línea de base", () => {
    expect(deSignificado.size).toBeGreaterThan(150);
    expect(Object.keys(DECLARACIONES).length).toBeGreaterThan(80);
    // Una columna por cada razón de entrar: Boolean, fecha de estado, enum y CHECK.
    for (const clave of ["Producto.seProduce", "Operacion.anuladaEn", "TraspasoSucursal.estado", "PromoCarta.diasDeSemana"]) expect(deSignificado.has(clave), clave).toBe(true);
    expect(Object.keys(medirSinDeclarar(ESQUEMA, TODOS_LOS_MODELOS_EN_ALCANCE, DECLARACIONES)).length).toBeGreaterThan(0);
  });
});

describe("guardián de columnas de significado: el lector y el detector sobre un esquema de juguete", () => {
  const ESQUEMA_DE_JUGUETE = `
enum EstadoX {
  A
  B
}

model Caja {
  id            String   @id
  /// Interruptor: si está apagada no se ve.
  activa        Boolean  @default(true)
  creadoEn      DateTime @default(now())
  actualizadoEn DateTime @updatedAt
  anuladaEn     DateTime?
  estado        EstadoX
  /// Mayúsculas y hasta 40 (CHECK).
  codigo        String
  nombre        String
  importe       Decimal  @db.Decimal(14, 2)
  /// Máscara de días
  /// (1 a 127, CHECK).
  dias          Int?
  items         Item[]
  otraId        String?
  otra          Otra?    @relation(fields: [otraId], references: [id])
  suelta        Boolean // comentario común: no es de documentación

  @@index([id])
}

model Otra {
  id     String @id
  oculta Boolean
}
`;

  it("lee tipo, opcionalidad, enum, relación y comentario (también varios `///` y con CRLF)", () => {
    for (const texto of [ESQUEMA_DE_JUGUETE, ESQUEMA_DE_JUGUETE.replace(/\n/g, "\r\n")]) {
      const caja = columnasDelEsquema(texto).filter((c) => c.modelo === "Caja");
      const por = Object.fromEntries(caja.map((c) => [c.columna, c]));
      expect(por.activa).toMatchObject({ tipo: "Boolean", opcional: false, comentario: "Interruptor: si está apagada no se ve." });
      expect(por.anuladaEn).toMatchObject({ tipo: "DateTime", opcional: true });
      expect(por.estado.esEnum).toBe(true);
      expect(por.otra).toMatchObject({ esRelacion: true, opcional: true });
      expect(por.items).toMatchObject({ lista: true, esRelacion: false });
      expect(por.dias.comentario).toBe("Máscara de días (1 a 127, CHECK).");
      expect(por.suelta.comentario).toBe("comentario común: no es de documentación");
      expect(caja.map((c) => c.columna)).not.toContain("@@index");
    }
  });

  it("es de significado: Boolean, fecha de estado, enum y CHECK; no el Decimal, el texto, la auditoría técnica ni la relación", () => {
    const significativas = columnasDelEsquema(ESQUEMA_DE_JUGUETE)
      .filter((c) => c.modelo === "Caja" && esColumnaDeSignificado(c))
      .map((c) => c.columna);
    expect(significativas).toEqual(["activa", "anuladaEn", "estado", "codigo", "dias", "suelta"]);
  });

  it("una columna nueva sin declarar en un modelo en alcance se detecta con modelo y columna; las declaradas y los modelos fuera de alcance no", () => {
    const declaradas = { "Caja.activa": { afecta: "visibilidad" } };
    expect(Object.keys(medirSinDeclarar(ESQUEMA_DE_JUGUETE, ["Caja"], declaradas)).sort()).toEqual(["Caja.anuladaEn", "Caja.codigo", "Caja.dias", "Caja.estado", "Caja.suelta"]);
    expect(Object.keys(medirSinDeclarar(ESQUEMA_DE_JUGUETE, ["Otra"], declaradas))).toEqual(["Otra.oculta"]);
    expect(medirSinDeclarar(ESQUEMA_DE_JUGUETE, [], declaradas)).toEqual({});
  });
});

probarCerco(CERCO_COLUMNAS, AYUDA);
