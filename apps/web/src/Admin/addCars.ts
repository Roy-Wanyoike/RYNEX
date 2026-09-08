/*
 * apps/web/src/Admin/addCars.ts
 * ---------------------------------------------------------------------------
 * Admin "Add Cars" page script (plain browser TypeScript, NO import/export —
 * compiled to addCars.js next to addCars.html by the build workflow).
 *
 * Required script load order (see addCars.html):
 *   <script src="../api/api.js"></script>   -> window.api  (auto Bearer token)
 *   <script src="../api/ui.js"></script>    -> window.ui   (toast/form helpers)
 *   <script src="./addCars.js"></script>    -> this page
 *
 * Backend contract (services/vehicles-api, port 4000):
 *   POST /products                       (admin, Bearer)
 *        { model, bodyType, brand, prices: number > 0, pictureUrl? }
 *        -> 201 { success: true, data: carRow }
 *   GET  /products/getproducts           (public)
 *        -> 200 { success: true, data: [{ carId, model, bodyType, brand,
 *                                         prices, pictureUrl, isDeleted }] }
 *   POST /products/softdeletecar/:carId  (admin, Bearer) -> 200 { success: true }
 *
 * Security notes:
 *   - All API values are rendered via textContent (no innerHTML) -> XSS-safe.
 *   - carId is encodeURIComponent-escaped before it touches a URL path.
 * ---------------------------------------------------------------------------
 */

/* --------------------------------- types --------------------------------- */

/** Envelope returned by every vehicles-api endpoint. */
interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
}

/** A car row as returned by GET /products/getproducts (values untrusted). */
interface CarRow {
  carId?: unknown;
  model?: unknown;
  bodyType?: unknown;
  brand?: unknown;
  prices?: unknown;
  pictureUrl?: unknown;
  isDeleted?: unknown;
}

/** Shape of window.api provided by ../api/api.js. */
interface ApiHelper {
  API_BASE: string;
  get<T = unknown>(path: string): Promise<ApiEnvelope<T>>;
  post<T = unknown>(path: string, body?: unknown): Promise<ApiEnvelope<T>>;
  getToken(): string | null;
  getUser(): unknown;
}

/** Shape of window.ui provided by ../api/ui.js. */
interface UiHelper {
  toast(message: string, type?: 'info' | 'success' | 'error'): void;
  showFormError(container: HTMLElement, message: string): void;
  clearFormError(container: HTMLElement): void;
  setButtonLoading(button: HTMLButtonElement, loading: boolean): void;
}

/* Merge the optional globals exposed by api.js / ui.js onto window typing. */
interface Window {
  api?: ApiHelper;
  ui?: UiHelper;
}

/* -------------------------------- constants ------------------------------- */

/** Number of columns in the catalogue table (for colspan of status rows). */
const CAR_TABLE_COLUMNS = 5;

/** Where to go after a car is added successfully. */
const ADMIN_DASHBOARD_URL = '../Admin/admin.html';

/** How long the success toast stays visible before redirecting (ms). */
const REDIRECT_DELAY_MS = 800;

/* ------------------------------ page bootstrap ---------------------------- */

document.addEventListener('DOMContentLoaded', () => {
  const api = window.api;
  const ui = window.ui;

  // api.js / ui.js must be loaded first; without them the page cannot work.
  if (!api || !ui) {
    replacePanelWithMessage('Page helpers failed to load. Please refresh and try again.');
    return;
  }

  // Admin guard: needs a token AND localStorage 'user' with isAdmin === true.
  if (!isAdminSignedIn(api)) {
    replacePanelWithMessage('Admin access required');
    return;
  }

  wireAddCarForm(api, ui);
  void loadCars(api, ui);
});

/* ------------------------------- admin guard ------------------------------ */

/**
 * True only when a token exists in localStorage AND the stored 'user' JSON
 * parses to an object with isAdmin === true.
 */
function isAdminSignedIn(api: ApiHelper): boolean {
  if (!api.getToken()) {
    return false;
  }
  const user: unknown = api.getUser();
  if (!user || typeof user !== 'object') {
    return false;
  }
  return (user as { isAdmin?: unknown }).isAdmin === true;
}

/** Replaces the form/table panel with a single status message. */
function replacePanelWithMessage(message: string): void {
  const panel =
    document.getElementById('adminCarsPanel') ||
    (document.querySelector('main') as HTMLElement | null);
  if (!panel) {
    return;
  }
  panel.textContent = ''; // remove form + table, keep the surrounding layout
  const note = document.createElement('p');
  note.setAttribute(
    'style',
    'margin-top: 5%; font-size: 18px; font-weight: 700; color: #dc2626;'
  );
  note.textContent = message; // textContent: no HTML injection
  panel.appendChild(note);
}

/* ------------------------------ add-car form ------------------------------ */

/** Wires the add-car form: validation, POST /products, toast + redirect. */
function wireAddCarForm(api: ApiHelper, ui: UiHelper): void {
  const form = document.getElementById('formCars') as HTMLFormElement | null;
  if (!form) {
    return;
  }
  const submitBtn = document.getElementById('addCarBtn') as HTMLButtonElement | null;

  form.addEventListener('submit', (event: Event) => {
    event.preventDefault();
    void submitAddCar(api, ui, form, submitBtn);
  });
}

