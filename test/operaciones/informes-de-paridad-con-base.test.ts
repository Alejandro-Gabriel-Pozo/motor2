import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { convertirPasoLibre } from "@/core/catalogo/conversion-de-paso-libre";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Los cuatro INFORMES DE SOLO LECTURA del frente 2 (`scripts/operaciones/informe-*.sql`), contra Postgres REAL: se corren con `psql` sobre una base TEMPORAL con todas las migraciones y datos
 * sembrados a propósito (dos empresas). Jamás sobre `motor2_dev`, `motor2_e2e` ni una base real: `crearBaseTemporalMigrada` se niega a correr si el servidor no es local.
 * Si falta `psql`, los casos se omiten con motivo.
 *
 * Qué fija: los números de cada informe contra el sembrado (oráculo escrito acá, aparte del SQL); SOLO LECTURA (cambiar el `ROLLBACK` final por un INSERT falla con «read-only transaction» y no queda
 * nada escrito); IDEMPOTENCIA (dos corridas dan la misma salida); CONCURRENCIA (un escritor con la transacción abierta no bloquea el informe, y el informe no ve lo no confirmado); AISLAMIENTO
 * (`-v slug=` limita a una empresa y no mezcla datos de la otra); y que el mapa de pasos en SQL da lo MISMO que la función pura `convertirPasoLibre` (src/core/catalogo/conversion-de-paso-libre.ts).
 *
 * Mutación: cambiar en `informe-pares-compra-venta.sql` `c.merma = 0` por `true` (en el cálculo de «exacto») pone en rojo el recuento de exactos 1 a 1 (la «Gaseosa cola» con 5 % de merma pasaría a exacta); sacar el `SET TRANSACTION READ ONLY` o el `BEGIN READ ONLY` de cualquier informe pone en rojo «solo lectura».
 */
const RAIZ = join(__dirname, "../..");
const SCRIPTS = {
  unidades: "scripts/operaciones/informe-unidades-equivalencias.sql",
  recetas: "scripts/operaciones/informe-recetas-y-merma.sql",
  pares: "scripts/operaciones/informe-pares-compra-venta.sql",
  pasos: "scripts/operaciones/informe-pasos-de-venta.sql",
} as const;
const leer = (clave: keyof typeof SCRIPTS) => readFileSync(join(RAIZ, SCRIPTS[clave]), "utf8");
const pexec = promisify(execFile);

let base: BaseTemporalMigrada;
let hayPsql = true;

