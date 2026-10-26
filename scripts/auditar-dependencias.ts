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
  // La auditoría consulta el registro de npm por red: en el runner de CI se cuelga a veces y `npm audit` espera 5 minutos sin decir nada. Cada intento tiene tope de tiempo y se repite hasta 3 veces; si ninguno responde, falla (nunca pasa en silencio).
  const npmCli = process.env.npm_execpath;
  const opciones = { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 90_000 } as const;
  const INTENTOS = 3;
  let salida;
  let motivo = "";
  for (let intento = 1; intento <= INTENTOS && !salida; intento++) {
    const corrida = npmCli ? spawnSync(process.execPath, [npmCli, "audit", "--omit=dev", "--json"], opciones) : spawnSync("npm", ["audit", "--omit=dev", "--json"], { ...opciones, shell: true });
    try {
      const leida = JSON.parse(corrida.stdout);
      if (leida.error) motivo = `\`npm audit\` falló: ${leida.error.summary ?? JSON.stringify(leida.error)}`;
      else salida = leida;
    } catch {
      motivo = corrida.error ? `\`npm audit\` no terminó a tiempo o no arrancó: ${corrida.error.message}` : `No se pudo leer la salida de \`npm audit\` (¿sin red?).\n${corrida.stderr || corrida.stdout}`;
    }
    if (!salida && intento < INTENTOS) console.warn(`Intento ${intento} de ${INTENTOS} sin resultado (${motivo.split("\n")[0]}); reintento.`);
  }
  if (!salida) {
    console.error(motivo);
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
