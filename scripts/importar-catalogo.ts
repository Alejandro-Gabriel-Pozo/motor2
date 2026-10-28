/**
 * IMPORTADOR DEL CATÁLOGO UNIFICADO, con vista previa (docs/diseno-importador-de-catalogo-2026-10-28.md con su ADENDA v2). Comando de UN SOLO USO que corre el ingeniero (decisión D1 del
 * dueño: carga única, sin pantalla). Lee el Excel del dueño y sus correcciones y:
 *  - con `--vista-previa <salida.xlsx>`: SOLO LEE la base y escribe el reporte de 12 hojas con la HUELLA (12 caracteres). No escribe nada en la base.
 *  - con `--confirmar <huella>`: recalcula todo en UNA transacción SERIALIZABLE y, si la huella es la que vio el dueño y no hay errores, carga los productos (un precio por empresa), su
 *    disponibilidad en los 5 locales y la carta mínima por secciones, con su auditoría; si no, no escribe nada. Deja el reporte del resultado junto al Excel.
 *
 * Uso (con `tsx --conditions=react-server`, como `db:seed`; el Excel y las correcciones los guarda el dueño FUERA del repositorio: tienen precios):
 *   npx tsx --conditions=react-server scripts/importar-catalogo.ts --archivo <catalogo.xlsx> --correcciones <correcciones.json> --empresa <slug> --actor <email> --vista-previa <salida.xlsx>
 *   npx tsx --conditions=react-server scripts/importar-catalogo.ts --archivo <catalogo.xlsx> --correcciones <correcciones.json> --empresa <slug> --actor <email> --confirmar <huella>
 * Base: la `DATABASE_URL` del entorno (rol `motor2_app`). Contra una base que no es local, confirmar exige además `MOTOR2_IMPORTAR_CONFIRMAR=si` en esa línea de comandos
 * (`scripts/importacion/destino.ts`). Ejemplo de correcciones: `scripts/importacion/correcciones.ejemplo.json`. Código de salida: 0 si salió bien, 1 si no (y no escribió nada).
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { generarExcelDeVariasHojas } from "../src/core/excel";
import { leerCorrecciones } from "../src/core/features/catalogo/importacion/correcciones";
import { huellaDeLasCorrecciones } from "../src/core/features/catalogo/importacion/huella";
import { normalizarCatalogo } from "../src/core/features/catalogo/importacion/normalizar";
import { armarReporte, pesos, textoDeDiferencia } from "../src/core/features/catalogo/importacion/reporte";
import { prisma } from "../src/lib/db";
import { importarCatalogoCasoDeUso, type InformeDeImportacion } from "../src/server/actions/catalogo/casos-de-uso/importar-catalogo";
import { contextoDeActorParaComando } from "../src/server/sesion/contexto-de-comando";
import { destinoDeLaImportacion, verificarQuePuedeConfirmar } from "./importacion/destino";
import { ErrorDeLectura, leerXlsx } from "./importacion/leer-xlsx";

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function argumentos() {
  const { values } = parseArgs({
    options: {
      archivo: { type: "string" },
      correcciones: { type: "string" },
      empresa: { type: "string" },
      actor: { type: "string" },
      "vista-previa": { type: "string" },
      confirmar: { type: "string" },
    },
    strict: true,
  });
  const faltan = (["archivo", "correcciones", "empresa", "actor"] as const).filter((k) => !values[k]);
  if (faltan.length > 0) throw new Error(`Faltan: ${faltan.map((k) => `--${k}`).join(", ")}.`);
  if (Boolean(values["vista-previa"]) === Boolean(values.confirmar)) throw new Error("Pasá UNO de --vista-previa <salida.xlsx> o --confirmar <huella>.");
  return { archivo: values.archivo!, correcciones: values.correcciones!, empresa: values.empresa!, actor: values.actor!, vistaPrevia: values["vista-previa"], confirmar: values.confirmar };
}

function imprimirResumen(informe: InformeDeImportacion) {
  const c = informe.conteos;
  console.log(`Huella: ${informe.huellaVisible} — ${informe.confirmable ? "CONFIRMABLE" : "NO CONFIRMABLE"}`);
  console.log(`Productos: ${c.productos.CREAR} a crear, ${c.productos.SIN_CAMBIOS} sin cambios, ${c.productos.ERROR} con error. Disponibilidades a crear: ${c.filasDeDisponibilidad}.`);
  console.log(
    `Carta: ${c.contenidos.CREAR} contenidos a crear, ${c.contenidos.SIN_CAMBIOS} sin cambios, ${c.contenidos.FUERA_DE_CARTA} filas fuera de carta, ${c.contenidos.ERROR} con error. Auditorías: ${c.auditorias}. Precios locales: ${c.preciosLocales}.`,
  );
  const unicos = informe.productos.productos.filter((p) => p.precio && (p.precio.origen === "REGLA" || p.precio.origen === "CORRECCION"));
  if (unicos.length > 0) console.log(`Precio único por regla o corrección (${unicos.length}):`);
  for (const p of unicos) {
    const difs = p.diferencias.filter((d) => d.sentido !== "IGUAL").map((d) => `${d.local} ${textoDeDiferencia(d)}`);
    console.log(`  ${p.sku}: ${pesos(p.precio!.centavos)} (${p.precio!.origen === "REGLA" ? `regla${p.precio!.empate ? ", empate → el mayor" : ""}` : "corrección"})${difs.length ? ` — ${difs.join("; ")}` : ""}`);
  }
  console.log(`Avisos: ${informe.avisos.length}. Errores: ${informe.errores.length}.`);
  for (const e of informe.errores.slice(0, 20)) console.log(`  [${e.codigo}] ${e.hoja ?? ""}${e.fila ? ` fila ${e.fila}` : ""}${e.columna ? ` col ${e.columna}` : ""}${e.sku ? ` ${e.sku}` : ""}: ${e.motivo}`);
  if (informe.errores.length > 20) console.log(`  … y ${informe.errores.length - 20} más (hoja «Errores» del reporte).`);
}

async function main(): Promise<number> {
  const args = argumentos();
  const destino = destinoDeLaImportacion(process.env);
  console.log(`Destino: host ${destino.host}, base "${destino.nombre}"${destino.remoto ? " (NO LOCAL)" : " (local)"}.`);
  if (args.confirmar) verificarQuePuedeConfirmar(destino, process.env);

  const bytes = new Uint8Array(readFileSync(args.archivo));
  const textoDeCorrecciones = readFileSync(args.correcciones, "utf8");
  const correcciones = leerCorrecciones(JSON.parse(textoDeCorrecciones));
  if (!correcciones.ok) {
    console.error("El archivo de correcciones no es válido; no se hizo nada:");
    for (const e of correcciones.errores) console.error(`  ${e.motivo}`);
    return 1;
  }
  const catalogo = normalizarCatalogo(leerXlsx(bytes), correcciones.correcciones);
  const actor = await contextoDeActorParaComando({ empresa: args.empresa, email: args.actor });
  const shaDelArchivo = sha256(bytes);
  const resultado = await importarCatalogoCasoDeUso(actor, { shaDelArchivo, catalogo, modo: args.confirmar ? { tipo: "CONFIRMAR", huella: args.confirmar } : { tipo: "VISTA_PREVIA" } });
  console.log(resultado.mensaje);
  if (!resultado.ok) return 1;

  const informe = resultado.datos;
  imprimirResumen(informe);
  const salida = args.vistaPrevia ?? join(dirname(args.archivo), `resultado-importacion-${informe.huellaVisible}.xlsx`);
  const hojas = armarReporte({
    tipo: args.confirmar ? "RESULTADO" : "VISTA_PREVIA",
    archivo: { nombre: basename(args.archivo), sha256: shaDelArchivo },
    correcciones: { nombre: basename(args.correcciones), sha256: huellaDeLasCorrecciones(correcciones.correcciones) },
    fecha: new Date().toISOString(),
    destino: `${destino.host} / ${destino.nombre}${destino.remoto ? " (no local)" : " (local)"}`,
    empresa: `${actor.empresaNombre} (${actor.empresaSlug})`,
    actor: actor.email,
    huella: informe.huella,
    confirmable: informe.confirmable,
    catalogo,
    productos: informe.productos,
    carta: informe.carta,
    errores: informe.errores,
    avisos: informe.avisos,
    conteos: informe.conteos,
    escrituras: informe.escrituras,
  });
  writeFileSync(salida, new Uint8Array(await (await generarExcelDeVariasHojas(hojas)).arrayBuffer()));
  console.log(`Reporte: ${salida}`);
  return 0;
}

main()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((e: unknown) => {
    console.error(e instanceof ErrorDeLectura ? `No se pudo leer el Excel: ${e.message}` : e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
