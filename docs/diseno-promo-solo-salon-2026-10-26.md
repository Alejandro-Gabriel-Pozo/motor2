# Diseño: interruptor «solo salón» en las promociones (2026-10-26)

Origen: hallazgo del diseño de convenios (`docs/diseno-clientes-convenios-y-facturacion-externa-2026-10-26.md`, respuesta H1): una promoción activa en una sucursal se muestra siempre en la carta pública; no hay forma de venderla solo en el salón. El dueño confirmó: «hay que arreglar el hallazgo». Este documento resume el plan verificado contra el código (HEAD `c07c6935`).

## 1. Hallazgo verificado
- `wherePromoOfrecidaEn(sucursalId)` (`src/core/carta/promo-sucursal.ts`) es solo `{ activa: true, sucursales: { some: { sucursalId, activa: true } } }`. No hay columna ni filtro por audiencia. `PromoCarta.seccionCartaId` es obligatorio.
- Lo usan: `src/server/lecturas/carta/menu.ts:81` (carta pública vía `lecturas/carta/publica.ts:100`; POS como estructura vía `lecturas/pos/selector-carta.ts:72`; diagnóstico del admin vía `consultas/carta/admin.ts:152,240`), `lecturas/pos/selector-carta.ts:90-91`, `lecturas/pos/promo-para-agregar.ts:59` y `consultas/carta/mantenimiento.ts:119` (contador del hub).
- **Matiz crítico:** el POS ubica sus promos dentro de la carta armada (`core/pos/selector-carta.ts:268` descarta una promo si su sección no está en `carta.secciones`) y `armarMenuCarta` (`core/carta/armar-menu.ts:468`) borra toda sección vacía. Filtrar la promo dentro de `menu.ts` para todos haría desaparecer del POS la sección que solo tiene promos solo-salón. El filtro por audiencia NO puede aplicarse a la llamada del POS.
- Para verse en la carta pública hacen falta: promo activa, fila `PromoCartaSucursal` activa, sección activa, módulo `promociones` contratado y sucursal publicada. No hay atajo con lo que existe (mover la promo a una sección apagada también la saca del POS).
- Otras superficies públicas: no hay JSON-LD ni API de carta; la descripción de metadatos y la carta impresa salen de la misma carta armada (quedan cubiertas con un solo filtro).
- Caché: `unstable_cache` con etiqueta `carta-publica:<empresaSlug>` y 60 s, más ISR; se invalida con `revalidarCartasPublicas(ctx.empresaSlug)` (`src/server/actions/carta/revalidar.ts`) después de confirmar el caso de uso. `VERSION_DE_LA_CARTA_EN_CACHE` no cambia (la forma de `CartaV1` no cambia).
- `PromoCarta.version` solo la usa la vigencia (`guardar-vigencia-promo-carta.ts`). `guardarPromoCarta` no usa versión. Permiso de definir: `carta_promo_definir` (empresa). Auditoría: `registrarCambioAuditado` con entidad `PromoCarta`. RLS `aislamiento_empresa` por fila; sin GRANT por columna.
- Hallazgo aparte (fuera de este plan): la carta pública no respeta la vigencia (`vigenteDesde`, `vigenteHasta`, `diasDeSemana`); una promo «solo martes» se publica todos los días.

## 2. Decisiones
- CONFIRMADA (dueño, 2026-10-26): se arregla el hallazgo con un interruptor «solo salón» en la promo.
- PROPUESTA (se asume salvo que el dueño diga otra cosa): P1 el interruptor es de la empresa (`PromoCarta`), con el permiso `carta_promo_definir`; P2 la promo puede nacer «solo salón» (para que el precio pactado nunca quede publicado ni indexado); P3 tampoco sale en la carta impresa; P4 aviso (sin bloquear) si una promo solo-salón no tiene cupos; P5 respetar la vigencia en la carta pública va en un plan aparte.

## 3. Invariantes
- I1: una promo solo-salón nunca sale en la carta pública (web, QR ni impresa).
- I2: el POS la ofrece igual que hoy.
- I3: con todas las promos en `false`, la carta y el POS no cambian (golden/caracterización sin regenerar).

## 4. Diseño mínimo
**Esquema (migración aditiva; REQUIERE AUTORIZACIÓN EXPRESA para aplicarla a cualquier base real, base por base, con respaldo y ensayo).** `PromoCarta.soloSalon Boolean @default(false)`; `ALTER TABLE "PromoCarta" ADD COLUMN "soloSalon" BOOLEAN NOT NULL DEFAULT false;` sin CHECK, políticas ni GRANT nuevos. `down.sql`: aborta si hay alguna fila con el interruptor prendido (bajarla haría públicas esas promos al volver el código viejo: falla cerrado) y después `DROP COLUMN IF EXISTS`. Patrón: `20261021140000_contenido_carta_mostrar_nombre_arriba`.

