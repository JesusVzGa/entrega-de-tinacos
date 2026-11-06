# Entrega de Tinacos

Aplicación para registrar entregas por mesa, con datos de la persona beneficiaria, fotografías y ubicación. El código corresponde al proyecto publicado con Sites.

## Funciones incluidas

- Pantalla de acceso de administrador y operador.
- Administrador con contraseña comprobada en el servidor; operador con nombre, sin contraseña.
- Sesiones de 12 horas, cookies HttpOnly/Secure/SameSite=Strict, cierre de sesión y límite de intentos de contraseña.
- Mesas I a XVI y folios consecutivos independientes asignados por el servidor: II-1, II-2, etc.
- Operación SQL atómica para numeración e identificador de solicitud para evitar duplicados al reintentar.
- Foto completa de la INE y foto de entrega vinculadas al mismo folio.
- OCR local en español con vista previa, giro y selección de áreas.
- Revisión y corrección manual de nombre y dirección antes de guardar.
- Ubicación al tomar o seleccionar la foto de evidencia.
- Nombre del operador asociado al registro.
- Contador, historial, fotografías y exportación exclusivos del administrador.
- Historial paginado de 25 registros, con filtro por mesa y búsqueda de folio en el servidor.
- Reporte general con una sola hoja “Totales por mesa”: entregas de las 16 mesas y su suma, sin desglose de fotos ni registros anteriores sin mesa.
- Excel por mesa con imágenes de entrega e INE, operador, datos y mapa. Cada archivo tiene hasta 100 entregas; las mesas más grandes se descargan por partes ordenadas por consecutivo.
- Conservación del historial anterior; los registros antiguos no tienen foto INE.

## Arquitectura

| Componente | Tecnología |
| --- | --- |
| Interfaz | React y TypeScript |
| Servidor y compilación | Vinext, Vite y Cloudflare Workers |
| Base de datos | Cloudflare D1, basada en SQLite |
| Fotografías | Cloudflare R2, mediante rutas protegidas |
| Esquema y migraciones | Drizzle ORM / Drizzle Kit |
| OCR en el dispositivo | Tesseract.js |
| Excel | ExcelJS |
| Dependencias | pnpm y lockfile versionado |

D1 guarda entregas, consecutivos, datos capturados, coordenadas, operador, indicador de INE, sesiones y límites de intentos. Los tokens de sesión se almacenan como hash.

R2 guarda las imágenes JPEG de la entrega y de la INE en claves distintas. Las rutas de consulta comprueban la sesión de administrador en el servidor.

## Estructura

- app/page.tsx: acceso, captura, historial y Excel.
- components/login-screen.tsx: formularios de acceso.
- components/ine-reader.tsx: OCR y selección de áreas.
- app/api/session/route.ts: inicio, comprobación y cierre de sesión.
- app/api/entregas/route.ts: guardado, historial y consulta de fotos.
- lib/app-session.ts: sesiones y validación del acceso.
- lib/delivery.ts: mesas, tipos y extracción de campos.
- lib/ine-image.ts: preparación de imágenes.
- db/schema.ts y drizzle/: esquema y migraciones.
- .openai/hosting.json: identidad del sitio y bindings de publicación.
- worker/ y scripts/: integración del servidor y herramientas.

## Configuración

| Nombre | Tipo |
| --- | --- |
| DB | Binding de Cloudflare D1 |
| BUCKET | Binding de Cloudflare R2 |
| ADMIN_PASSWORD | Secreto del servidor |

La contraseña real está configurada en el servidor y no forma parte del repositorio. No añadirla al código cliente ni al manifiesto de hosting.

Para instalar en otro entorno se necesitan recursos propios de base de datos, almacenamiento y secretos. El manifiesto identifica el sitio original; conservar esa identidad al actualizarlo y configurar una identidad distinta para un despliegue independiente.

## Desarrollo

Requisitos: Node.js compatible con package.json y pnpm. Las pruebas del servidor usan node:sqlite, disponible en Node.js 24.

    pnpm install
    pnpm exec tsc --noEmit
    node scripts/test-deliveries.mjs
    node scripts/test-ine.mjs
    pnpm build

La compilación copia el motor y el modelo OCR español desde las dependencias hacia public/ocr/ usando scripts/prepare-ocr.mjs. Esos archivos generados están excluidos de Git.

Para iniciar desarrollo:

    pnpm dev

El entorno local necesita ejecutar el runtime de Cloudflare y aplicar las migraciones a su base local. Los datos locales y de producción son independientes. Las herramientas de Sites también necesitan un perfil de ejecución configurado para el checkout.

## Migraciones y datos

Los cambios futuros del esquema deben generar migraciones nuevas:

    pnpm db:generate

No modificar migraciones ya aplicadas. La publicación original en Sites aplica las migraciones pendientes a D1.

Este repositorio no contiene registros de producción, fotografías de INE, fotografías de entrega ni la contraseña de administración. La migración de información requiere exportaciones independientes de D1 y R2.

## Limitación conocida del OCR

El OCR propone datos y requiere revisión humana. La prueba con una fotografía real de INE produjo datos incompletos y texto ajeno tanto en lectura completa como por área: ese caso no se considera resuelto.

La aplicación permite escribir y corregir nombre y domicilio, y guardar la foto completa independientemente del resultado del OCR.

## Restablecer registros

El administrador dispone de “Restablecer registros y fotos”. Requiere escribir RESTABLECER y pulsar “Borrar definitivamente”. Elimina permanentemente las entregas de D1 y las fotos de INE, evidencia e históricas de R2. Reinicia los folios por mesa; conserva la configuración de acceso. Durante el proceso se bloquean las capturas y se rechazan capturas iniciadas antes del reinicio. El borrado de fotos se realiza en lotes y se puede reanudar desde el mismo botón si se interrumpe. No se ejecutó sobre datos de producción durante las pruebas.

## Validaciones realizadas

Antes de la última publicación funcional se comprobaron:

- Compilación de producción y tipos TypeScript.
- Acceso del administrador y operador, tanto en pruebas como en el sitio.
- Sesiones, cookies, caducidad, cierre y rechazo de tokens falsos.
- Bloqueo del historial y ambas fotos para operadores y visitantes sin sesión.
- Guardado de ambas imágenes, validaciones y atribución del operador.
- Folios por mesa, concurrencia y reintentos sin duplicados.
- Conservación del historial anterior.
- Recorrido de 2,500 registros ficticios en 100 páginas, sin duplicados; filtros, resumen de mesas y exportaciones estables frente a nuevas capturas.
- Lectura de vuelta del Excel de resumen para comprobar sus 16 mesas y total general.
- Extracción OCR sobre datos de prueba y documentación de su limitación real.

Las pruebas automatizadas usan SQLite en memoria, almacenamiento de prueba y datos ficticios; no generan entregas en producción.
