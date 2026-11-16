# Checklist previo al despliegue de «Ocultar» (preparado, NO ejecutado) — 2026-11-16

**Estado:** documento de preparación. Nada de esto se ejecutó contra ninguna base real. Las migraciones de «Ocultar» **no están aplicadas en ninguna base real** (solo en bases locales descartables); aplicarlas requiere **autorización expresa del dueño, base por base, con respaldo y ensayo en una rama de Neon** (regla vigente desde 2026-11-15: «migraciones aditivas y reversibles», aplicar en bases reales sigue congelado). Diseño: `docs/diseno-ocultar-como-pedernal-2026-11-15.md`. PR de las etapas posteriores a la tabla: c2 #315, c3 #320, c4 #317, tarjeta #347, uuid #359 (el núcleo puro fue #293; el número del PR de la tabla no lo verifiqué).

## 1. Las cuatro migraciones, en orden de aplicación

| Orden | Carpeta (`prisma/migrations/`) | Qué hace | `down.sql` | `verificacion-previa.sql` |
|---|---|---|---|---|
| 1 | `20261115120000_ocultamiento_de_producto` | Crea la tabla `OcultamientoProducto` (id TEXT con CHECK uuid, índices únicos parciales, FK compuestas, RLS por empresa, privilegios sin DELETE) | Sí. **ABORTA si hay filas** (se perderían las marcas) | Sí |
| 2 | `20261115121000_rls_sucursal_ocultamiento_de_producto` | 4 políticas RESTRICTIVE de alcance por sucursal (salida exacta del generador) | Sí (borra las 4 políticas: regresión de seguridad, no de datos) | **No tiene** (ver §4: consultas de catálogo para el ensayo) |
| 3 | `20261115160000_producto_oculto_no_suma_existencia` | Función `rechazar_suma_a_producto_oculto()` (SECURITY DEFINER) y disparador `MovimientoStock_producto_oculto_trg` BEFORE INSERT | Sí (saca el control; no toca filas) | Sí |
| 4 | `20261117150000_ocultamiento_id_uuid_nativo` | `id` pasa de TEXT+CHECK a `UUID` nativo | Sí (vuelve a TEXT y repone el CHECK; no pierde datos) | Sí |

Prerrequisitos: el rol `motor2_app` existe (`scripts/operaciones/crear-rol-motor2-app.sql`) y la migración B1 (`app_sucursales_lectura()/escritura()`) está aplicada; sin ellos, `CREATE POLICY` falla y la migración no se aplica.

## 2. ORDEN DE ROLLBACK (el inverso exacto)

Bajar **de a una**, en este orden, cada una a mano **como dueño** con `psql -1 -v ON_ERROR_STOP=1 -f <down.sql>`, y verificar (§3) entre una y otra:

1. **`20261117150000_ocultamiento_id_uuid_nativo`** (uuid → TEXT + CHECK). Va primero: las demás dependen de la tabla ya en su forma original.
2. **`20261115160000_producto_oculto_no_suma_existencia`** (disparador y función). Va antes que la RLS y la tabla: la función lee `OcultamientoProducto`.
3. **`20261115121000_rls_sucursal_ocultamiento_de_producto`** (las 4 políticas de sucursal). Se baja ANTES que la tabla.
4. **`20261115120000_ocultamiento_de_producto`** (la tabla). **Aborta si hay marcas cargadas**: con marcas, decidir antes (el dueño) si se aceptan perder; la auditoría (`RegistroAuditoria`, entidad `OcultamientoProducto`) las conserva, pero no alcanza para reconstruir el estado.

