/**
 * Cuántos CUIT de la base están en orden y cuáles hay que corregir antes de exigir CUIT canónico y único (solo lectura, no modifica nada), en la
 * base que apunte DIRECT_URL (el dueño de las tablas: el RLS está activado sin FORCE y ve todas las empresas). La lógica vive en
 * `src/core/fiscal/diagnostico-cuit.ts` (testeada). Lee solo `Empresa(slug, cuit)` y `Proveedor(empresaId, codigo, cuit)`.
 * `--detalle` lista slug de empresa + código del proveedor + motivo; nunca imprime el CUIT ni el nombre (un CUIT 20/23/27 lleva el DNI de una
 * persona): igual no pegues la salida en ningún chat ni ticket.
 *
 * Uso: npm run medir-cuit -- [--detalle]
 *   node scripts/operaciones/con-env.mjs .env.vercel.zuluhub -- npx tsx scripts/medir-cuit.ts
 */
import "dotenv/config";
import { Client } from "pg";
import { diagnosticarCuits, type DiagnosticoDeCuit, type FilaConCuit } from "../src/core/fiscal/public";

function imprimir(titulo: string, d: DiagnosticoDeCuit, conDetalle: boolean) {
  console.log(`${titulo}: ${d.total}`);
  console.log(`  vacíos:                                  ${d.vacios}`);
  console.log(`  ya canónicos (11 dígitos válidos):       ${d.canonicos}`);
  console.log(`  válidos con separadores (se normalizan): ${d.validosConSeparadores}`);
  console.log(`  no normalizan (letras o largo distinto): ${d.noNormalizan}`);
  console.log(`  prefijo inválido:                        ${d.prefijoInvalido}`);
  console.log(`  dígito verificador inválido:             ${d.verificadorInvalido}`);
  console.log(`  grupos duplicados al normalizar:         ${d.gruposDuplicados} (${d.filasEnDuplicados} filas)`);
  if (conDetalle) for (const x of d.detalle) console.log(`    - ${x.referencia}: ${x.motivo}`);
}

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error("Falta DIRECT_URL: no se puede medir.");
    return 1;
  }
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query("BEGIN READ ONLY");
    const empresas = (await cliente.query(`SELECT "slug", "cuit" FROM "Empresa"`)).rows;
    const proveedores = (
      await cliente.query(`SELECT e."slug", p."empresaId", p."codigo", p."cuit" FROM "Proveedor" p JOIN "Empresa" e ON e."id" = p."empresaId"`)
    ).rows;
    await cliente.query("ROLLBACK");

    const filasEmpresa: FilaConCuit[] = empresas.map((e) => ({ referencia: String(e.slug), grupo: "global", cuit: e.cuit === null ? null : String(e.cuit) }));
    const filasProveedor: FilaConCuit[] = proveedores.map((p) => ({
      referencia: `${String(p.slug)}/${String(p.codigo)}`,
      grupo: String(p.empresaId),
      cuit: p.cuit === null ? null : String(p.cuit),
    }));
    const detalle = process.argv.includes("--detalle");
    imprimir("Empresas", diagnosticarCuits(filasEmpresa), detalle);
    imprimir("Proveedores", diagnosticarCuits(filasProveedor), detalle);
    return 0;
  } finally {
    await cliente.end();
  }
}

main()
  .then((codigo) => {
    process.exitCode = codigo;
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
