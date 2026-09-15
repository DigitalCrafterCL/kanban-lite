# Servidor de tableros compartidos

Backend **opcional** de Kanban Lite. La aplicación no lo necesita para nada:
sin servidores dados de alta el cliente jamás toca la red. Esto sólo añade la
posibilidad de que varias personas trabajen sobre los mismos tableros.

Cero dependencias npm: sólo `node:http`, `node:sqlite` y `node:crypto`.
Requiere **Node 22 o superior** (por `node:sqlite`).

## Puesta en marcha

```bash
# 1. Crear el primer usuario (pide la contraseña por consola)
node server/index.js --db ./kanban.db --create-user carlos

# 2. Arrancar
node server/index.js --db ./kanban.db --port 8090
#    o bien: npm run server -- --db ./kanban.db --port 8090
```

Los demás se conectan desde la app: **⊞ Tableros → + Conectar a un servidor**,
con la dirección (`192.168.1.50:8090`), su usuario y su contraseña.

Para compartir un tablero: créalo desde **+ Tablero** en el bloque del servidor
y luego invita gente con el botón **👥**.

## Opciones

| Opción | Qué hace |
|---|---|
| `--port <n>` | Puerto de escucha (8090) |
| `--host <ip>` | Interfaz (0.0.0.0) |
| `--db <ruta>` | Archivo SQLite (`./kanban.db`) |
| `--token-days <n>` | Vigencia de la sesión en días (30) |
| `--serve` | Servir también `dist/index.html` en `/` |
| `--create-user <nombre>` | Crear usuario |
| `--set-password <nombre>` | Cambiar contraseña (cierra sus sesiones) |
| `--list-users` | Listar usuarios |
| `--password <clave>` | Contraseña no interactiva, para scripts |
| `--init` | Permitir crear la base de datos si no existe |
| `--list-boards` | Listar tableros con su versión actual |
| `--history <id\|nombre>` | Ver el histórico de versiones de un tablero |
| `--restore <id\|nombre> --to-version <n>` | Volver un tablero a una versión archivada |

> **Cuidado con `--db`.** Si se omite, la ruta por defecto es `./kanban.db`
> **relativa al directorio actual**. Apuntar al sitio equivocado creaba una base
> vacía y el usuario acababa en un archivo que el servicio nunca lee, sin
> ningún error. Por eso los comandos de usuario ahora se niegan a crear una
> base nueva salvo que se pase `--init`. En el servidor desplegado usa el
> atajo `kanban-admin`, que ya lleva la ruta correcta.

## Cómo se fusionan los cambios

Cada tablero tiene una `version` entera que sube con cada cambio aceptado, y
cada tarjeta y cada frente guardan la versión en la que cambiaron por última
vez.

El cliente compara su estado actual contra una instantánea de su última
sincronización, manda **sólo lo que cambió** y recibe el tablero fusionado. Dos
personas que tocan tarjetas distintas nunca se pisan.

Cuando dos tocan **la misma** tarjeta gana quien llega último al servidor, y la
respuesta marca esa tarjeta como conflicto para que la app avise. No se usa el
reloj del cliente en ningún momento: sólo el orden de llegada, así que la
desincronización de relojes entre máquinas es irrelevante.

Los borrados dejan una lápida con su versión, de modo que un cliente
desactualizado no pueda resucitar una tarjeta que otro ya eliminó.

## Cuando algo sale mal

Cada sincronización aceptada archiva el estado anterior antes de reemplazarlo,
así que **ningún error es irreversible**. Se conservan las últimas 100
versiones de cada tablero.

```bash
kanban-admin --history "Mi tablero"
kanban-admin --restore "Mi tablero" --to-version 6
```

Restaurar no borra nada: crea una versión nueva con el contenido antiguo, y los
clientes se la traen en su siguiente sondeo.

Además, el servidor **frena** cualquier sincronización que borre a la vez 5 o
más elementos y al menos la mitad del tablero. Casi siempre eso significa que
un cliente tiene una copia desincronizada, no que alguien quiera vaciar el
tablero. El cliente lo indica con «⚠ frenada» junto al estado y ofrece dos
salidas: descartar la copia local y traer la del servidor (segura), o subir de
todos modos con confirmación explícita.

