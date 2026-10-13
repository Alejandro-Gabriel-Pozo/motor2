-- Paquete 3, M3b (segunda parte; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): la RECEPCIÓN de la mercadería por sucursal en `FacturaProveedorSucursal` (cambio del dueño, 2026-10-12).
--
-- REGLA DE NEGOCIO: el stock de una factura entra recién cuando la factura está REPARTIDA (cabecera `CONFIRMADA`, no `PENDIENTE_DE_REPARTO`) Y la parte de esa sucursal está RECIBIDA. Al cargar la factura el usuario elige, para cada
-- sucursal, «recibida» (entra al stock con la fecha de recepción elegida) o «pendiente» (se confirma después desde la bandeja «mercadería por recibir», que es de la Etapa C). Las partes sin mercadería con stock (solo gastos, M4) las crea
-- la aplicación directamente RECIBIDA. Que la cabecera esté confirmada cuando se recibe NO lo puede decidir esta tabla (mira otra fila): lo valida el caso de uso.
--
-- Columnas nuevas (todas en la parte de la sucursal): `estadoRecepcion` TEXT NOT NULL DEFAULT 'PENDIENTE' (CHECK: PENDIENTE o RECIBIDA), `recibidaEn` TIMESTAMP(3) NULL (UTC; es la FECHA DE STOCK elegida) y `recibidaPorId` (FK a User).
-- CHECK: RECIBIDA si y solo si hay `recibidaEn`, y `recibidaPorId` va junto con `recibidaEn`.
--
-- UPDATE SOLO POR COLUMNA sobre esas tres (el resto de la parte sigue sin UPDATE: solo se agrega) y un DISPARADOR que permite ÚNICAMENTE la transición PENDIENTE a RECIBIDA: una parte ya recibida no vuelve atrás ni cambia de fecha ni de
-- persona (se corrige anulando, como siempre). El disparador rige para TODOS los roles, también el dueño (no se puede saltear escribiendo SQL a mano). Repetir la misma recepción (mismos valores) es inofensivo.
--
-- CONCURRENCIA E IDEMPOTENCIA: dos confirmaciones de recepción a la vez de la misma parte dejan UNA sola. La guarda es `UPDATE ... WHERE "estadoRecepcion" = 'PENDIENTE'`: la segunda transacción espera a la primera, vuelve a evaluar la fila
-- al confirmar la primera y no encuentra ninguna (0 filas): el caso de uso entra stock SOLO si el UPDATE tocó una fila, así que repetir no duplica stock. Además la unicidad de `operacionId` (M3b) impide que dos operaciones reclamen la misma parte.
--
-- Va entre M3b y M3c: la política de UPDATE por sucursal de M3c (salida exacta del generador) cubre estas columnas sin cambios. ADITIVA: el código anterior no lee ni escribe las columnas (la tabla está vacía hasta la Etapa C). Las partes que ya
-- existieran (ninguna: nada las escribe) quedarían PENDIENTE.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261016101500_factura_proveedor_recepcion`). DESTRUCTIVA si ya hay recepciones: se pierde cuándo y quién
-- recibió cada parte (el stock que ya entró NO se toca). Bajar ANTES M3c? No hace falta (las políticas de M3c no dependen de estas columnas), pero el orden de la reversa de M3 es M3e, M3d, M3c, esta, M3b, M3a.

ALTER TABLE "FacturaProveedorSucursal"
  ADD COLUMN "estadoRecepcion" TEXT NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN "recibidaEn" TIMESTAMP(3),
  ADD COLUMN "recibidaPorId" TEXT;

ALTER TABLE "FacturaProveedorSucursal" ADD CONSTRAINT "FacturaProveedorSucursal_recibidaPorId_fkey" FOREIGN KEY ("recibidaPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FacturaProveedorSucursal" ADD CONSTRAINT "FacturaProveedorSucursal_estado_recepcion_chk" CHECK ("estadoRecepcion" IN ('PENDIENTE', 'RECIBIDA'));
ALTER TABLE "FacturaProveedorSucursal" ADD CONSTRAINT "FacturaProveedorSucursal_recepcion_coherente_chk" CHECK (("estadoRecepcion" = 'RECIBIDA') = ("recibidaEn" IS NOT NULL));
ALTER TABLE "FacturaProveedorSucursal" ADD CONSTRAINT "FacturaProveedorSucursal_recibida_por_chk" CHECK (("recibidaEn" IS NULL) = ("recibidaPorId" IS NULL));

-- El disparador: de PENDIENTE a RECIBIDA sí (una vez); cualquier otro cambio de las tres columnas, no. Un UPDATE que deja las tres como estaban pasa (idempotente).
CREATE FUNCTION "FacturaProveedorSucursal_recepcion_solo_pendiente_a_recibida"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."estadoRecepcion" = 'RECIBIDA'
     AND (NEW."estadoRecepcion" IS DISTINCT FROM OLD."estadoRecepcion" OR NEW."recibidaEn" IS DISTINCT FROM OLD."recibidaEn" OR NEW."recibidaPorId" IS DISTINCT FROM OLD."recibidaPorId") THEN
    RAISE EXCEPTION 'una parte ya RECIBIDA no vuelve atrás ni cambia de fecha ni de persona (se corrige anulando)'
      USING ERRCODE = '23514', CONSTRAINT = 'FacturaProveedorSucursal_recepcion_transicion_chk', TABLE = 'FacturaProveedorSucursal';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "FacturaProveedorSucursal_recepcion_transicion_chk"
  BEFORE UPDATE OF "estadoRecepcion", "recibidaEn", "recibidaPorId" ON "FacturaProveedorSucursal"
  FOR EACH ROW EXECUTE FUNCTION "FacturaProveedorSucursal_recepcion_solo_pendiente_a_recibida"();

-- Privilegios: UPDATE solo de esas tres columnas (si el rol existe; en una base de test o recién creada puede no estar).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT UPDATE ("estadoRecepcion", "recibidaEn", "recibidaPorId") ON "FacturaProveedorSucursal" TO motor2_app;
  END IF;
END
$$;
