import "server-only";
import { documentoBuscadoDesdeTexto } from "@/core/datos/documento-de-parte";
import type { Db } from "@/lib/db-tipos";

/**
 * Búsqueda de fichas de parte (ficha única de personas y empresas; docs/diseno-parte-2026-11-12.md §3.5, comando CU4; igual que Pedernal: por NOMBRE y por DOCUMENTO). Mismo contrato que el resto de `server/consultas/`:
 * `server-only`, SIN guarda de permiso (la hace la página o la acción con `partes_ver` antes de llamar), último parámetro `db: Db` (la base del contexto: la RLS deja solo las fichas de la empresa).
 *
 * El texto que parece un documento (CUIT con o sin guiones, DNI con o sin puntos) busca por la clave `documentoNormalizado`; cualquier texto busca además por nombre, apellido o alias (sin acentos ni mayúsculas: la misma
 * normalización que la columna calculada `nombreBusqueda`, aplicada por la base al texto buscado). Orden: documento idéntico primero, después los que EMPIEZAN con el texto, después los que lo CONTIENEN; dentro de cada
 * grupo por nombre y por id (estable). Las inactivas solo si se piden. Devuelve a lo sumo `limite` fichas (tope 50) y SOLO lo necesario para elegirla: nombre, documento y estado; el resto de los datos personales
 * (correo, teléfono, domicilio, nota) no sale en un listado. Una ficha «pendiente de completar» (sin naturaleza: viene de un proveedor sin CUIT válido) se marca. Sin cursor todavía (etapa (c)).
 */
export const LIMITE_MAXIMO_DE_BUSQUEDA_DE_PARTES = 50;

export interface FichaEncontrada {
  id: string;
  nombre: string;
  apellido: string | null;
  alias: string | null;
  documentoTipo: string | null;
  documentoNumero: string | null;
  estado: string;
  pendienteDeCompletar: boolean;
}

const NORMALIZAR = `lower(translate(%s, 'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç', 'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc'))`;

export async function buscarPartes(args: { empresaId: string; texto: string; incluirInactivas?: boolean; limite?: number }, db: Db): Promise<FichaEncontrada[]> {
  const texto = args.texto.trim();
  const limite = Math.min(Math.max(Math.trunc(args.limite ?? LIMITE_MAXIMO_DE_BUSQUEDA_DE_PARTES), 1), LIMITE_MAXIMO_DE_BUSQUEDA_DE_PARTES);
  const documento = texto === "" ? null : documentoBuscadoDesdeTexto(texto);
  const incluirInactivas = args.incluirInactivas === true;
  return db.$queryRawUnsafe<FichaEncontrada[]>(
    `WITH q AS (SELECT ${NORMALIZAR.replace("%s", "$2::text")} AS n)
     SELECT p."id"::text AS id, p."nombre", p."apellido", p."alias", p."documentoTipo", p."documentoNumero", p."estado", (p."naturaleza" IS NULL) AS "pendienteDeCompletar"
       FROM "Parte" p, q
      WHERE p."empresaId" = $1
        AND ($4::boolean OR p."estado" = 'ACTIVA')
        AND ($2::text = ''
             OR ($3::text IS NOT NULL AND p."documentoNormalizado" = $3::text)
             OR p."nombreBusqueda" LIKE '%' || replace(replace(replace(q.n, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')
      ORDER BY (p."documentoNormalizado" IS NOT DISTINCT FROM $3::text AND $3::text IS NOT NULL) DESC,
               (p."nombreBusqueda" LIKE replace(replace(replace(q.n, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%') DESC,
               p."nombreBusqueda", p."id"
      LIMIT $5::int`,
    args.empresaId,
    texto,
    documento,
    incluirInactivas,
    limite,
  );
}
