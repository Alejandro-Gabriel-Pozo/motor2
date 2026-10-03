/**
 * Activa y desactiva módulos vendibles de una empresa (ADR-011/ADR-014/ADR-015) en la base que apunte PLATAFORMA_DATABASE_URL. La lógica vive en
 * `src/core/features/empresa/cambiar-modulos-de-empresa.ts` (valida la clausura, transaccional, con auditoría, testeada); esto solo lee los argumentos.
 * Es la ÚNICA vía para cambiar el registro: ninguna pantalla de la app lo hace, y la base solo deja escribirlo al dueño y a `motor2_plataforma`.
 *
 * Uso: npm run modulos-empresa -- --slug norte --actor operador@plataforma.com [--activar stock,compras] [--desactivar salon]
 *
 * Los módulos se nombran por su id del catálogo (`stock`, `compras`, `traspasos`, `consignacion`, `recetas`, `produccion`, `carta`, `promociones`, `salon`).
 * Activar uno trae solo lo que requiere (Salón trae Stock); desactivar uno que otro activo requiere se rechaza. Conexión: PLATAFORMA_DATABASE_URL o, si no
 * está, DATABASE_URL (con el rol de ejecución falla: no tiene permiso de escritura sobre el registro).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { prismaPlataforma as prisma } from "./cliente-plataforma";
import { cambiarModulosDeEmpresa, ModulosDeEmpresaError } from "../src/core/features/empresa/cambiar-modulos-de-empresa";

function lista(valor: string | undefined): string[] {
  return (valor ?? "").split(",").map((m) => m.trim()).filter(Boolean);
}

async function main() {
  const { values } = parseArgs({
    options: { slug: { type: "string" }, actor: { type: "string" }, activar: { type: "string" }, desactivar: { type: "string" } },
    strict: true,
  });
  if (!values.slug || !values.actor) throw new ModulosDeEmpresaError("Faltan --slug y --actor (el email de quien hace el cambio).");

  const resultado = await cambiarModulosDeEmpresa(prisma, {
    slug: values.slug,
    actorEmail: values.actor,
    activar: lista(values.activar),
    desactivar: lista(values.desactivar),
  });

  const cambios = resultado.cambiados.map((c) => `${c.modulo}: ${c.antes ?? "sin fila"} → ${c.despues}`);
  console.log(
    cambios.length === 0
      ? `Sin cambios: la empresa "${values.slug}" ya estaba así.`
      : `Empresa "${values.slug}" actualizada (${cambios.join("; ")}). Quedó en su auditoría.`,
  );
  console.log(`Vendibles activos: ${resultado.activos.join(", ") || "ninguno"}.`);
  console.log(`La empresa cuenta con: ${resultado.efectivos.join(", ")}.`);
}

main()
  .catch((error: unknown) => {
    if (error instanceof ModulosDeEmpresaError) console.error(`Error: ${error.message}`);
    else console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
