/*
 * Admin - Cart Orders page (RYNEX).
 *
 * Loads every user's cart rows from GET /cart/all (admin only, Bearer token is
 * attached automatically by the shared api helper) and renders them into
 * <tbody id="stats-table-data">.
 *
 * Backend contract (services/vehicles-api):
 * - Admin check: localStorage 'user' (JSON) has isAdmin === true; JWT in
 *   localStorage 'token'.
 * - GET /cart/all (admin Bearer) -> 200 { success: true, data: [{ cardID,
 *   userId, userName, carId, model, carBrand, prices: number, quantity: number,
 *   pictureUrl }] }. No date column exists - none is rendered.
 *
 * Every cell value is written with textContent (never innerHTML), so server
 * data cannot inject markup (XSS-safe). Line Total = prices * quantity.
 *
 * Shared helpers loaded by order.html BEFORE this script:
 *   ../api/api.js -> window.api : resolves the { success, message, data }
 *                    envelope or throws Error(message) on failure.
 *   ../api/ui.js  -> window.ui  : ui.toast(message, type).
 *
 * Strict TypeScript with NO import/export statements - the compiled output
 * (order.js, emitted next to order.html) stays a plain browser script.
 * Everything is scoped inside the DOMContentLoaded callback so no global
 * declaration collides with the other admin pages' scripts.
 */