Cada `down.sql` es idempotente (bajarlo dos veces no falla). Cada uno es **seguro con la tabla vacía** y solo el 4º tiene una condición (el aborto con filas). El código de la aplicación (a partir de #293/#315/#317/#347) **lee y escribe la tabla**: antes de bajar las migraciones hay que **volver a una versión de la aplicación que no la use** (Instant Rollback de Vercel a un despliegue anterior a la etapa) o dejar de ofrecer la tarjeta; bajar la tabla con la app nueva en línea rompe las pantallas que la leen (la ficha falla cerrado y oculta la tarjeta, pero la venta y el stock la consultan).

## 3. Verificación (correr ANTES y DESPUÉS de cada paso, en cada base, y guardar la salida)

Solo lectura, desde `psql` como dueño:

- Etapa 1 (tabla) y 4 (uuid): `prisma/migrations/20261115120000_ocultamiento_de_producto/verificacion-previa.sql` y `prisma/migrations/20261117150000_ocultamiento_id_uuid_nativo/verificacion-previa.sql`. Esperado tras la 4: `tipo_de_id = uuid`, sin el CHECK `OcultamientoProducto_id_uuid_chk`, `ids_que_no_son_uuid = 0`, mismos índices únicos y misma cantidad de marcas que antes.
- Etapa 3 (disparador): `prisma/migrations/20261115160000_producto_oculto_no_suma_existencia/verificacion-previa.sql`. Esperado tras subir: la función y el disparador existen (BEFORE INSERT FOR EACH ROW sobre `MovimientoStock`, SECURITY DEFINER); antes de subir, no existen. Mirar también cuántos productos ocultos tienen saldo distinto de cero (el disparador solo frena entradas nuevas, no toca saldos).

## 4. Etapa 2 (RLS de sucursal): no tiene `verificacion-previa.sql`

**Pendiente declarado:** esa migración no trae su archivo de verificación. Mientras tanto, en el ensayo correr:

```sql
SELECT policyname::text, cmd, roles::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'OcultamientoProducto' ORDER BY 1;
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public."OcultamientoProducto"'::regclass;
```

Esperado con las migraciones 1 y 2 aplicadas: 5 políticas (`aislamiento_empresa` y `alcance_sucursal_select|insert|update|delete`), RLS activa y no forzada. Tras bajar la 2: solo `aislamiento_empresa`.

## 5. Ensayo previo (rama de Neon) — pasos, no ejecutados

1. Respaldo / rama de Neon de la base de destino.
2. Aplicar las 4 migraciones en orden (§1) y correr las verificaciones (§3 y §4).
3. Ensayo **subir / bajar / subir**: con 15 marcas sintéticas, bajar en el orden de §2 y volver a subir; comparar el catálogo (columnas, índices, políticas, privilegios, disparadores) antes y después. Los tests equivalentes contra bases temporales existen: `test/aislamiento/ocultamiento-de-producto-subir-bajar-subir.test.ts`, `test/aislamiento/producto-oculto-no-suma-existencia.test.ts` y `test/aislamiento/ocultamiento-id-uuid-nativo-subir-bajar-subir.test.ts`.
4. **Costo del disparador con volumen real de Kardex** (NO medido): el disparador agrega, en cada INSERT con cantidad positiva en `MovimientoStock`, un `FOR KEY SHARE` sobre la fila de `Producto` y una consulta por índice a las marcas. Medirlo en la rama de Neon con carga parecida a la real antes de aplicarlo en producción.
5. Prueba funcional en la rama: ocultar un producto sin existencia (queda «Oculto»); con existencia (rechaza con «Primero dejá la existencia en 0.»); venta/cuenta/entrada de stock sobre un oculto (se rechazan con «Este producto está oculto.» o por el disparador).

## 6. Advertencias y pendientes declarados

- **`prisma migrate resolve --rolled-back` y migraciones ya aplicadas:** los `down.sql` de este repo terminan indicando ese comando; el orquestador anotó que **falla con migraciones ya aplicadas** (hay que borrar la fila de la migración en `_prisma_migrations` después de correr el `down.sql`). **NO VERIFICADO por esta sesión**: confirmarlo en el ensayo y fijar el procedimiento exacto antes del despliegue (afecta a los 94 `down.sql` del repo, no solo a estos cuatro).
- **El `down.sql` de la tabla aborta con filas** (por diseño). No hay reversa «con datos» sin decisión del dueño.
- **El orden de aplicación es por nombre de carpeta**: las cuatro respetan el orden lexicográfico (`…120000 < …121000 < …160000 < 20261117150000`); otras migraciones intermedias (Partes, Presentaciones, Caja, Planes…) no tocan esta tabla.
- **Techos de la matriz de denegación** que quedaron como deuda (no afectan el despliegue): `SIN_GENERADOR` 17/17 y `SIN_MARCA_PROPIA` 37→38.
- **Sin construir** (no pedido): lista de ocultos, filtro «Oculto» y «Oculto con existencia negativa». Sin implementar: rechazo por «conteo abierto» (no se verificó qué es `EstadoConteo.PENDIENTE`).
- Este documento **no autoriza nada**: la autorización de aplicar en cada base real es del dueño, con cita (`docs/registro-de-decisiones.md` si se registra como decisión).