**Filtro (un solo embudo, decisión obligatoria).** `export type AudienciaDePromo = "salon" | "publico"`; `wherePromoOfrecidaEn(sucursalId, audiencia)` con el parámetro obligatorio: `"publico"` = lo de hoy + `soloSalon: false`; `"salon"` = exactamente lo de hoy. `resolverMenuCarta` pasa de `conPromos = true` a `promos: AudienciaDePromo | "ninguna" = "publico"` (el default es el público: quien olvide pasarlo ve menos, nunca más). `publica.ts` pasa `"publico"`/`"ninguna"` (conservar el texto `resolverMenuCarta(sucursalId, db,` que muta un test de arquitectura); el POS pasa `"salon"` explícito en `selector-carta.ts:72`, `:90-91`, `promo-para-agregar.ts:59` y `mantenimiento.ts:119`; `consultas/carta/admin.ts` queda con el default.

**Caso de uso aparte (no dentro de `guardarPromoCarta`, que no tiene versión: si no, un administrador con pantalla vieja apagaría en silencio el «solo salón» que otro acaba de prender).** `guardarSoloSalonPromoCarta` con comando `{ promoCartaId, versionEsperada, soloSalon }`, `conPermisoDeEmpresa("carta_promo_definir")`, `conTransaccionSerializable`: (1) leer id/título/versión/soloSalon, si no está → `PROMO_NO_ENCONTRADA`; (2) si ya tiene el valor pedido → éxito sin cambio (sin escribir, auditar ni revalidar; va antes del chequeo de versión para que un doble clic no muestre «otra persona la cambió»); (3) versión distinta → `VERSION_DESACTUALIZADA`; (4) `updateMany WHERE {id, version}` con `version: { increment: 1 }`, 0 filas → `VERSION_DESACTUALIZADA`; (5) `registrarCambioAuditado` (`PromoCarta`, campo `soloSalon`, valor anterior y nuevo, actor). La acción revalida `revalidarCartasPublicas` solo si hubo cambio y después de confirmar.

**Pantalla** (`carta/parametrizacion/promociones`): bloque «Dónde se ve» dentro de cada promo con la primitiva `Casilla` («Solo salón: se vende desde el POS, pero no aparece en la carta pública (web, QR ni impresa)», ayuda «Útil para un menú pactado con una empresa: el precio no queda publicado.») y botón «Guardar dónde se ve»; sin permiso, un `Dato` de solo lectura; «· solo salón» en el resumen; aviso de texto si no tiene cupos. `soloSalon` se agrega a `cargarCombosDeLaCarta` (no a `cargarAdminCarta`, cuyo golden `lecturas-tramo-a.golden.json` no debe cambiar). La alta de promo permite crearla ya «solo salón».

## 5. ¿Qué pasa si…?
Doble clic: el segundo pedido encuentra el valor puesto y devuelve éxito sin auditoría duplicada. Dos administradores opuestos: SERIALIZABLE + `updateMany WHERE version`, gana uno. Comparte `version` con la vigencia (rechazo conservador y documentado). Otra empresa: RLS + `findFirst` por id. Permisos: en el servidor. Módulo `promociones` apagado: sin cambios. Caché: se revalida después de confirmar. Pasarla a «solo salón» la saca de la carta pública en el próximo pedido (no se controla una pestaña ya abierta, lo impreso ni lo indexado). Despliegue: la migración va ANTES que el código (aditiva: código viejo con columna nueva no pasa nada; al revés Prisma falla al leer la columna).

## 6. Pasos (un commit cada uno; tests con mutaciones mutar→rojo→revertir→verde)
0. Línea de base de los 8 comandos y conteos.
1. Caracterización de promos en carta pública y POS (verde antes y después, sin regenerar).
2. Esquema y migración + `down.sql` + test de migración (a la base de test local; **nada a Neon sin autorización expresa**).
3. Filtro por audiencia (parámetro obligatorio) + guardián «ningún archivo de la entrada pública contiene `"salon"`» + tests: la carta pública NO muestra la promo (ni la sección que solo la tenía), el POS SÍ, el default falla cerrado.
4. Caso de uso y acción (guard, persistencia, auditoría, generador de denegación, registros de arquitectura) + tests: permisos, otra empresa, idempotencia, versión vieja, concurrencia real con `Promise.all`, auditoría, `revalidateTag`.
5. Pantalla + test de render.
6. Alta de promo ya «solo salón».
7. e2e `carta-promo-solo-salon.spec.ts`.
8. Documentación (marcar el hallazgo resuelto en el diseño de convenios, nota en ADR-032).

## 7. Verificación final
Los 8 comandos (`npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`) en la misma corrida, limpios, con conteos iguales a la línea de base más los tests nuevos y ningún golden regenerado.

## 8. Estado de la implementación (2026-10-27)
Pasos 1 a 8 hechos en la rama del carril (un commit por paso): caracterización, esquema y migración, filtro por audiencia con su guardián, caso de uso y acción, pantalla «Dónde se ve», alta ya «solo salón», e2e `carta-promo-solo-salon.spec.ts` y esta documentación. Detalles que el plan no fijaba: el mensaje de versión desactualizada termina en «Recargá la pantalla…» para que el formulario ofrezca «Recargar»; la casilla del alta vive en el formulario de la página y no en `CamposPromo` (compartido con la edición); el guard rechaza (no ignora) `soloSalon` en una edición; el precio local de la promo pasó a `CampoNumero` (deuda del cerco `campo-type-number`). La migración NO se aplicó a ninguna base real: requiere autorización expresa, base por base, con respaldo y ensayo.