/** Corre el texto de un script con `psql` (por la entrada estándar), en modo sin alinear (columnas separadas por `|`), y devuelve la salida; si `psql` falla, lanza con su mensaje de error. */
function correrTexto(contenido: string, vars: Record<string, string> = {}): Promise<string> {
  const args = ["-X", "-A", "-F", "|", "-v", "ON_ERROR_STOP=1", ...Object.entries(vars).flatMap(([k, v]) => ["-v", `${k}=${v}`])];
  return new Promise((resolver, rechazar) => {
    const hijo = spawn("psql", [base.url, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let salida = "";
    let error = "";
    hijo.stdout.on("data", (d) => (salida += d));
    hijo.stderr.on("data", (d) => (error += d));
    hijo.on("close", (codigo) => (codigo === 0 ? resolver(salida) : rechazar(new Error(error || `psql salió con ${codigo}`))));
    hijo.stdin.end(contenido);
  });
}
const correr = (clave: keyof typeof SCRIPTS, vars: Record<string, string> = {}) => correrTexto(leer(clave), vars);

/** ¿Hay una fila cuyas primeras celdas son exactamente éstas? */
const fila = (salida: string, ...celdas: string[]) => salida.split("\n").some((l) => l.split("|").slice(0, celdas.length).join("|") === celdas.join("|"));
/** Las filas (como arreglos de celdas) del bloque que empieza en el título dado, hasta la línea en blanco. Salta la fila de encabezados. */
function bloque(salida: string, titulo: string): string[][] {
  const lineas = salida.split("\n");
  const i = lineas.findIndex((l) => l.startsWith(titulo));
  if (i < 0) throw new Error(`no encontré el bloque «${titulo}»`);
  const filas: string[][] = [];
  for (let k = i + 2; k < lineas.length && lineas[k] !== ""; k++) filas.push(lineas[k]!.split("|"));
  return filas;
}

const SEMILLA = `
INSERT INTO "Empresa"(id, nombre, slug, "zonaHoraria", moneda) VALUES ('ea','A','a','America/Argentina/Buenos_Aires','ARS'), ('eb','B','b','America/Argentina/Buenos_Aires','ARS');
INSERT INTO "Unidad"(id,"empresaId",nombre,magnitud,decimales) VALUES
 ('a_kg','ea','kg','PESO',2),('a_g','ea','g','PESO',0),('a_un','ea','unidad','CANTIDAD',0),('a_caja','ea','Caja','CANTIDAD',0),('a_doc','ea','Docena','CANTIDAD',0),('a_kilo','ea','Kilo','CANTIDAD',0),('a_bidon','ea','Bidón','VOLUMEN',2),
 ('b_un','eb','unidad','CANTIDAD',0),('b_kg','eb','kg','PESO',2);
INSERT INTO "Producto"(id,codigo,nombre,tipo,"unidadStockId","unidadCompraId","factorConversion","seProduce","esConsignacion","pasoVenta","empresaId") VALUES
 ('p_azucar','MP1','Azúcar','MP','a_g','a_kg',1000,false,false,NULL,'ea'),
 ('p_sal','MP2','Sal','MP','a_g','a_kg',900,false,false,NULL,'ea'),
 ('p_aguam','MP4','Agua mineral','MP','a_un','a_un',1,false,false,NULL,'ea'),
 ('p_cola','MP5','Cola','MP','a_un','a_un',1,false,false,NULL,'ea'),
 ('p_pan','MP6','Pan','MP','a_un','a_un',1,false,false,NULL,'ea'),
 ('v_pizza','PV1','Pizza','PV','a_un','a_un',1,false,false,0.5,'ea'),
 ('v_tarta','PV2','Tarta','PV','a_un','a_un',1,false,false,0.2,'ea'),
 ('v_medida','PV3','Medida rara','PV','a_un','a_un',1,false,false,0.3,'ea'),
 ('v_fiambre','PV4','Fiambre','PV','a_kg','a_kg',1,false,false,NULL,'ea'),
 ('v_gaseosa','PV5','Gaseosa','PV','a_un','a_un',1,false,false,1,'ea'),
 ('v_diez','PV7','Porción chica','PV','a_un','a_un',1,false,false,0.1,'ea'),
 ('v_fino','PV8','Producida fina','PV','a_un','a_un',1,true,false,0.125,'ea'),
 ('v_agua','PV10','Agua 500','PV','a_un','a_un',1,false,false,NULL,'ea'),
 ('v_cola','PV11','Gaseosa cola','PV','a_un','a_un',1,false,false,NULL,'ea'),
 ('v_trago','PV12','Trago','PV','a_un','a_un',1,false,false,NULL,'ea'),
 ('v_tostada','PV13','Tostada','PV','a_un','a_un',1,false,false,NULL,'ea'),
 ('v_panso','PV14','Pan solo','PV','a_un','a_un',1,false,false,NULL,'ea'),
 ('bv_1','B-PV1','B pizza','PV','b_un','b_un',1,false,false,0.25,'eb'),
 ('bm_1','B-MP1','B mozzarella','MP','b_un','b_un',1,false,false,NULL,'eb');
INSERT INTO "RecetaVersion"(id,"productoId",version,"empresaId") VALUES
 ('rv_agua','v_agua',1,'ea'),('rv_cola','v_cola',1,'ea'),('rv_trago','v_trago',1,'ea'),('rv_tost','v_tostada',1,'ea'),('rv_panso','v_panso',1,'ea'),
 ('rv_pizza1','v_pizza',1,'ea'),('rv_pizza2','v_pizza',2,'ea'),('brv_1','bv_1',1,'eb');
INSERT INTO "RecetaIngrediente"(id,"recetaVersionId","insumoProductoId",cantidad,"unidadId","mermaPorcentaje","empresaId") VALUES
 ('ri1','rv_agua','p_aguam',1,'a_un',0,'ea'),('ri2','rv_cola','p_cola',1,'a_un',5,'ea'),
 ('ri3','rv_trago','p_cola',1,'a_un',0,'ea'),('ri4','rv_trago','p_azucar',20,'a_g',0,'ea'),
 ('ri5','rv_tost','p_pan',1,'a_un',0,'ea'),('ri6','rv_panso','p_pan',1,'a_un',0,'ea'),
 ('ri7','rv_pizza1','p_azucar',300,'a_g',10,'ea'),('ri8','rv_pizza2','p_azucar',300,'a_g',20,'ea'),('ri9','rv_pizza2','p_pan',1,'a_un',100,'ea'),
 ('bri_1','brv_1','bm_1',1,'b_un',0,'eb');`;

beforeAll(async () => {
  try {
    await pexec("psql", ["--version"]);
  } catch {
    hayPsql = false;
    return;
  }
  base = await crearBaseTemporalMigrada();
  await base.aplicarRestantes();
  await base.cliente.query(SEMILLA);
}, 120_000);

afterAll(async () => {
  await base?.eliminar();
});

const q = <T extends object = Record<string, unknown>>(sql: string) => base.cliente.query<T>(sql).then((r) => r.rows);

const conPsql = (nombre: string, f: () => Promise<void>) => it(nombre, async (ctx) => (hayPsql ? f() : ctx.skip()));

describe("informe de unidades y equivalencias", () => {
  conPsql("propone la equivalencia exacta, el envase a UNIDAD y deja pendiente lo que no es 1 a 1, no calza o no tiene regla", async () => {
    const s = await correr("unidades");
    expect(fila(s, "a", "kg", "PESO", "2", "sí", "KILOGRAMO", "EXACTA")).toBe(true);
    expect(fila(s, "a", "Caja", "CANTIDAD", "0", "sí", "UNIDAD", "ENVASE → UNIDAD (nombre original visible)")).toBe(true);
    expect(fila(s, "a", "Docena", "CANTIDAD", "0", "sí", "·", "PENDIENTE (no es 1 a 1)")).toBe(true);
    expect(fila(s, "a", "Kilo", "CANTIDAD", "0", "sí", "·", "PENDIENTE (la magnitud no calza con el nombre)")).toBe(true);
    expect(fila(s, "a", "Bidón", "VOLUMEN", "2", "sí", "·", "PENDIENTE (sin regla)")).toBe(true);
  });

  conPsql("resumen por empresa, las que faltan de las 14, coherencia del factor y suma de control", async () => {
    const s = await correr("unidades");
    expect(fila(s, "a", "7", "3", "1", "3", "1", "1")).toBe(true); // 7 unidades: 3 exactas, 1 envase, 3 pendientes (no 1 a 1, magnitud, sin regla)
    expect(fila(s, "b", "2", "2", "0", "0", "0", "0")).toBe(true);
    expect(fila(s, "a", "11")).toBe(true); // cubre UNIDAD, GRAMO y KILOGRAMO: faltan 11 de las 14
    expect(fila(s, "b", "12")).toBe(true);
    expect(fila(s, "a", "17", "16", "1")).toBe(true); // 17 productos comparables, 16 coherentes, 1 a revisar (Sal: kg→g con factor 900)
    expect(fila(s, "a", "Sal", "kg", "g", "900.0000", "1000.0000", "PENDIENTE DE REVISAR")).toBe(true);
    expect(fila(s, "a", "0", "0", "0", "0", "1915.0000", "9", "7")).toBe(true); // suma de control de A
  });
});

describe("informe de recetas y merma", () => {
  conPsql("cuenta versiones, líneas, vigentes, merma, calibraciones y productos que se producen", async () => {
    const s = await correr("recetas");
    expect(fila(s, "a", "7", "9", "4", "1", "100.00")).toBe(true); // 7 versiones, 9 líneas, 4 con merma, 1 de 100 % o más
    expect(fila(s, "a", "6", "0", "8", "3", "1")).toBe(true); // vigentes: pizza v1 queda afuera
    expect(fila(s, "b", "1", "1", "0", "0", "0.00")).toBe(true);
    expect(fila(s, "a", "1", "1")).toBe(true); // un producto que se produce, con paso
  });
});

describe("informe de pares compra + venta", () => {
  conPsql("recuenta candidatos y exactos 1 a 1, detalla y marca la materia prima compartida", async () => {
    const s = await correr("pares");
    expect(fila(s, "a", "4", "3")).toBe(true);
    expect(fila(s, "b", "1", "1")).toBe(true);
    expect(fila(s, "a", "Agua 500", "Agua mineral", "unidad", "1.0000", "0.00", "exacto 1 a 1", "0")).toBe(true);
    expect(fila(s, "a", "Gaseosa cola", "Cola", "unidad", "1.0000", "5.00", "MIRAR (cantidad o merma distinta)", "1")).toBe(true); // Cola también la usa el Trago
    expect(fila(s, "a", "Pan", "2")).toBe(true); // Tostada y Pan solo usan el mismo Pan: no son un par
  });
});

describe("informe de pasos de venta", () => {
  conPsql("resume por empresa y da lo MISMO que la función pura convertirPasoLibre, producto por producto", async () => {
    const s = await correr("pasos");
    expect(fila(s, "a", "12", "6", "2", "2", "2")).toBe(true);
    expect(fila(s, "b", "1", "0", "1", "0", "0")).toBe(true);
    const productos = await q<{ nombre: string; paso: string | null; magnitud: string; empresa: string }>(
      `SELECT p.nombre, p."pasoVenta"::text AS paso, u.magnitud::text AS magnitud, e.slug AS empresa FROM "Producto" p JOIN "Unidad" u ON u.id = p."unidadStockId" AND u."empresaId" = p."empresaId" JOIN "Empresa" e ON e.id = p."empresaId" WHERE p.tipo = 'PV'`,
    );
    const detalle = bloque(s, "=== 2. DETALLE");
    for (const p of productos) {
      const d = p.paso === null ? null : Math.round(Number(p.paso) * 10_000);
      const esperado = convertirPasoLibre({ pasoVenta: d, porcionesActuales: [], magnitud: p.magnitud as "CANTIDAD" | "PESO" | "VOLUMEN" });
      const enElInforme = detalle.find((c) => c[0] === p.empresa && c[1] === p.nombre);
      if (esperado.resultado === "NADA") expect(enElInforme, `${p.nombre} no debe figurar`).toBeUndefined();
      else {
        expect(enElInforme?.[4], p.nombre).toBe(esperado.resultado);
        if ("porciones" in esperado) expect(Number(enElInforme?.[5]), p.nombre).toBe(esperado.porciones[0]);
        else expect(enElInforme?.[5], p.nombre).toBe("·");
      }
    }
    expect(fila(s, "a", "Producida fina", "unidad", "0", "0.1250", "3", "EL PASO ES MÁS FINO QUE LA UNIDAD")).toBe(true);
  });
});

describe("propiedades comunes de los cuatro informes", () => {
  const claves = Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[];

  for (const clave of claves) {
    conPsql(`${clave}: solo lectura (un INSERT antes del ROLLBACK falla y no queda nada escrito)`, async () => {
      const antes = await q<{ n: string }>(`SELECT count(*)::text AS n FROM "CategoriaProducto"`);
      const mutado = leer(clave).replace(/\nROLLBACK;\s*$/, `\nINSERT INTO "CategoriaProducto"(id, nombre, "empresaId") VALUES ('x', 'x', 'ea');\nROLLBACK;\n`);
      expect(mutado).not.toBe(leer(clave)); // la mutación se aplicó
      await expect(correrTexto(mutado)).rejects.toThrow(/read-only transaction/);
      expect(await q(`SELECT count(*)::text AS n FROM "CategoriaProducto"`)).toEqual(antes);
    });

    conPsql(`${clave}: idempotente (dos corridas dan la misma salida) y deja la base como estaba`, async () => {
      const filasAntes = await q<{ c: string }>(`SELECT (SELECT count(*) FROM "Unidad") || '/' || (SELECT count(*) FROM "Producto") || '/' || (SELECT count(*) FROM "RecetaIngrediente") AS c`);
      const a = await correr(clave);
      const b = await correr(clave);
      expect(b).toBe(a);
      expect(await q(`SELECT (SELECT count(*) FROM "Unidad") || '/' || (SELECT count(*) FROM "Producto") || '/' || (SELECT count(*) FROM "RecetaIngrediente") AS c`)).toEqual(filasAntes);
    });

    conPsql(`${clave}: aislamiento (con slug=b no aparece nada de la empresa a)`, async () => {
      const s = await correr(clave, { slug: "b" });
      const filasDeA = s.split("\n").filter((l) => l.startsWith("a|"));
      expect(filasDeA).toEqual([]);
      expect(s.split("\n").some((l) => l.startsWith("b|"))).toBe(true);
    });

    conPsql(`${clave}: concurrencia (un escritor con la transacción abierta no la bloquea y el informe no ve lo no confirmado)`, async () => {
      const escritor = new Client({ connectionString: base.url });
      await escritor.connect();
      try {
        await escritor.query("BEGIN");
        await escritor.query(`INSERT INTO "Unidad"(id,"empresaId",nombre,magnitud,decimales) VALUES ('zz','ea','NoConfirmada','CANTIDAD',0)`);
        await escritor.query(`UPDATE "Producto" SET "pasoVenta" = 0.3 WHERE id = 'v_pizza'`);
        const s = await Promise.race([correr(clave), new Promise<string>((_, rechazar) => setTimeout(() => rechazar(new Error("el informe quedó bloqueado por un escritor")), 20_000))]);
        expect(s).not.toContain("NoConfirmada");
        if (clave === "pasos") expect(fila(s, "a", "Pizza", "unidad", "0.5000", "AUTOMATICA")).toBe(true); // sigue viendo el 0,5 confirmado
      } finally {
        await escritor.query("ROLLBACK");
        await escritor.end();
      }
    });
  }
});
