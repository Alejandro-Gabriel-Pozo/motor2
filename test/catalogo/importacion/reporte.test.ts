import { describe, expect, it } from "vitest";
import { leerXlsx } from "../../../scripts/importacion/leer-xlsx";
import { destinoDeLaImportacion, verificarQuePuedeConfirmar } from "../../../scripts/importacion/destino";
import { generarExcelDeVariasHojas } from "../../../src/core/excel";
import { normalizarCatalogo } from "../../../src/core/features/catalogo/importacion/normalizar";
import { planificarCarta } from "../../../src/core/features/catalogo/importacion/planificar-carta";
import { planificarProductos, type DiferenciaPorLocal } from "../../../src/core/features/catalogo/importacion/planificar-productos";
import { armarReporte, pesos, textoDeDiferencia } from "../../../src/core/features/catalogo/importacion/reporte";
import { conteosDeLaImportacion, erroresDeLaImportacion } from "../../../src/core/features/catalogo/importacion/resumen";
import { catalogoSintetico } from "./catalogo-sintetico";
import { estadoVacio, permisosCompletos } from "./estado-de-prueba";
import { correccionesDe, libroDesde } from "./fixtura-de-catalogo";

/** E1.6: el reporte de 12 hojas (A.7), su escritura a .xlsx (leída de vuelta con el lector del importador) y las guardas de destino del comando. */
function datos() {
  const s = catalogoSintetico();
  const catalogo = normalizarCatalogo(libroDesde(s.productos), correccionesDe({ correcciones: s.correcciones }));
  const productos = planificarProductos(catalogo, estadoVacio(), permisosCompletos());
  const carta = planificarCarta(catalogo, productos, estadoVacio(), permisosCompletos());
  const errores = erroresDeLaImportacion(catalogo, productos, carta);
  return {
    tipo: "VISTA_PREVIA" as const,
    archivo: { nombre: "catalogo.xlsx", sha256: "a".repeat(64) },
    correcciones: { nombre: "correcciones.json", sha256: "b".repeat(64) },
    fecha: "2026-10-28T12:00:00.000Z",
    destino: "127.0.0.1 / motor2_cimp (local)",
    empresa: "Empresa principal (principal)",
    actor: "duena@local.test",
    huella: "0123456789abcdef".repeat(4),
    confirmable: errores.length === 0,
    catalogo,
    productos,
    carta,
    errores,
    avisos: catalogo.avisos,
    conteos: conteosDeLaImportacion(productos, carta),
    escrituras: null,
  };
}

describe("armarReporte (A.7)", () => {
  it("las 12 hojas, en orden, con los conteos del plan", () => {
    const hojas = armarReporte(datos());
    expect(hojas.map((h) => h.nombre)).toEqual([
      "Resumen",
      "Productos",
      "Precio único",
      "Disponibilidad por local",
      "Carta",
      "Sin sección",
      "Nombre de carta por local",
      "Correcciones del dueño",
      "Avisos",
      "No se importa",
      "Errores",
      "Pendiente de completar",
    ]);
    const filas = Object.fromEntries(hojas.map((h) => [h.nombre, h.filas.length]));
    expect(filas).toMatchObject({ Productos: 207, "Precio único": 14, "Disponibilidad por local": 610, Carta: 430, "Sin sección": 179, Errores: 0 });
    const resumen = new Map(hojas[0].filas.map(([k, v]) => [k, v]));
    expect(resumen.get("Estado")).toBe("CONFIRMABLE");
    expect(resumen.get("Huella (la que se confirma)")).toBe("0123456789ab");
    expect(resumen.get("Auditorías")).toBe(637);
    expect(resumen.get("Precios locales")).toBe(0);
    for (const h of hojas) for (const f of h.filas) expect(f.length, h.nombre).toBe(h.etiquetas.length);
  });

  it("se escribe como un .xlsx de 12 hojas que el propio lector lee de vuelta (textos como texto, números como número)", async () => {
    const blob = await generarExcelDeVariasHojas(armarReporte(datos()));
    const libro = leerXlsx(new Uint8Array(await blob.arrayBuffer()));
    expect(libro.problemas).toEqual([]);
    expect(libro.hojas).toHaveLength(12);
    const productos = libro.hojas.find((h) => h.nombre === "Productos")!;
    expect(productos.filas).toHaveLength(208);
    expect(productos.filas[1].celdas.get(4)).toEqual({ tipo: "numero", valor: "4000" });
  });

  it("dos hojas con el mismo nombre no se escriben", async () => {
    await expect(generarExcelDeVariasHojas([{ nombre: "A", etiquetas: ["x"], filas: [] }, { nombre: "A", etiquetas: ["x"], filas: [] }])).rejects.toThrow(/mismo nombre/);
  });

  it("pesos y la diferencia por local, con signo, porcentaje y «cobrará MÁS/MENOS»", () => {
    expect([pesos(BigInt(300000)), pesos(BigInt(2500050)), pesos(BigInt(-60000)), pesos(BigInt(0))]).toEqual(["$3.000", "$25.000,50", "-$600", "$0"]);
    const d = (diferencia: number, decimas: number, sentido: DiferenciaPorLocal["sentido"]): DiferenciaPorLocal => ({
      local: "Varvarco",
      precioEnElExcel: BigInt(0),
      precioUnico: BigInt(0),
      diferencia: BigInt(diferencia),
      porcentajeEnDecimas: BigInt(decimas),
      sentido,
    });
    expect(textoDeDiferencia(d(1000000, 435, "MAS"))).toBe("+$10.000 (+43,5 %) cobrará MÁS");
    expect(textoDeDiferencia(d(-800000, -286, "MENOS"))).toBe("−$8.000 (−28,6 %) cobrará MENOS");
    expect(textoDeDiferencia(d(0, 0, "IGUAL"))).toBe("igual");
  });
});

describe("guardas de destino del comando", () => {
  it("local: corre la vista previa y la confirmación; no local (o un ?host= que manda a otro lado): la confirmación exige MOTOR2_IMPORTAR_CONFIRMAR=si", () => {
    const local = destinoDeLaImportacion({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5433/motor2_cimp" });
    expect(local).toEqual({ host: "127.0.0.1", nombre: "motor2_cimp", remoto: false });
    expect(() => verificarQuePuedeConfirmar(local, {})).not.toThrow();
    const neon = destinoDeLaImportacion({ DATABASE_URL: "postgresql://u:p@ep-algo.neon.tech/neondb?sslmode=require" });
    expect(neon).toEqual({ host: "ep-algo.neon.tech", nombre: "neondb", remoto: true });
    expect(() => verificarQuePuedeConfirmar(neon, {})).toThrow(/MOTOR2_IMPORTAR_CONFIRMAR=si/);
    expect(() => verificarQuePuedeConfirmar(neon, { MOTOR2_IMPORTAR_CONFIRMAR: "SI" })).toThrow();
    expect(() => verificarQuePuedeConfirmar(neon, { MOTOR2_IMPORTAR_CONFIRMAR: "si" })).not.toThrow();
    const escondido = destinoDeLaImportacion({ DATABASE_URL: "postgresql://u:p@localhost/motor2?host=10.0.0.5" });
    expect(escondido).toMatchObject({ host: "10.0.0.5", remoto: true });
    expect(() => destinoDeLaImportacion({})).toThrow(/Falta DATABASE_URL/);
    expect(() => destinoDeLaImportacion({ DATABASE_URL: "postgresql://u:p@localhost/" })).toThrow(/nombre de la base/);
  });
});
