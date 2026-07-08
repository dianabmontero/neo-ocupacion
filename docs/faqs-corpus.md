---
source: bot-faqs-neo.md
source_url: # TODO pegar link Notion cuando esté
last_updated: 2026-07-01
scope: soporte-operativo-NEO
audience: country-manager, staff-NEO
---

# Preguntas frecuentes — Soporte NEO

Guía para resolver las dudas más comunes de operación. Cada respuesta te dice **qué pasa, qué podés hacer vos**, y **cuándo conviene reportarnos** al equipo.

**Cómo reportar cuando algo no se resuelve solo:** mandanos **ID del cliente, hora exacta, sede, qué pasó y una captura o video**. Si es un problema de un usuario, pedile que además genere un reporte desde la app: **Perfil → Soporte → Crear un reporte**.

---

## Glosario mínimo

Términos que aparecen en estas FAQ. Si alguno te suena raro, empezá por acá.

- **Sede:** un gimnasio físico de NEO. Cada sede tiene su propia configuración de horarios, amenities, precios y salas. En el código se llama `Location`; el usuario ve *sede*.
- **Pase (NEO Pass):** ticket de acceso general a una sede, válido el día de compra. Su precio es dinámico según la ocupación real y esperada de la sede.
- **QR de acceso:** el QR dinámico del usuario. Se regenera cada 10 segundos. **El mismo QR sirve para entrar a la sede, entrar a una actividad, y salir.**
- **Molinete:** el lector físico de QR en la entrada de la sede. Los ingresos y egresos que quedan contados oficialmente son los que pasan por el molinete.
- **Check-in:** registro de que el usuario entró a la sede escaneando su QR por el molinete. Es lo que cuenta para los beneficios (ej. mes gratis).
- **Clase / Servicio / Espacio:** los tres tipos de reserva.
  - *Clase:* actividad grupal con horario (yoga, spinning).
  - *Servicio:* atención 1-a-1 (masaje, recovery).
  - *Espacio:* alquiler de un lugar físico (sala de boxeo, sauna, phonebooth). **A diferencia de clase y servicio, el espacio tiene precio fijo desde EVO — no se le aplica el recargo del 30 %.**
- **Amenity:** una comodidad de la sede (wifi, estacionamiento, vestuarios, sauna). Se edita desde el NEO Admin.
- **EVO:** el software externo (CRM del gimnasio). Fuente de verdad para planes, horarios de sede, empleados, actividades y cobros. NEO se sincroniza contra EVO — muchas cosas se editan **allá**, no en NEO Admin.
- **NEO Admin:** el panel propio de NEO (web) para publicar sedes, editar amenities y configurar cierres. **No es el mismo lugar que EVO.**
- **Cierre de sede:** fecha programada en la que la sede no opera (feriado, mantenimiento). Si se crea a **15 días o menos** de la fecha, se considera "no programado" (también "espontáneo") y dispara mails a usuarios con reservas afectadas.
- **Beneficio de mes gratis:** después de **8 actividades en el mes** (check-ins + reservas completadas), el usuario tiene acceso gratis el resto del mes. *Nota:* documentación vieja menciona 12 — el valor vigente es 8.
- **Reposición / cambio de reserva:** el único cambio pago permitido por reserva (a otro horario dentro del mismo grupo y mismo precio). Se usa "cambio" en la app; EVO lo llama "reposición".
- **Reembolso:** en NEO, refiere al movimiento *interno* de entitlement (recuperar la reserva), **no al dinero volviendo a la tarjeta**. NEO no devuelve plata al cancelar.

---

## Precios

### "El precio no coincide con la ocupación de la sede."
<!-- faq_id: faq-precios-mezcla-ocupacion | source_url: TODO -->
El precio del pase **mezcla la ocupación real del momento con la ocupación esperada** para esa hora:
- Si la sede está **más vacía de lo esperado**, el usuario paga un precio intermedio (más bajo).
- Si está **igual o más llena de lo esperado**, paga el precio real.
- En los **últimos 15 minutos de cada hora**, el precio ya empieza a acercarse al esperado de la **hora siguiente** (por eso a veces parece “adelantarse”).

🚩 Si con esto el monto sigue sin tener sentido, es probable que la **tabla de ocupación esperada de esa sede** esté mal cargada → **reportanos** con la hora exacta y una captura.

### "Una clase cuesta menos que el pase."
<!-- faq_id: faq-precios-clase-menor-que-pase | source_url: TODO -->
No debería: las clases y servicios cuestan **un 30 % más que el pase** (los espacios se rigen por precio fijo desde EVO, no aplica). Si ves una clase o servicio por debajo del pase, es una **mala configuración del plan en EVO** → revisá en **EVO (Planes)** que tenga el plan correcto y tome la tarifa dinámica. Si no lo podés corregir, reportanos.

---

## Accesos y QR

