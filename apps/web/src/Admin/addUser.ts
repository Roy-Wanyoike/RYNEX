/*
 * Admin "Add Users" page behavior (plain TypeScript, NO import/export so the
 * compiled addUser.js stays a plain browser script).
 *
 * Load order required by the HTML (before this script):
 *   ../api/api.js -> window.api : api.get/api.post -> full { success, message, data }
 *                                envelope; auto-attaches the Bearer token from
 *                                localStorage 'token'; throws Error(message).
 *   ../api/ui.js  -> window.ui  : toast / showFormError / clearFormError /
 *                                setButtonLoading.
 *
 * Backend contract (services/vehicles-api):
 * - Admin check: localStorage 'user' (JSON) has isAdmin === true.
 * - POST /auth/register { userName, email, password, address?, fullName?,
 *   phoneNo?, country? }
 *     -> 201 { success:true, message:'User registered' }
 *     -> 409 { message:'Username or email already exists' }
 *     -> 400 validation message.
 *   isAdmin is FORBIDDEN by the register schema (Joi.forbidden) - never send it.
 * - GET /users (admin Bearer) -> 200 { success:true, data:[{ userId, userName,
 *   email, address, fullName, phoneNo, country, isAdmin, emailSent }] }
 *   (passwords are never returned).
 * - There is NO delete-user endpoint, so #delbtn stays disabled (see below).
 */

