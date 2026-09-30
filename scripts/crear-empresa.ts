/**
 * Alta de una empresa nueva en la base que apunte DATABASE_URL (ADR-007, A7). La lógica vive en
 * `src/core/features/empresa/crear-empresa.ts` (transaccional, testeada); esto solo lee los argumentos.
 *
 * Uso: npm run crear-empresa -- --nombre "Pizzería Norte" --slug norte --email gerente@norte.com \
 *        --zona-horaria America/Argentina/Buenos_Aires --moneda ARS [--sucursal Central]
 *
 * DATABASE_URL debe ser el rol `motor2_app` (con otro rol que salta el RLS se niega si quedan 2+ empresas activas).
 * No es idempotente: si el slug o el nombre ya existen, falla sin tocar nada.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { ZodError } from "zod";
import { prisma } from "../src/lib/db";
import { crearEmpresa, EmpresaYaExisteError } from "../src/core/features/empresa/crear-empresa";

async function main() {
  const { values } = parseArgs({
    options: {
      nombre: { type: "string" },
      slug: { type: "string" },
      email: { type: "string" },
      "zona-horaria": { type: "string" },
      moneda: { type: "string" },
      sucursal: { type: "string" },
    },
    strict: true,
  });

  const resultado = await crearEmpresa(prisma, {
    nombre: values.nombre ?? "",
    slug: values.slug ?? "",
    emailPrimerAdmin: values.email ?? "",
    zonaHoraria: values["zona-horaria"] ?? "",
    moneda: values.moneda ?? "",
    ...(values.sucursal ? { nombreSucursal: values.sucursal } : {}),
  });

  console.log(`Empresa "${resultado.slug}" creada y ACTIVE (id ${resultado.empresaId}).`);
  console.log(`Primer admin (gerente): ${resultado.emailPrimerAdmin}. Carta pública: /carta-publica/${resultado.slug}/...`);
}

main()
  .catch((error: unknown) => {
    if (error instanceof EmpresaYaExisteError) console.error(`Error: ${error.message}`);
    else if (error instanceof ZodError) console.error(`Argumentos inválidos:\n${error.issues.map((i) => `  --${String(i.path[0])}: ${i.message}`).join("\n")}`);
    else console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