### "Al comprar aparece 'Tiempo agotado'."
<!-- faq_id: faq-accesos-tiempo-agotado | source_url: TODO -->
La compra tiene una ventana de **5 minutos**. Lo más común es que **el reloj del celular esté desfasado** (adelantado/atrasado): la app usa la hora del teléfono, así que salta “tiempo agotado” al instante.
- **Solución:** pedile al usuario poner **fecha y hora en automático** y volver a intentar.
- Evitá borrar y recrear la cuenta (puede duplicar el usuario en EVO).

🚩 Si con la hora corregida sigue pasando → reportanos con el ID.

### "El QR de un empleado no abre las salas / abre todas / aparece bloqueado."
<!-- faq_id: faq-accesos-qr-empleado | source_url: TODO -->
Para habilitar a un empleado, **autorizá su correo corporativo `@theneoplex.com`** en la app; con eso el QR abre todos los pórticos.

🚩 Si ya está autorizado y el QR abre salas que no corresponden o aparece bloqueado → reportanos con el correo del empleado y en qué lectores lo probaron.

---

## Ocupación y beneficios

### "La ocupación que muestra la app no coincide con la real."
<!-- faq_id: faq-ocupacion-no-coincide | source_url: TODO -->
La ocupación se cuenta con las entradas y salidas por los **molinetes**. Si hay gente que ingresó **manualmente (abriendo desde EVO)** o por un lector que no registró, la app va a mostrar menos personas de las que hay.
- **Qué revisar:** que todos ingresen escaneando su QR por el molinete.

🚩 Si todos entraron por QR y aun así no coincide → reportanos con captura de EVO y de la app.

### "El usuario tiene 12 check-ins pero la app no le da el pase gratis."
<!-- faq_id: faq-beneficio-mes-gratis-no-activa | source_url: TODO -->
El beneficio de acceso gratis se activa a las **8 actividades dentro del mismo mes** (cuentan tanto check-ins como reservas completadas de clase/servicio/espacio). Si el usuario tiene los ingresos pero la app muestra menos, es porque **algunos accesos no quedaron registrados como check-in** (ingresos manuales o que no pasaron por molinete).

🚩 Reportanos con el ID del cliente para revisar sus registros.

---

## Tarjetas y app

### "El usuario no puede registrar la tarjeta / dice 'servicio no disponible temporalmente'."
<!-- faq_id: faq-tarjeta-servicio-no-disponible | source_url: TODO -->
La mayoría de los rechazos son por **tarjeta inválida o fondos insuficientes** (la app muestra un mensaje más específico). Si el mensaje es de “servicio no disponible”, que reintente en unos minutos.

🚩 Si persiste, reportanos con el ID del cliente.

### "La app pide actualizar, pero ya está actualizada / no aparece en la tienda."
<!-- faq_id: faq-app-pide-actualizar | source_url: TODO -->
Pedile al usuario **cerrar y volver a abrir** la app, y revisar la tienda.

🚩 Si el mensaje sigue con la app ya actualizada → reportanos con el modelo de teléfono y una captura.

---

## Configuración (dónde se hace cada cosa)

### "Aparecen salas / amenities / estacionamiento que no corresponden en la app."
<!-- faq_id: faq-config-salas-amenities-incorrectas | source_url: TODO -->
- **Amenities** (wifi, estacionamiento, etc.): se editan desde el **NEO Admin** y el cambio es **inmediato**.
- **Salas / actividades**: vienen de **EVO**. Si una sala aparece sin ofertas, es porque está creada en EVO sin horario o plan → hay que **deshabilitarla o ponerle candado**.

### "¿Dónde defino el precio de los phonebooths y las salas?"
<!-- faq_id: faq-config-precio-espacios | source_url: TODO -->
En **EVO → Planes** (el precio de los espacios es fijo y se define ahí). Mientras un espacio no tenga precio real definido, **no publiques su reserva**.
> El precio dinámico del **pase** no se toca en EVO: lo gestiona el equipo de NEO/Amalgama. Si el pase muestra un precio raro, reportanos.

### "¿Dónde cambio el horario de una sede?"
<!-- faq_id: faq-config-horario-sede | source_url: TODO -->
En **EVO → Administración → Horarios de funcionamiento → Agenda** (importante que sea en *Agenda*). El horario **no** se cambia desde el NEO Admin (ahí solo se editan los amenities).

### "¿El usuario puede cambiar su reserva por otra clase?"
<!-- faq_id: faq-reserva-cambio | source_url: TODO -->
Sí: puede cambiarla por cualquier actividad **del mismo grupo y con el mismo precio**, y hasta **1 vez por reserva**. En EVO esto se llama *reposición*.

### "Creé un cierre de sede y se dispararon mails / se cerró un día de más."
<!-- faq_id: faq-cierre-sede-mails | source_url: TODO -->
Al crear un cierre, **se les avisa por mail a los usuarios con reservas afectadas** en ese rango. Además, si el cierre se crea a **15 días o menos** de la fecha, se considera *no programado* (o *espontáneo*) y dispara flujos de reembolso interno. Por eso, **revisá bien las fechas de inicio y fin** antes de confirmar (no tomar un día de más). Las reservas fuera del rango no se ven afectadas.

---

## Admin panel