## Varias pestañas a la vez

Cada pestaña recuerda su propio tablero, así que puedes tener un tablero en una y
otro en otra sin que se pisen. Si dos pestañas abren el **mismo** tablero,
cada una se entera de los cambios de la otra y recarga.

## API

Todas las rutas van bajo `/api` y piden `Authorization: Bearer <token>`, salvo
el login.

| Método | Ruta | Rol |
|---|---|---|
| `POST` | `/api/login` | — |
| `POST` | `/api/logout` | cualquiera |
| `GET` | `/api/me` | cualquiera |
| `GET` | `/api/boards` | cualquiera (`?deleted=1`: papelera del dueño) |
| `POST` | `/api/boards` | cualquiera |
| `GET` | `/api/boards/:id` | lectura (soporta `If-None-Match`) |
| `POST` | `/api/boards/:id/sync` | edición (`confirmDestructive` para forzar) |
| `GET` | `/api/boards/:id/history` | lectura |
| `GET` | `/api/boards/:id/log` | lectura (bitácora; `?limit=`, máx. 100) |
| `POST` | `/api/boards/:id/restore` | dueño |
| `DELETE` | `/api/boards/:id` | dueño (borrado suave; `?purge=1` definitivo) |
| `POST` | `/api/boards/:id/undelete` | dueño |
| `GET` | `/api/boards/:id/members` | lectura |
| `POST` | `/api/boards/:id/members` | dueño |
| `DELETE` | `/api/boards/:id/members/:userId` | dueño |

## Borrado suave

Eliminar un tablero marca `deleted_at`: desaparece para todo el equipo —todas
las rutas responden `404`, así que ningún cliente puede seguir escribiendo en
él— pero su estado, sus miembros y su histórico siguen en la base. El dueño lo
recupera desde la app («Tableros eliminados en el servidor») o por consola:

```bash
node server/index.js --db /srv/kanban/data/kanban.db --list-deleted
node server/index.js --db /srv/kanban/data/kanban.db --undelete "Equipo"
```

El borrado real necesita `?purge=1` (o `--purge`) y sólo funciona sobre un
tablero **ya eliminado**: un tablero vivo no se puede destruir en una sola
operación, ni por error ni a propósito.

## Bitácora

`GET /api/boards/:id/log` devuelve quién cambió qué en cada versión. No hay una
tabla de eventos: la bitácora se **deriva** comparando cada estado archivado en
`board_history` con el siguiente, de modo que no puede desincronizarse del
tablero real ni sobrevivir a un `--restore`. La fila archivada de la versión N
guarda el estado anterior al cambio y el autor que lo provocó, así que la
transición N → N+1 es una entrada de la bitácora. El alcance es el del
histórico: las últimas 100 versiones.

## Seguridad: lo que hace y lo que no

Hace:

- Contraseñas con `scrypt` y sal por usuario; comparación en tiempo constante.
- Los tokens se guardan hasheados con SHA-256, nunca en claro.
- Limitador de intentos de login por IP y usuario.
- Quien no es miembro de un tablero recibe `404`, no `403`: no se filtra
  siquiera que el tablero exista.
- El servidor sanea todo lo que entra y asigna él las versiones. Un cliente no
  puede imponer una versión ni colar campos desconocidos.
- `Access-Control-Allow-Origin: *` sin cookies: el token va en la cabecera, así
  que no hay autoridad ambiental que un origen `null` (páginas abiertas con
  `file://`) pueda aprovechar.

No hace:

- **No habla HTTPS.** Está pensado para una LAN o una VPN. Si lo expones a
  internet, ponle delante un proxy con TLS (Caddy, nginx) — sobre HTTP plano
  las contraseñas y los tokens viajan legibles.
- No hay registro público: los usuarios se crean desde la consola a propósito.
- No hay backups automáticos fuera de la máquina. El histórico de versiones
  protege de errores de uso, no de perder el disco: copia el `.db` (y sus
  `-wal`/`-shm`) tú.

## Pruebas

```bash
npm test            # pruebas de fusión y de API
npm run test:browser # dos navegadores reales contra el servidor real
```