document.addEventListener('DOMContentLoaded', function () {
    // ------------------------------------------------------------------
    // Local types for the shared helpers. Intentionally NOT merged into the
    // global Window interface: other page scripts declare their own helper
    // shapes and duplicate global declarations would collide.
    // ------------------------------------------------------------------
    interface AdminUserRow {
        userId?: string | number;
        userName?: string;
        email?: string;
        address?: string;
        fullName?: string;
        phoneNo?: string;
        country?: string;
        isAdmin?: boolean | number | string;
        emailSent?: boolean | number | string;
    }
    interface UsersEnvelope {
        success?: boolean;
        message?: string;
        data?: AdminUserRow[];
    }
    interface RegisterEnvelope {
        success?: boolean;
        message?: string;
    }
    interface RegisterPayload {
        userName: string;
        email: string;
        password: string;
        address: string;
        fullName: string;
        phoneNo: string;
        country: string;
    }
    interface ApiHelper {
        get(path: string): Promise<UsersEnvelope>;
        post(path: string, body: RegisterPayload): Promise<RegisterEnvelope>;
    }
    interface UiHelper {
        toast(message: string, type?: 'info' | 'success' | 'error'): void;
        showFormError(container: HTMLElement, message: string): void;
        clearFormError(container: HTMLElement): void;
        setButtonLoading(button: HTMLButtonElement | null, loading: boolean): void;
    }

    const helpers = window as unknown as { api?: ApiHelper; ui?: UiHelper };
    const api = helpers.api;
    const ui = helpers.ui;

    const ADMIN_MESSAGE = 'Admin access required';
    const REDIRECT_DELAY_MS = 900; // let the success toast be seen before navigating
    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // Same policy as the server (services/vehicles-api/src/Helpers): 8+ chars
    // with upper, lower, digit and special character (!@#$%^&*).
    const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;
    const PASSWORD_POLICY_MESSAGE =
        'Password must be at least 8 characters and include upper case, lower case, a digit and a special character (!@#$%^&*).';

    // ------------------------------------------------------------------
    // Small utilities
    // ------------------------------------------------------------------
    function errorMessage(error: unknown, fallback: string): string {
        return error instanceof Error && error.message !== '' ? error.message : fallback;
    }

    function formMessage(message: string): void {
        if (ui) {
            ui.showFormError(form, message);
        } else {
            window.alert(message);
        }
    }

    /** SQL BIT fields arrive as boolean/0-1/'0'-'1'/'true'-'false' depending on driver. */
    function isTruthyFlag(value: unknown): boolean {
        if (value === true || value === 1 || value === '1') return true;
        return typeof value === 'string' && value.toLowerCase() === 'true';
    }

    /** localStorage 'user' (JSON, stored by the login page) has isAdmin === true. */
    function isAdminUser(): boolean {
        try {
            const raw = window.localStorage.getItem('user');
            if (!raw) return false;
            const user = JSON.parse(raw) as { isAdmin?: unknown } | null;
            return user !== null && user.isAdmin === true;
        } catch (error) {
            return false;
        }
    }

    function inputById(id: string): HTMLInputElement | null {
        const el = document.getElementById(id);
        return el instanceof HTMLInputElement ? el : null;
    }

    function cellText(row: HTMLTableRowElement, value: string): void {
        const cell = row.insertCell();
        // textContent ONLY - API strings are never injected as HTML (XSS).
        cell.textContent = value;
    }

    // ------------------------------------------------------------------
    // Admin guard on load: non-admins get a message and nothing else runs.
    // ------------------------------------------------------------------
    const formEl = document.getElementById('UserForm');
    if (!(formEl instanceof HTMLFormElement)) {
        console.warn('[addUser] Missing #UserForm - admin user management disabled.');
        return;
    }
    const form: HTMLFormElement = formEl;

    if (!isAdminUser()) {
        const area = form.parentElement;
        if (area) {
            while (area.firstChild) area.removeChild(area.firstChild);
            const notice = document.createElement('h2');
            notice.textContent = ADMIN_MESSAGE;
            area.appendChild(notice);
        } else {
            window.alert(ADMIN_MESSAGE);
        }
        return;
    }

    // ------------------------------------------------------------------
    // Users table (#userList): GET /users -> textContent-only rows.
    // ------------------------------------------------------------------
    const TABLE_HEADERS = ['Username', 'Email', 'Full Name', 'Phone', 'Country', 'Admin?', 'Verified-email?'];

    function renderTableMessage(table: HTMLTableElement, message: string): void {
        const body = table.tBodies.length > 0 ? table.tBodies[0] : table.createTBody();
        const row = body.insertRow();
        const cell = row.insertCell();
        cell.colSpan = TABLE_HEADERS.length;
        cell.textContent = message;
    }

    function renderUsers(table: HTMLTableElement, users: AdminUserRow[]): void {
        table.replaceChildren();

        const head = table.createTHead();
        const headRow = head.insertRow();
        TABLE_HEADERS.forEach(function (label) {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        });

        if (users.length === 0) {
            renderTableMessage(table, 'No users found');
            return;
        }

        const body = table.createTBody();
        users.forEach(function (user) {
            const safe = user || {};
            const row = body.insertRow();
            cellText(row, safe.userName === undefined || safe.userName === null ? '' : String(safe.userName));
            cellText(row, safe.email === undefined || safe.email === null ? '' : String(safe.email));
            cellText(row, safe.fullName === undefined || safe.fullName === null ? '' : String(safe.fullName));
            cellText(row, safe.phoneNo === undefined || safe.phoneNo === null ? '' : String(safe.phoneNo));
            cellText(row, safe.country === undefined || safe.country === null ? '' : String(safe.country));
            cellText(row, isTruthyFlag(safe.isAdmin) ? 'Yes' : 'No');
            cellText(row, isTruthyFlag(safe.emailSent) ? 'Yes' : 'No');
        });
    }

    async function loadUsers(): Promise<void> {
        const table = document.getElementById('userList');
        if (!(table instanceof HTMLTableElement)) {
            console.warn('[addUser] Missing #userList table - skipping user list.');
            return;
        }
        if (!api) {
            renderTableMessage(table, 'API helper (api.js) not loaded');
            return;
        }
        try {
            const res = await api.get('/users');
            const users = res && Array.isArray(res.data) ? res.data : [];
            renderUsers(table, users);
        } catch (error) {
            renderTableMessage(table, errorMessage(error, 'Failed to load users'));
        }
    }

    // ------------------------------------------------------------------
    // Delete button: NO backend endpoint exists (SpDeleteSpecificUser is not
    // exposed by any controller/route), so this stays a dead control instead
    // of faking a handler that would only fail at runtime. Re-enable when a
    // DELETE /users/:id route lands.
    // ------------------------------------------------------------------
    const deleteBtn = document.getElementById('delbtn');
    if (deleteBtn instanceof HTMLButtonElement) {
        deleteBtn.type = 'button';
        deleteBtn.disabled = true;
        deleteBtn.title = 'Not implemented yet';
    }

    const submitBtn = document.getElementById('addbtn') instanceof HTMLButtonElement
        ? (document.getElementById('addbtn') as HTMLButtonElement)
        : null;

    // ------------------------------------------------------------------
    // Register form submit
    // ------------------------------------------------------------------
    let submitting = false;

    async function handleSubmit(event: Event): Promise<void> {
        event.preventDefault();
        if (submitting) return;
        if (ui) ui.clearFormError(form);

        // All 8 inputs must exist; ids are fixed by addUser.html.
        const ids = ['username', 'email', 'pass', 'cpass', 'address', 'fullname', 'phone', 'country'];
        for (const id of ids) {
            if (!inputById(id)) {
                formMessage('Page is missing the #' + id + ' input. Please refresh.');
                return;
            }
        }

        // NOTE: 'fullname' id maps to the backend's 'fullName' key (exact casing).
        const userName = (inputById('username') as HTMLInputElement).value.trim();
        const email = (inputById('email') as HTMLInputElement).value.trim();
        const password = (inputById('pass') as HTMLInputElement).value;
        const confirmPassword = (inputById('cpass') as HTMLInputElement).value;
        const address = (inputById('address') as HTMLInputElement).value.trim();
        const fullName = (inputById('fullname') as HTMLInputElement).value.trim();
        const phoneNo = (inputById('phone') as HTMLInputElement).value.trim();
        const country = (inputById('country') as HTMLInputElement).value.trim();

        // Client checks before any network call (passwords are NOT trimmed).
        if (!userName) return formMessage('Username is required');
        if (userName.length < 3) return formMessage('Username must be at least 3 characters');
        if (!email) return formMessage('Email is required');
        if (!EMAIL_PATTERN.test(email)) return formMessage('Please enter a valid email address');
        if (!password) return formMessage('Password is required');
        if (!PASSWORD_PATTERN.test(password)) return formMessage(PASSWORD_POLICY_MESSAGE);
        if (!confirmPassword) return formMessage('Please confirm the password');
        if (password !== confirmPassword) return formMessage('Passwords do not match');

        if (!api) {
            formMessage('API helper (api.js) not loaded');
            return;
        }

        submitting = true;
        if (ui && submitBtn) ui.setButtonLoading(submitBtn, true);

        try {
            // Exact field casing expected by the /auth/register schema.
            await api.post('/auth/register', { userName, email, password, address, fullName, phoneNo, country });
            if (ui) ui.toast('User registered', 'success');
            window.setTimeout(function () {
                window.location.href = '../Admin/admin.html';
            }, REDIRECT_DELAY_MS);
            // No button restore: the page is navigating away.
        } catch (error) {
            submitting = false;
            if (ui && submitBtn) ui.setButtonLoading(submitBtn, false);
            formMessage(errorMessage(error, 'Registration failed'));
        }
    }

    form.addEventListener('submit', function (event) {
        void handleSubmit(event);
    });

    void loadUsers();
});
