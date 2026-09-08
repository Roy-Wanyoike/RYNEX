/*
 * apps/web/src/cars/cars.ts — RYNEX cars discovery page.
 *
 * Plain browser script (no import/export). Compiled to ./cars.js next to
 * cars.html and loaded AFTER ../api/api.js and ../api/ui.js, which provide
 * the window.api / window.ui globals (see src/api/).
 *
 * Behaviour:
 *   - GET /products/getproducts on load; soft-deleted rows (isDeleted) are
 *     filtered out when the flag is present; results render into #carsGrid.
 *   - "Add to Cart" -> POST /cart { carId, quantity: 1 }. api.js attaches the
 *     Bearer token; the server resolves brand+price, so prices are NEVER sent.
 *     Without a token: ui.toast('Please log in first','error') + redirect to
 *     the login page. api.js rejects with a user-safe message on 401s (e.g.
 *     'Session expired. Please log in again.') which is shown via toast.
 *   - "Get Quote"   -> pure-DOM modal with the car's data + a
 *     'Proceed to login to reserve' CTA. No libraries.
 *   - Optional filter bar: brand text input + body-type select refetch via
 *     /products/getcarbrand/:brand and /products/getcarbodyshape/:bodyType.
 *     There is no combined endpoint, so when BOTH filters are set the full
 *     catalogue is refetched and filtered client-side. Empty results show
 *     'No cars found' (the filter endpoints also answer 404 'No cars found').
 *
 * All server-driven text is written via createElement/textContent — API data
 * is never interpolated into HTML strings.
 */
