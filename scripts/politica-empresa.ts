/**
 * Cambia la política de plataforma de una empresa (add-on, ADR-008/ADR-010) en la base que apunte DATABASE_URL. La lógica vive en
 * `src/core/features/empresa/cambiar-politica-empresa.ts` (transaccional, con auditoría, testeada); esto solo lee los argumentos. Es la ÚNICA
 * vía para cambiarla: ninguna pantalla de la app lo hace.
 *
 * Uso: npm run politica-empresa -- --slug norte --actor operador@plataforma.com [--plan lite|completo] \
 *        [--permisos-editables si|no] [--dos-paneles si|no]
 *
 * `--plan` fija las dos perillas de una vez (`lite`: sin edición de permisos y menú único; `completo`: todo activo); las perillas sueltas se
 * aplican después y lo pisan. DATABASE_URL debe ser el rol `motor2_app`, igual que en `crear-empresa`.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { prisma } from "../src/lib/db";
import { cambiarPoliticaDeEmpresa, PoliticaDeEmpresaError } from "../src/core/features/empresa/cambiar-politica-empresa";
import { PLANES, type NombreDePlan } from "../src/core/permisos/politica-de-empresa";

function siONo(valor: string | undefined, opcion: string): boolean | undefined {
  if (valor === undefined) return undefined;
  if (valor === "si") return true;
  if (valor === "no") return false;
  throw new PoliticaDeEmpresaError(`--${opcion} acepta "si" o "no" (llegó "${valor}").`);
}

function plan(valor: string | undefined): NombreDePlan | undefined {
  if (valor === undefined) return undefined;
  if (valor in PLANES) return valor as NombreDePlan;
  throw new PoliticaDeEmpresaError(`--plan acepta ${Object.keys(PLANES).join(" o ")} (llegó "${valor}").`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      slug: { type: "string" },
      actor: { type: "string" },
      plan: { type: "string" },
      "permisos-editables": { type: "string" },
      "dos-paneles": { type: "string" },
    },
    strict: true,
  });
  if (!values.slug || !values.actor) throw new PoliticaDeEmpresaError("Faltan --slug y --actor (el email de quien hace el cambio).");

  const permisosEditables = siONo(values["permisos-editables"], "permisos-editables");
  const dosPaneles = siONo(values["dos-paneles"], "dos-paneles");
  const planElegido = plan(values.plan);

  const resultado = await cambiarPoliticaDeEmpresa(prisma, {
    slug: values.slug,
    actorEmail: values.actor,
    ...(planElegido ? { plan: planElegido } : {}),
    ...(permisosEditables !== undefined ? { permisosEditables } : {}),
    ...(dosPaneles !== undefined ? { dosPaneles } : {}),
  });

  const { permisosEditables: edita, dosPaneles: paneles } = resultado.politica;
  const queda = `permisos editables: ${edita ? "sí" : "no"}, dos paneles: ${paneles ? "sí" : "no"}`;
  console.log(
    resultado.cambiadas.length === 0
      ? `Sin cambios: la empresa "${values.slug}" ya estaba así (${queda}).`
      : `Empresa "${values.slug}" actualizada (${resultado.cambiadas.join(", ")}). Ahora: ${queda}. Quedó en su auditoría.`,
  );
}

main()
  .catch((error: unknown) => {
    if (error instanceof PoliticaDeEmpresaError) console.error(`Error: ${error.message}`);
    else console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