/** Validates the form, posts the car, toasts and redirects on success. */
async function submitAddCar(
  api: ApiHelper,
  ui: UiHelper,
  form: HTMLFormElement,
  submitBtn: HTMLButtonElement | null
): Promise<void> {
  ui.clearFormError(form);

  const model = readInput('model');
  const bodyType = readInput('bodyType');
  const brand = readInput('brand');
  const pictureUrl = readInput('pictureUrl');

  const pricesInput = document.getElementById('prices') as HTMLInputElement | null;
  const pricesText = pricesInput ? pricesInput.value.trim() : '';
  const prices = Number(pricesText);

  if (!model || !bodyType || !brand) {
    ui.showFormError(form, 'Model, body type and brand are required.');
    return;
  }
  if (pricesText === '' || !Number.isFinite(prices) || prices <= 0) {
    ui.showFormError(form, 'Price must be a number greater than 0.');
    return;
  }

  const payload = {
    model: model,
    bodyType: bodyType,
    brand: brand,
    prices: prices, // number > 0 (backend validates too)
    pictureUrl: pictureUrl !== '' ? pictureUrl : undefined
  };

  if (submitBtn) {
    ui.setButtonLoading(submitBtn, true);
  }
  try {
    await api.post('/products', payload);
    ui.toast('Car added successfully.', 'success');
    window.setTimeout(() => {
      window.location.href = ADMIN_DASHBOARD_URL;
    }, REDIRECT_DELAY_MS);
    form.reset();
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'Failed to add car. Please try again.';
    ui.showFormError(form, message);
  } finally {
    if (submitBtn) {
      ui.setButtonLoading(submitBtn, false);
    }
  }
}

/* --------------------------- car catalogue table --------------------------- */

/** Fetches GET /products/getproducts and renders the #carList table body. */
async function loadCars(api: ApiHelper, ui: UiHelper): Promise<void> {
  const tbody = document.getElementById('carListBody') as HTMLTableSectionElement | null;
  if (!tbody) {
    return;
  }
  setTableMessage(tbody, 'Loading cars...');
  try {
    const envelope = await api.get<CarRow[]>('/products/getproducts');
    const cars = Array.isArray(envelope.data) ? envelope.data : [];
    renderCars(tbody, cars, api, ui);
  } catch (err) {
    const message =
      err instanceof Error && err.message ? err.message : 'Failed to load cars.';
    setTableMessage(tbody, message);
  }
}

/** Rebuilds the table body from API data (textContent only — XSS-safe). */
function renderCars(
  tbody: HTMLTableSectionElement,
  cars: CarRow[],
  api: ApiHelper,
  ui: UiHelper
): void {
  tbody.textContent = '';

  const activeCars = cars.filter((car) => !isDeletedRow(car));
  if (activeCars.length === 0) {
    setTableMessage(tbody, 'No cars in the catalogue yet.');
    return;
  }
  for (const car of activeCars) {
    tbody.appendChild(createCarRow(car, api, ui));
  }
}

/** Soft-deleted rows from the API are skipped defensively. */
function isDeletedRow(car: CarRow): boolean {
  return car.isDeleted === 1 || car.isDeleted === true || car.isDeleted === '1';
}

/** Builds one <tr> for a car. */
function createCarRow(
  car: CarRow,
  api: ApiHelper,
  ui: UiHelper
): HTMLTableRowElement {
  const tr = document.createElement('tr');

  tr.appendChild(createCell(text(car.model)));
  tr.appendChild(createCell(text(car.brand)));
  tr.appendChild(createCell(text(car.bodyType)));
  tr.appendChild(createCell(formatPrice(car.prices)));

  const actionTd = document.createElement('td');
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove';
  removeBtn.textContent = 'Remove';

  const carId = text(car.carId);
  if (carId === '') {
    removeBtn.disabled = true;
  } else {
    removeBtn.addEventListener('click', () => {
      void removeCar(carId, text(car.model), removeBtn, api, ui);
    });
  }
  actionTd.appendChild(removeBtn);
  tr.appendChild(actionTd);

  return tr;
}

/** Confirms, soft-deletes via POST /products/softdeletecar/:carId, refreshes. */
async function removeCar(
  carId: string,
  model: string,
  button: HTMLButtonElement,
  api: ApiHelper,
  ui: UiHelper
): Promise<void> {
  const label = model !== '' ? `"${model}"` : 'this car';
  if (!window.confirm(`Remove ${label} from the catalogue?`)) {
    return;
  }
  ui.setButtonLoading(button, true);
  try {
    await api.post('/products/softdeletecar/' + encodeURIComponent(carId), {});
    ui.toast('Car removed from the catalogue.', 'success');
    await loadCars(api, ui); // re-render replaces the row (button included)
  } catch (err) {
    ui.setButtonLoading(button, false);
    const message =
      err instanceof Error && err.message ? err.message : 'Failed to remove car.';
    ui.toast(message, 'error');
  }
}

/* ------------------------------- DOM helpers ------------------------------- */

/** Reads + trims the current value of an input by id ('' when missing). */
function readInput(id: string): string {
  const input = document.getElementById(id) as HTMLInputElement | null;
  return input ? input.value.trim() : '';
}

/** Creates a <td> holding plain text (never HTML). */
function createCell(content: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = content;
  return td;
}

/** Replaces the table body with a single full-width status row. */
function setTableMessage(tbody: HTMLTableSectionElement, message: string): void {
  tbody.textContent = '';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = CAR_TABLE_COLUMNS;
  td.className = 'empty';
  td.textContent = message;
  tr.appendChild(td);
  tbody.appendChild(tr);
}

/** Coerces untrusted API values to a display string ('' for null/undefined). */
function text(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

/** Formats prices with toLocaleString; falls back to the raw value. */
function formatPrice(prices: unknown): string {
  const num = typeof prices === 'number' ? prices : Number(prices);
  return Number.isFinite(num) ? num.toLocaleString() : text(prices);
}
