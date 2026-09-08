/*
 * Admin - Cart Orders page.
 *
 * Loads every user's cart rows from GET /cart/all (admin only, Bearer token)
 * and renders them into <tbody id="stats-table-data">. All cell values are
 * written with textContent (never innerHTML) so server data cannot inject
 * markup (XSS-safe).
 *
 * Shared helpers loaded by order.html before this script:
 *   window.api (../api/api.js) - fetch wrapper that attaches the Bearer token
 *     and resolves the { success, message, data } envelope or throws
 *     Error(message) on failure.
 *   window.ui  (../api/ui.js)  - toast / form-error notification helpers.
 *
 * Compiled in place to order.js (plain script, no import/export).
 */

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

interface ApiEnvelope<TData> {
    success?: boolean;
    message?: string;
    data?: TData;
}

interface ApiHelper {
    get(url: string): Promise<unknown>;
}

interface UiHelper {
    toast?(message: string, type?: string): void;
    showFormError?(...args: unknown[]): void;
}

interface Window {
    api?: ApiHelper;
    ui?: UiHelper;
}

const TABLE_BODY_ID = 'stats-table-data';
const COLUMN_COUNT = 7; // User / Car / Brand / Unit Price / Qty / Line Total / Card ID
const REFRESH_LABEL = 'Refresh';

let refreshButton: HTMLButtonElement | null = null;

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

function isAdminUser(): boolean {
    try {
        const raw = window.localStorage.getItem('user');
        if (!raw) {
            return false;
        }
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') {
            return false;
        }
        return (parsed as { isAdmin?: unknown }).isAdmin === true;
    } catch (error) {
        console.error('order: unable to read stored user', error);
        return false;
    }
}

function hasToken(): boolean {
    try {
        return Boolean(window.localStorage.getItem('token'));
    } catch (error) {
        console.error('order: unable to read auth token', error);
        return false;
    }
}

/* ------------------------------------------------------------------ */
/* Rendering helpers                                                   */
/* ------------------------------------------------------------------ */

function getTableBody(): HTMLTableSectionElement | null {
    const el = document.getElementById(TABLE_BODY_ID);
    if (!el) {
        return null;
    }
    // Legacy markup kept the id on the <table> itself - fall back to its body.
    if (el instanceof HTMLTableElement) {
        return el.tBodies.length > 0 ? el.tBodies[0] : null;
    }
    if (el instanceof HTMLTableSectionElement) {
        return el;
    }
    return null;
}

function getOrdersTable(): HTMLTableElement | null {
    const tbody = getTableBody();
    const parent = tbody ? tbody.parentElement : null;
    if (parent instanceof HTMLTableElement) {
        return parent;
    }
    const table = document.querySelector('#content main table');
    return table instanceof HTMLTableElement ? table : null;
}

function toDisplayString(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value);
}

function toNumber(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmount(value: number): string {
    return value.toLocaleString();
}

function buildCell(text: string): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.textContent = text; // textContent only - never innerHTML
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

function renderTotalsFooter(grandTotal: number, show: boolean): void {
    const table = getOrdersTable();
    if (!table) {
        return;
    }
    const existingFoot = table.tFoot;
    if (existingFoot) {
        existingFoot.remove();
    }
    if (!show) {
        return;
    }
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
        console.error('order: table body #' + TABLE_BODY_ID + ' not found');
        return;
    }

    tbody.textContent = '';

    if (cartOrders.length === 0) {
        tbody.appendChild(buildMessageRow('No cart orders yet'));
        renderTotalsFooter(0, false);
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

    renderTotalsFooter(grandTotal, true);
}

/* ------------------------------------------------------------------ */
/* Notifications / loading state                                       */
/* ------------------------------------------------------------------ */

function notifyError(message: string): void {
    const ui = window.ui;
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
    if (!refreshButton) {
        return;
    }
    refreshButton.disabled = loading;
    refreshButton.textContent = loading ? 'Loading…' : REFRESH_LABEL;
}

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */

async function fetchCart(): Promise<void> {
    const tbody = getTableBody();
    if (!tbody) {
        console.error('order: table body #' + TABLE_BODY_ID + ' not found');
        return;
    }

    setLoading(true);
    try {
        const api = window.api;
        if (!api || typeof api.get !== 'function') {
            throw new Error('API helper (window.api) is not available');
        }

        const envelope = await api.get('/cart/all') as ApiEnvelope<CartOrderRow[]>;
        if (!envelope || envelope.success !== true || !Array.isArray(envelope.data)) {
            const reason = envelope ? toDisplayString(envelope.message) : '';
            throw new Error(reason || 'Failed to load cart orders');
        }

        renderCartOrders(envelope.data);
    } catch (error) {
        const message =
            error instanceof Error && error.message
                ? error.message
                : 'Failed to load cart orders';
        const body = getTableBody();
        if (body) {
            body.textContent = '';
            body.appendChild(buildMessageRow(message));
        }
        renderTotalsFooter(0, false);
        notifyError(message);
    } finally {
        setLoading(false);
    }
}

/* ------------------------------------------------------------------ */
/* Page bootstrap                                                      */
/* ------------------------------------------------------------------ */

function showAccessDenied(): void {
    const tbody = getTableBody();
    if (tbody) {
        tbody.textContent = '';
        tbody.appendChild(buildMessageRow('Admin access required'));
    }
    const button = document.getElementById('refreshBtn');
    if (button instanceof HTMLButtonElement) {
        button.disabled = true;
    }
    notifyError('Admin access required');
}

function initOrdersPage(): void {
    if (!isAdminUser() || !hasToken()) {
        showAccessDenied();
        return;
    }

    const button = document.getElementById('refreshBtn');
    if (button instanceof HTMLButtonElement) {
        refreshButton = button;
        button.addEventListener('click', () => {
            void fetchCart();
        });
    }

    // Load automatically on page open (the old page only loaded on click).
    void fetchCart();
}

document.addEventListener('DOMContentLoaded', initOrdersPage);
