/**
 * `npm run auditar:dependencias`: corre `npm audit --omit=dev --json` y falla (código 1) si hay un aviso alto o crítico sin
 * excepción vigente en `scripts/auditoria-dependencias-excepciones.ts`. La lógica vive en `src/core/seguridad/auditoria-dependencias.ts`
 * (testeada).
 */
import { spawnSync } from "node:child_process";
import { evaluarAuditoria, extraerAvisosAltos, validarExcepciones } from "../src/core/seguridad/auditoria-dependencias";
import { EXCEPCIONES_DE_AUDITORIA } from "./auditoria-dependencias-excepciones";

function main(): number {
  const errores = validarExcepciones(EXCEPCIONES_DE_AUDITORIA);
  if (errores.length > 0) {
    console.error(`La lista de excepciones tiene errores:\n${errores.map((e) => `- ${e}`).join("\n")}`);
    return 1;
  }

  // Bajo `npm run`, npm_execpath es el npm-cli.js: se lo corre con node, sin shell (en Windows `npm` es un .cmd).
  const npmCli = process.env.npm_execpath;
  const opciones = { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 } as const;
  const corrida = npmCli ? spawnSync(process.execPath, [npmCli, "audit", "--omit=dev", "--json"], opciones) : spawnSync("npm", ["audit", "--omit=dev", "--json"], { ...opciones, shell: true });
  let salida;
  try {
    salida = JSON.parse(corrida.stdout);
  } catch {
    console.error(`No se pudo leer la salida de \`npm audit\` (¿sin red?).\n${corrida.stderr || corrida.stdout}`);
    return 1;
  }
  if (salida.error) {
    console.error(`\`npm audit\` falló: ${salida.error.summary ?? JSON.stringify(salida.error)}`);
    return 1;
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const r = evaluarAuditoria(extraerAvisosAltos(salida), EXCEPCIONES_DE_AUDITORIA, hoy);

  for (const a of r.aceptadas) console.log(`Aceptado hasta el ${a.venceElDia}: ${a.aviso} (${a.paquete}) — ${a.motivo}`);
  for (const e of r.sobrantes) console.warn(`Excepción sobrante (el aviso ya no aparece, conviene borrarla): ${e.aviso} (${e.paquete})`);
  for (const a of r.vencidas) console.error(`VENCIDA el ${a.venceElDia}: ${a.aviso} (${a.paquete}) ${a.titulo}`);
  for (const a of r.sinExcepcion) console.error(`SIN EXCEPCIÓN: ${a.aviso} (${a.paquete}, ${a.severidad}) ${a.titulo}`);

  if (!r.ok) return 1;
  console.log("Dependencias: sin avisos altos fuera de la lista de excepciones vigentes.");
  return 0;
}

process.exitCode = main();