(function () {
  'use strict';

  interface CarsCarRow {
    carId: string;
    model: string;
    bodyType: string;
    brand: string;
    prices: number;
    pictureUrl: string;
    isDeleted?: boolean | number | string;
  }

  interface CarsApiEnvelope {
    success: boolean;
    message: string;
    data?: unknown;
  }

  interface CarsApi {
    get(path: string): Promise<CarsApiEnvelope>;
    post(path: string, body: unknown): Promise<CarsApiEnvelope>;
    getToken(): string | null;
    isLoggedIn(): boolean;
  }

  interface CarsUi {
    toast(message: string, type?: 'info' | 'success' | 'error'): void;
    setButtonLoading(button: HTMLButtonElement, loading: boolean): void;
  }

  var FALLBACK_IMAGE = '../images/logo.png';
  var LOGIN_URL = '../login/login.html';
  var BRAND_DEBOUNCE_MS = 350;

  // Page element references, resolved once in init().
  var carsGrid: HTMLElement | null = null;
  var carsStatus: HTMLElement | null = null;
  var brandInput: HTMLInputElement | null = null;
  var bodyTypeSelect: HTMLSelectElement | null = null;
  var quoteModal: HTMLElement | null = null;
  var quoteModalImage: HTMLImageElement | null = null;
  var quoteModalCta: HTMLButtonElement | null = null;
  var quoteCar: CarsCarRow | null = null;
  var brandTimer: number | undefined = undefined;

  // ---------------------------------------------------------------- helpers

  function getApi(): CarsApi {
    const api = (window as { api?: CarsApi }).api;
    if (!api) {
      throw new Error('API helper not loaded. Please refresh the page.');
    }
    return api;
  }

  function getUi(): CarsUi {
    const ui = (window as { ui?: CarsUi }).ui;
    if (!ui) {
      throw new Error('UI helper not loaded. Please refresh the page.');
    }
    return ui;
  }

  function setText(id: string, value: string): void {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  }

  function clearChildren(el: HTMLElement): void {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function setStatus(message: string): void {
    if (!carsStatus) {
      return;
    }
    carsStatus.textContent = message;
    carsStatus.removeAttribute('hidden');
  }

  function clearStatus(): void {
    if (!carsStatus) {
      return;
    }
    carsStatus.textContent = '';
    carsStatus.setAttribute('hidden', '');
  }

  // ------------------------------------------------------------- data shape

  function isCarRow(row: unknown): row is CarsCarRow {
    if (typeof row !== 'object' || row === null) {
      return false;
    }
    const r = row as Record<string, unknown>;
    return typeof r.carId === 'string' && typeof r.model === 'string';
  }

  function toCarRows(data: unknown): CarsCarRow[] {
    if (!Array.isArray(data)) {
      return [];
    }
    return data.filter(isCarRow);
  }

  function isDeletedRow(row: CarsCarRow): boolean {
    const flag = row.isDeleted;
    return flag === true || flag === 1 || flag === '1' || flag === 'true';
  }

  // ------------------------------------------------------------ image logic

  /**
   * DB pictureUrl values look like '/images/audiA4.jpg'; this page lives at
   * src/cars/, so strip the leading '/' and prefix '../' -> '../images/...'.
   * Absolute http(s) URLs are passed through untouched.
   */
  function resolveImageUrl(pictureUrl: string): string {
    const raw = (pictureUrl || '').trim();
    if (!raw) {
      return FALLBACK_IMAGE;
    }
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }
    return '../' + raw.replace(/^\/+/, '');
  }

  /**
   * The seed stores '/images/mazdamx5.jpg' but the shipped file is
   * mazdamx5.jpeg — compute the '.jpeg' variant for the onerror chain.
   */
  function swapToJpeg(src: string): string {
    if (/\.jpe?g$/i.test(src)) {
      return src.replace(/\.jpe?g$/i, '.jpeg');
    }
    return src;
  }

  /**
   * Sets the image source with a two-stage fallback:
   *   original -> '.jpeg' variant (when it differs) -> logo placeholder.
   * The first fallback candidate is mirrored in the data-fallback attribute.
   */
  function configureImage(img: HTMLImageElement, src: string): void {
    const swapped = swapToJpeg(src);
    img.setAttribute('data-fallback', swapped !== src ? swapped : FALLBACK_IMAGE);
    let triedSwapped = false;
    img.onerror = function (): void {
      if (!triedSwapped && swapped !== src) {
        triedSwapped = true;
        img.src = swapped;
        return;
      }
      img.onerror = null;
      img.src = FALLBACK_IMAGE;
    };
    img.src = src;
  }

  // -------------------------------------------------------------- rendering

  function formatPrice(value: unknown): string {
    const price = Number(value);
    if (!isFinite(price) || price <= 0) {
      return 'Price on request';
    }
    const options: Intl.NumberFormatOptions = Number.isInteger(price)
      ? { maximumFractionDigits: 0 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    return 'KES ' + price.toLocaleString('en-KE', options);
  }

  function buildCard(car: CarsCarRow): HTMLElement {
    const card = document.createElement('article');
    card.className = 'car-card';

    const media = document.createElement('div');
    media.className = 'car-card-media';

    const img = document.createElement('img');
    img.className = 'car-card-image';
    img.setAttribute('alt', (car.model || 'Car') + ' photo');
    img.setAttribute('loading', 'lazy');
    configureImage(img, resolveImageUrl(car.pictureUrl));
    media.appendChild(img);

    const badge = document.createElement('span');
    badge.className = 'car-badge';
    badge.textContent = car.bodyType || 'Car';
    media.appendChild(badge);

    const body = document.createElement('div');
    body.className = 'car-card-body';

    const model = document.createElement('h3');
    model.className = 'car-card-model';
    model.textContent = car.model || 'Unnamed car';

    const brand = document.createElement('p');
    brand.className = 'car-card-brand';
    brand.textContent = car.brand || 'Brand unavailable';

    const price = document.createElement('p');
    price.className = 'car-card-price';
    price.textContent = formatPrice(car.prices);

    const actions = document.createElement('div');
    actions.className = 'car-card-actions';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'car-btn car-btn-add';
    addBtn.textContent = 'Add to Cart';
    addBtn.addEventListener('click', function () {
      void addToCart(car, addBtn);
    });

    const quoteBtn = document.createElement('button');
    quoteBtn.type = 'button';
    quoteBtn.className = 'car-btn car-btn-quote';
    quoteBtn.textContent = 'Get Quote';
    quoteBtn.addEventListener('click', function () {
      openQuoteModal(car);
    });

    actions.appendChild(addBtn);
    actions.appendChild(quoteBtn);
    body.appendChild(model);
    body.appendChild(brand);
    body.appendChild(price);
    body.appendChild(actions);
    card.appendChild(media);
    card.appendChild(body);
    return card;
  }

  function showCars(rows: CarsCarRow[]): void {
    const grid = carsGrid;
    if (!grid) {
      return;
    }
    clearChildren(grid);
    if (rows.length === 0) {
      setStatus('No cars found');
      return;
    }
    clearStatus();
    rows.forEach(function (car) {
      grid.appendChild(buildCard(car));
    });
  }

  function populateBodyTypes(rows: CarsCarRow[]): void {
    const select = bodyTypeSelect;
    if (!select) {
      return;
    }
    // Drop previously generated options, then rebuild from the live catalogue.
    Array.from(select.options).forEach(function (opt) {
      if (opt.getAttribute('data-generated') === '1') {
        select.remove(opt.index);
      }
    });
    const seen: string[] = [];
    rows.forEach(function (car) {
      const bt = (car.bodyType || '').trim();
      if (bt && seen.indexOf(bt) === -1) {
        seen.push(bt);
      }
    });
    seen.sort().forEach(function (bt) {
      const opt = document.createElement('option');
      opt.value = bt;
      opt.textContent = bt;
      opt.setAttribute('data-generated', '1');
      select.appendChild(opt);
    });
  }

  // ---------------------------------------------------------------- actions

  async function addToCart(car: CarsCarRow, button?: HTMLButtonElement): Promise<void> {
    let api: CarsApi;
    let ui: CarsUi;
    try {
      api = getApi();
      ui = getUi();
    } catch (err) {
      console.warn('[cars]', err instanceof Error ? err.message : err);
      return;
    }

    if (!api.getToken()) {
      ui.toast('Please log in first', 'error');
      window.location.assign(LOGIN_URL);
      return;
    }

    if (button) {
      ui.setButtonLoading(button, true);
    }
    try {
      // Server resolves the price from carId — the client only sends quantity.
      await api.post('/cart', { carId: car.carId, quantity: 1 });
      ui.toast('Added to cart', 'success');
    } catch (err) {
      // api.js rejects with a user-safe message (e.g. session-expired 401 text).
      ui.toast(err instanceof Error ? err.message : 'Could not add this car to the cart', 'error');
    } finally {
      if (button) {
        ui.setButtonLoading(button, false);
      }
    }
  }

  function openQuoteModal(car: CarsCarRow): void {
    if (!quoteModal) {
      return;
    }
    quoteCar = car;

    setText('quoteModalTitle', car.model || 'Unnamed car');
    setText('quoteModalBrand', car.brand || 'Brand unavailable');
    setText('quoteModalBodyType', car.bodyType || '—');
    setText('quoteModalPrice', formatPrice(car.prices));

    if (quoteModalImage) {
      configureImage(quoteModalImage, resolveImageUrl(car.pictureUrl));
      quoteModalImage.setAttribute('alt', (car.model || 'Car') + ' photo');
    }

    quoteModal.removeAttribute('hidden');
    if (document.body) {
      document.body.style.overflow = 'hidden';
    }
  }

  function closeQuoteModal(): void {
    if (!quoteModal || quoteModal.hasAttribute('hidden')) {
      return;
    }
    quoteModal.setAttribute('hidden', '');
    if (document.body) {
      document.body.style.overflow = '';
    }
    quoteCar = null;
  }

  // ----------------------------------------------------------------- filters

  function matchesBrand(car: CarsCarRow, brand: string): boolean {
    return (car.brand || '').toLowerCase().includes(brand.toLowerCase());
  }

  function matchesBodyType(car: CarsCarRow, bodyType: string): boolean {
    return (car.bodyType || '').toLowerCase() === bodyType.toLowerCase();
  }

  async function loadCars(): Promise<void> {
    if (!carsGrid) {
      return;
    }
    setStatus('Loading cars…');
    try {
      const res = await getApi().get('/products/getproducts');
      const rows = toCarRows(res.data).filter(function (car) {
        return !isDeletedRow(car);
      });
      populateBodyTypes(rows);
      showCars(rows);
    } catch (err) {
      showCars([]);
      setStatus(err instanceof Error ? err.message : 'Failed to load cars');
    }
  }

  async function applyFilters(): Promise<void> {
    const grid = carsGrid;
    if (!grid) {
      return;
    }
    const brand = brandInput ? brandInput.value.trim() : '';
    const bodyType = bodyTypeSelect ? bodyTypeSelect.value : '';

    if (!brand && !bodyType) {
      void loadCars();
      return;
    }

    setStatus('Loading cars…');
    try {
      let rows: CarsCarRow[];
      if (brand && bodyType) {
        // No combined endpoint exists — refetch the catalogue and filter locally.
        const res = await getApi().get('/products/getproducts');
        rows = toCarRows(res.data).filter(function (car) {
          return !isDeletedRow(car) && matchesBrand(car, brand) && matchesBodyType(car, bodyType);
        });
      } else if (brand) {
        const res = await getApi().get('/products/getcarbrand/' + encodeURIComponent(brand));
        rows = toCarRows(res.data).filter(function (car) {
          return !isDeletedRow(car);
        });
      } else {
        const res = await getApi().get('/products/getcarbodyshape/' + encodeURIComponent(bodyType));
        rows = toCarRows(res.data).filter(function (car) {
          return !isDeletedRow(car);
        });
      }
      showCars(rows);
    } catch (err) {
      // The filter endpoints answer 404 'No cars found' when empty; api.js
      // surfaces that exact message here.
      showCars([]);
      setStatus(err instanceof Error ? err.message : 'Unable to filter cars');
    }
  }

  function resetFilters(): void {
    if (brandInput) {
      brandInput.value = '';
    }
    if (bodyTypeSelect) {
      bodyTypeSelect.value = '';
    }
    void loadCars();
  }

  // ------------------------------------------------------------------- init

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      closeQuoteModal();
    }
  }

  function init(): void {
    carsGrid = document.getElementById('carsGrid');
    carsStatus = document.getElementById('carsStatus');
    brandInput = document.getElementById('brandFilter') as HTMLInputElement | null;
    bodyTypeSelect = document.getElementById('bodyTypeFilter') as HTMLSelectElement | null;
    quoteModal = document.getElementById('quoteModal');
    quoteModalImage = document.getElementById('quoteModalImage') as HTMLImageElement | null;
    quoteModalCta = document.getElementById('quoteModalCta') as HTMLButtonElement | null;
    const clearFiltersBtn = document.getElementById('clearFilters') as HTMLButtonElement | null;

    if (!carsGrid) {
      console.warn('[cars] #carsGrid not found — cars grid cannot be rendered.');
      return;
    }

    if (brandInput) {
      brandInput.addEventListener('input', function () {
        window.clearTimeout(brandTimer);
        brandTimer = window.setTimeout(function () {
          void applyFilters();
        }, BRAND_DEBOUNCE_MS);
      });
    }
    if (bodyTypeSelect) {
      bodyTypeSelect.addEventListener('change', function () {
        void applyFilters();
      });
    }
    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener('click', resetFilters);
    }

    if (quoteModal) {
      quoteModal.querySelectorAll('[data-quote-close]').forEach(function (el) {
        el.addEventListener('click', closeQuoteModal);
      });
    }
    document.addEventListener('keydown', onKeydown);

    if (quoteModalCta) {
      quoteModalCta.addEventListener('click', function () {
        const api = (window as { api?: CarsApi }).api;
        if (!api || !api.getToken()) {
          window.location.assign(LOGIN_URL);
          return;
        }
        const car = quoteCar;
        closeQuoteModal();
        if (car) {
          void addToCart(car);
        }
      });
    }

    void loadCars();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
