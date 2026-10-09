/**
 * GT-22 (S-33), `prisma/seed.ts` (autorizado por el dueño, 2026-10-08): lo que se le exige al seed base, mirado en su fuente (los comentarios no cuentan). Devuelve los problemas, uno por línea;
 * vacío = cumple. Lo usa `scripts-con-guarda-de-destino.test.ts`, que además prueba este detector con fuentes sintéticas.
 *  - Llama a `resolverDestinoDelSeedBase(process.env, …)` y a `confirmarDestinoRemoto(…)` ANTES de la primera consulta a la base (`await prisma.…` o `dbDeEmpresa(empresaId)`).
 *  - Declara los flags `--permitir-remoto` y `--mostrar-enlace`.
 *  - Nunca imprime el enlace ni el token por su cuenta: `enlaceDeInvitacion(` solo aparece como valor de `enlace:` que se le pasa a `entregarEnlaceDelSeed`, el único que lo imprime y solo
 *    con `--mostrar-enlace`.
 */
export function problemasDelSeed(fuenteConComentarios: string): string[] {
  const fuente = fuenteConComentarios.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const problemas: string[] = [];
  const guarda = fuente.indexOf("resolverDestinoDelSeedBase(process.env,");
  const confirmacion = fuente.indexOf("await confirmarDestinoRemoto(");
  const consultas = ["await prisma.", "dbDeEmpresa(empresaId)"].map((t) => fuente.indexOf(t)).filter((i) => i >= 0);
  const primeraConsulta = consultas.length > 0 ? Math.min(...consultas) : Infinity;
  if (guarda < 0) problemas.push("no llama a resolverDestinoDelSeedBase(process.env, …): el seed escribe en la DATABASE_URL que haya, sin guarda de host");
  if (confirmacion < 0) problemas.push("no llama a confirmarDestinoRemoto: una base remota no pide confirmación");
  if (guarda >= 0 && guarda > primeraConsulta) problemas.push("la guarda de destino corre DESPUÉS de la primera consulta a la base");
  if (confirmacion >= 0 && confirmacion > primeraConsulta) problemas.push("la confirmación de la base remota corre DESPUÉS de la primera consulta a la base");
  if (!/"permitir-remoto"/.test(fuente) || !/"mostrar-enlace"/.test(fuente)) problemas.push("faltan los flags --permitir-remoto / --mostrar-enlace");
  if (/console\.(log|info|warn|error)\([^;]*(enlaceDeInvitacion|token)/i.test(fuente)) problemas.push("imprime el enlace o el token por su cuenta");
  for (const m of fuente.matchAll(/enlaceDeInvitacion\(/g)) {
    const antes = fuente.slice(Math.max(0, (m.index ?? 0) - 10), m.index);
    if (!antes.includes("enlace: ")) problemas.push("usa enlaceDeInvitacion( fuera de la entrega (`enlace: …`)");
  }
  if (!fuente.includes("entregarEnlaceDelSeed(")) problemas.push("no entrega el enlace por entregarEnlaceDelSeed");
  if (!/entrega:\s*decidirEntregaDelEnlace\(\{\s*mostrarEnlace:\s*values\["mostrar-enlace"\]\s*===\s*true/.test(fuente)) problemas.push("la entrega no sale de decidirEntregaDelEnlace con el flag --mostrar-enlace (sin el flag, el enlace no se imprime)");
  return problemas;
}
