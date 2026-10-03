// Corre un comando con las variables de un archivo .env.vercel.* cargadas en su entorno, SIN pasar por bash (el "&" de las URLs rompe `source`).
// No imprime valores, solo el host de la base de destino. Uso (raíz del repo): node scripts/operaciones/con-env.mjs <archivo> -- <comando...>
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const corte = args.indexOf("--");
const archivo = args[0];
const comando = args.slice(corte + 1);
if (!archivo || corte < 1 || !comando.length) throw new Error("uso: con-env.mjs <archivo> -- <comando...>");

const kv = Object.fromEntries(
  readFileSync(archivo, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1)])
);
const host = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "(vacía)";
  }
};
console.log("Destino de la base:", host(kv.PLATAFORMA_DATABASE_URL || kv.DATABASE_URL));
const r = spawnSync(comando.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(" "), { shell: true, stdio: "inherit", env: { ...process.env, ...kv } });
process.exit(r.status ?? 1);
