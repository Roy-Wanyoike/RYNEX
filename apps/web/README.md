# RYNEX Web (apps/web)

Vanilla TypeScript/JavaScript static site served straight out of `src/`. No bundler —
TypeScript is compiled **in place**, so `src/login/login.ts` emits `src/login/login.js`
right beside `login.html`.

## Prerequisites

- Node.js (any recent LTS)
- The RYNEX backend running (default API base: `http://localhost:4000`)

## Build

```bash
cd apps/web
npm install   # installs TypeScript 4.9.5 (devDependency)
npx tsc       # compiles every src/**/*.ts to src/**/*.js (same folder)
```

Other scripts:

```bash
npm run build       # same as npx tsc
npm run watch       # tsc -w — recompiles on save
npm run typecheck   # tsc --noEmit — check only, no files written
```

Compiled `*.js` files are gitignored (`.gitignore` covers `apps/web/src/**/*.js`,
with negations for the hand-written `Home/index.js`, `Admin/script.js`,
`cart/cart.js`, `cart/products.js`, `api/api.js`, `api/ui.js`) — never commit them.

## Run

Any static server rooted at **`apps/web/src`** works:

```bash
cd apps/web
npx serve src
# then open http://localhost:3000/login/login.html (port per your server)
```

Or use the VS Code **Live Server** extension with its root set to `apps/web/src`,
or `python3 -m http.server` from inside `apps/web/src`.

## API base URL

`src/api/api.js` defaults to `http://localhost:4000`. To override, set the global
**before** `api.js` loads (i.e. in a `<script>` placed above it):

```html
<script>window.__API_BASE__ = 'https://api.example.com';</script>
<script src="../api/api.js"></script>
```

## Seeded logins

| Username | Password    | Role  |
|----------|-------------|-------|
| `admin`  | `Admin123$` | admin |
| `john`   | `John1234$` | user  |

## Page script load order (convention)

Every page that talks to the API loads, before its own script:

```html
<script src="../api/api.js"></script>
<script src="../api/ui.js"></script>
<script src="./<page>.js"></script>   <!-- compiled from <page>.ts -->
```

Pages that override the API base must set `window.__API_BASE__` above those tags.