### "¿Cuál es la diferencia entre modo Activa, Próxima a abrir y Marcha blanca?"
<!-- faq_id: faq-admin-modos-publicacion | source_url: TODO -->
Los tres modos definen cómo se comporta una sede publicada en la app:
- **Activa:** sede inaugurada. Compras + reservas habilitadas a precio real.
- **Próxima a abrir:** sede aún no inaugurada, se abre dentro de los **próximos 15 días**. Se ve en la app y **permite reservas futuras**, pero **no permite comprar pases**. La fecha de apertura debe estar dentro de esos 15 días y no puede ser anterior a la fecha configurada en EVO.
- **Marcha blanca:** sede operativa en fase de prueba. **Todas las transacciones se procesan a $0.** Requiere fecha de inicio y fecha de fin. Al finalizar, la sede pasa automáticamente a *Activa*.

🚩 Si un usuario reporta que no puede comprar un pase en una sede específica, chequeá primero si esa sede está en modo *Próxima a abrir* — es el comportamiento esperado, no un bug.

### "Publiqué una sede como Activa y ahora quiero cambiarla a Próxima a abrir."
<!-- faq_id: faq-admin-cambiar-a-proxima-a-abrir | source_url: TODO -->
No se puede: el modo *Próxima a abrir* solo está disponible **durante la publicación inicial** de la sede. Una vez publicada, los cambios de modo posibles son entre *Activa* y *Marcha blanca* (en ambas direcciones), pero no a *Próxima a abrir*.

🚩 Si necesitás forzar el estado *Próxima a abrir* en una sede ya publicada, reportanos con el ID de la sede y el motivo.

### "¿Qué es una sede promocional? ¿Cuándo la uso?"
<!-- faq_id: faq-admin-sede-promocional-que-es | source_url: TODO -->
Una **sede promocional** es una sede que se muestra en la app para **difusión anticipada, antes de que exista en EVO**. Los usuarios la ven, pero **no pueden comprar pases ni hacer reservas** en ella. Se crea directamente desde el Admin (tab *Promocionadas*), sin pasar por EVO. Solo requiere **nombre** + **foto de portada**.

Se usa cuando queremos comunicar que una sede va a abrir en el futuro cercano, sin tener aún la configuración operativa en EVO.

### "¿Cuándo tengo que eliminar una sede promocional?"
<!-- faq_id: faq-admin-sede-promocional-eliminar | source_url: TODO -->
🚨 **Importante:** eliminá la sede promocional **una vez que la sede fue creada en EVO** y va a publicarse como sede regular. Si no la eliminás, va a aparecer **duplicada** en la app (la promocional + la real).

La eliminación se hace desde *Sedes → tab Promocionadas → detalle → Eliminar*. **La acción no se puede deshacer** — la sede promocional desaparece de la app inmediatamente.

### "Despubliqué una sede sin querer — ¿perdí los datos que había cargado?"
<!-- faq_id: faq-admin-despublicar-datos | source_url: TODO -->
No, **los datos se conservan**. Cuando despublicás una sede, pasa a la tab *Sin publicar* con estado *Datos completados*. Todos los campos que habías completado (imagen de portada, amenities, capacidad máxima) siguen ahí. Podés volver a publicarla en cualquier momento sin cargar de nuevo la info.

### "Estoy en Marcha blanca y las transacciones salen a $0 — ¿es un bug?"
<!-- faq_id: faq-admin-marcha-blanca-cero | source_url: TODO -->
No es un bug — es el **diseño del modo Marcha blanca**. Se usa para pruebas operativas internas antes de abrir la sede al público real; por eso todas las compras y reservas se procesan a **$0**. Al finalizar la fecha de fin configurada, la sede pasa automáticamente a *Activa* y las transacciones vuelven a precio real.

🚩 Si estás en Marcha blanca y necesitás procesar cobros reales para una prueba puntual, no se puede desde el Admin — reportanos.

### "Los números de Métricas del Admin no coinciden con EVO — ¿por qué?"
<!-- faq_id: faq-admin-metricas-vs-evo | source_url: TODO -->
Las métricas del Admin **se alimentan desde Metabase**, no directamente de EVO. Puede haber un **delay entre lo que EVO registra y lo que Metabase reporta** en el Admin. Además, los filtros de **sede** y **período** en el Admin afectan a todos los números — asegurate de que ambos filtros estén configurados igual antes de comparar contra EVO.

🚩 Si con los mismos filtros y esperando el refresh de Metabase (típicamente unos minutos) la diferencia sigue, reportanos con captura de ambos.

### "¿Puedo cambiar el precio dinámico de una sede desde el Admin?"
<!-- faq_id: faq-admin-precio-dinamico | source_url: TODO -->
Todavía no: la funcionalidad de **editar la planilla de precios dinámicos** está en el roadmap del Admin pero **aún no está disponible**. Por ahora, los precios dinámicos los gestiona el equipo de NEO/Amalgama directamente en el sistema.

🚩 Si un cliente necesita un ajuste de precio dinámico para una sede específica, reportanos con la sede afectada y el ajuste deseado.