document.addEventListener('DOMContentLoaded', function (): void {
    /* ------------------------------------------------------------------ */
    /* Types (block-scoped on purpose: no global-scope pollution, so this  */
    /* file never clashes with addUser.ts / login.ts under the shared      */
    /* tsconfig).                                                          */
    /* ------------------------------------------------------------------ */
    interface CartOrderRow {
        cardID?: string | number;
        userId?: string | number;
        userName?: string;
        carId?: string | number;
        model?: string;
        carBrand?: string;
        prices?: number;
        quantity?: number;
        pictureUrl?: string;
    }

    interface ApiEnvelope {
        success?: boolean;
        message?: string;
        data?: CartOrderRow[];
    }

    interface ApiHelper {
        get(path: string): Promise<unknown>;
    }

    interface UiHelper {
        toast(message: string, type?: string): void;
    }

    const helpers = window as unknown as { api?: ApiHelper; ui?: UiHelper };

    /* ------------------------------------------------------------------ */
    /* Constants                                                           */
    /* ------------------------------------------------------------------ */
    const TABLE_BODY_ID = 'stats-table-data';
    const COLUMN_COUNT = 7; // User / Car / Brand / Unit Price / Qty / Line Total / Card ID
    const REFRESH_LABEL = 'Refresh';
    const LOADING_LABEL = 'Loading…';
    const EMPTY_MESSAGE = 'No cart orders yet';
    const ACCESS_DENIED_MESSAGE = 'Admin access required';
    const LOAD_FAILED_MESSAGE = 'Failed to load cart orders';

    /* ------------------------------------------------------------------ */
    /* Small safe helpers                                                  */
    /* ------------------------------------------------------------------ */

    function readStorage(key: string): string | null {
        try {
            return window.localStorage.getItem(key);
        } catch (error) {
            console.error('order: unable to read "' + key + '" from localStorage', error);
            return null;
        }
    }

    function isAdminUser(): boolean {
        const raw = readStorage('user');
        if (!raw) {
            return false;
        }
        try {
            const parsed: unknown = JSON.parse(raw);
            if (parsed === null || typeof parsed !== 'object') {
                return false;
            }
            return (parsed as { isAdmin?: unknown }).isAdmin === true;
        } catch (error) {
            console.error('order: stored user is not valid JSON', error);
            return false;
        }
    }

    function hasToken(): boolean {
        return Boolean(readStorage('token'));
    }

    function toDisplayString(value: unknown): string {
        return value === null || value === undefined ? '' : String(value);
    }

    function toNumber(value: unknown): number {
        const parsed = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function formatAmount(value: number): string {
        return value.toLocaleString();
    }

    /* ------------------------------------------------------------------ */
    /* DOM lookups                                                         */
    /* ------------------------------------------------------------------ */

    function getRefreshButton(): HTMLButtonElement | null {
        const el = document.getElementById('refreshBtn');
        return el instanceof HTMLButtonElement ? el : null;
    }

    function getTableBody(): HTMLTableSectionElement | null {
        const el = document.getElementById(TABLE_BODY_ID);
        if (el instanceof HTMLTableSectionElement) {
            return el;
        }
        if (el instanceof HTMLTableElement) {
            // Legacy markup kept the id on the <table> itself - use its body.
            return el.tBodies.length > 0 ? el.tBodies[0] : null;
        }
        return null;
    }

    function getTable(): HTMLTableElement | null {
        const tbody = getTableBody();
        if (!tbody) {
            return null;
        }
        // closest() includes the element itself, so this also covers the
        // legacy case where #stats-table-data sits on the <table> tag.
        const table = tbody.closest('table');
        return table instanceof HTMLTableElement ? table : null;
    }

    /* ------------------------------------------------------------------ */
    /* Rendering (textContent ONLY - never innerHTML)                      */
    /* ------------------------------------------------------------------ */

    function buildCell(text: string): HTMLTableCellElement {
        const cell = document.createElement('td');
        cell.textContent = text;
        return cell;
    }

    function buildMessageRow(text: string): HTMLTableRowElement {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = COLUMN_COUNT;
        cell.textContent = text;
        row.appendChild(cell);
        return row;
    }

    function clearTotalsFooter(): void {
        const table = getTable();
        if (table && table.tFoot) {
            table.tFoot.remove();
        }
    }

    function renderTotalsFooter(grandTotal: number): void {
        const table = getTable();
        if (!table) {
            return;
        }
        clearTotalsFooter();
        const foot = document.createElement('tfoot');
        const row = document.createElement('tr');
        const labelCell = document.createElement('td');
        labelCell.colSpan = COLUMN_COUNT - 1;
        labelCell.textContent = 'Grand Total';
        labelCell.style.textAlign = 'right';
        const totalCell = document.createElement('td');
        totalCell.textContent = formatAmount(grandTotal);
        row.appendChild(labelCell);
        row.appendChild(totalCell);
        foot.appendChild(row);
        table.appendChild(foot);
    }

    function renderCartOrders(cartOrders: CartOrderRow[]): void {
        const tbody = getTableBody();
        if (!tbody) {
            console.error('order: #' + TABLE_BODY_ID + ' not found - cannot render');
            return;
        }

        tbody.textContent = ''; // drop previous rows before re-rendering

        if (cartOrders.length === 0) {
            tbody.appendChild(buildMessageRow(EMPTY_MESSAGE));
            clearTotalsFooter();
            return;
        }

        let grandTotal = 0;
        for (const entry of cartOrders) {
            const unitPrice = toNumber(entry.prices);
            const quantity = toNumber(entry.quantity);
            const lineTotal = unitPrice * quantity;
            grandTotal += lineTotal;

            const row = document.createElement('tr');
            row.appendChild(buildCell(toDisplayString(entry.userName)));
            row.appendChild(buildCell(toDisplayString(entry.model)));
            row.appendChild(buildCell(toDisplayString(entry.carBrand)));
            row.appendChild(buildCell(formatAmount(unitPrice)));
            row.appendChild(buildCell(String(quantity)));
            row.appendChild(buildCell(formatAmount(lineTotal)));
            row.appendChild(buildCell(toDisplayString(entry.cardID)));
            tbody.appendChild(row);
        }

        renderTotalsFooter(grandTotal);
    }

    function renderMessageRow(text: string): void {
        const tbody = getTableBody();
        if (!tbody) {
            return;
        }
        tbody.textContent = '';
        tbody.appendChild(buildMessageRow(text));
        clearTotalsFooter();
    }

    /* ------------------------------------------------------------------ */
    /* Notifications / loading state                                       */
    /* ------------------------------------------------------------------ */

    function notifyError(message: string): void {
        const ui = helpers.ui;
        if (ui && typeof ui.toast === 'function') {
            try {
                ui.toast(message, 'error');
                return;
            } catch (toastError) {
                console.error('order: toast failed', toastError);
            }
        }
        console.error(message);
    }

    function setLoading(loading: boolean): void {
        const button = getRefreshButton();
        if (!button) {
            return;
        }
        button.disabled = loading;
        button.textContent = loading ? LOADING_LABEL : REFRESH_LABEL;
    }

    /* ------------------------------------------------------------------ */
    /* Data loading                                                        */
    /* ------------------------------------------------------------------ */

    async function fetchCart(): Promise<void> {
        setLoading(true);
        try {
            const api = helpers.api;
            if (!api || typeof api.get !== 'function') {
                throw new Error('API helper (window.api) is not available');
            }

            const envelope = (await api.get('/cart/all')) as ApiEnvelope;
            if (!envelope || envelope.success !== true || !Array.isArray(envelope.data)) {
                const reason = envelope ? toDisplayString(envelope.message) : '';
                throw new Error(reason || LOAD_FAILED_MESSAGE);
            }

            renderCartOrders(envelope.data);
        } catch (error) {
            const message =
                error instanceof Error && error.message ? error.message : LOAD_FAILED_MESSAGE;
            renderMessageRow(message);
            notifyError(message);
        } finally {
            setLoading(false);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Page bootstrap: admin guard, refresh wiring, auto-load              */
    /* ------------------------------------------------------------------ */

    if (!isAdminUser() || !hasToken()) {
        renderMessageRow(ACCESS_DENIED_MESSAGE);
        const button = getRefreshButton();
        if (button) {
            button.disabled = true;
        }
        notifyError(ACCESS_DENIED_MESSAGE);
        return;
    }

    const refreshButton = getRefreshButton();
    if (refreshButton) {
        refreshButton.addEventListener('click', function (): void {
            void fetchCart();
        });
    }

    // Load automatically on page open; the Refresh button re-fetches on demand.
    void fetchCart();
});
