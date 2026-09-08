/**
 * Admin add-user page (script scope — compiled in place, no import/export).
 *
 * Backend contract:
 * - Admin check: localStorage 'user' (JSON) has isAdmin === true; JWT in localStorage 'token'
 *   (attached automatically by window.api).
 * - POST /auth/register { userName, email, password, address?, fullName?, phoneNo?, country? }
 *   -> 201 { success:true, message:'User registered' } | 409 'Username or email already exists'
 *   -> 400 validation message. (isAdmin is FORBIDDEN by the register schema — never send it.)
 * - GET /users (admin + token) -> 200 { success:true, data:[{ userId, userName, email, address,
 *   fullName, phoneNo, country, isAdmin, emailSent }] } (passwords are never returned).
 *
 * Shared helpers loaded by the HTML before this script (created by agent 3-a):
 * - window.api (../api/api.js): fetch wrapper, auto Bearer token, unwraps envelope or throws Error(message).
 * - window.ui  (../api/ui.js) : ui.toast, ui.showFormError, ui.clearFormError, ui.setButtonLoading.
 */

// ---------------------------------------------------------------------------
// Ambient types for the shared helpers (optional at runtime so this page still
// degrades gracefully if the helper bundle is missing).
// ---------------------------------------------------------------------------
interface ApiHelper {
  get(url: string): Promise<any>;
  post(url: string, body?: unknown): Promise<any>;
}

interface UiHelper {
  toast(message: string): void;
  showFormError(form: HTMLFormElement, message: string): void;
  clearFormError(form: HTMLFormElement): void;
  setButtonLoading(button: HTMLElement, loading: boolean): void;
}

interface Window {
  api?: ApiHelper;
  ui?: UiHelper;
}

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and include upper case, lower case, a digit and a special character (!@#$%^&*).';
const ADMIN_MESSAGE = 'Admin access required';

function getApi(): ApiHelper | null {
  return typeof window !== 'undefined' && window.api ? window.api : null;
}

function getUi(): UiHelper | null {
  return typeof window !== 'undefined' && window.ui ? window.ui : null;
}

function requireInput(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`Form input #${id} is missing`);
  }
  return el;
}

function isAdminUser(): boolean {
  try {
    const raw = window.localStorage.getItem('user');
    if (!raw) return false;
    const user = JSON.parse(raw) as { isAdmin?: unknown } | null;
    return user !== null && user.isAdmin === true;
  } catch {
    return false;
  }
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function showFormMessage(ui: UiHelper | null, form: HTMLFormElement, message: string): void {
  if (ui) {
    ui.showFormError(form, message);
  } else {
    window.alert(message);
  }
}

async function loadUsers(): Promise<void> {
  const table = document.getElementById('userList');
  const api = getApi();
  if (!(table instanceof HTMLTableElement) || !api) return;

  try {
    const res = await api.get('/users');
    const users: any[] = Array.isArray(res)
      ? res
      : Array.isArray(res && res.data)
        ? res.data
        : [];
    renderUsers(table, users);
  } catch (e) {
    renderTableMessage(table, errMessage(e, 'Failed to load users'));
  }
}

function renderUsers(table: HTMLTableElement, users: any[]): void {
  table.replaceChildren();

  const head = table.createTHead();
  const headRow = head.insertRow();
  ['Username', 'Email', 'Full Name', 'Phone', 'Country', 'Admin?'].forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });

  if (users.length === 0) {
    renderTableMessage(table, 'No users found');
    return;
  }

  const body = table.createTBody();
  users.forEach((user) => {
    const row = body.insertRow();
    const cells = [
      str(user && user.userName),
      str(user && user.email),
      str(user && user.fullName),
      str(user && user.phoneNo),
      str(user && user.country),
      user && user.isAdmin === true ? 'Yes' : 'No'
    ];
    cells.forEach((value) => {
      const cell = row.insertCell();
      // textContent only — never innerHTML with API data (XSS).
      cell.textContent = value;
    });
  });
}

function renderTableMessage(table: HTMLTableElement, message: string): void {
  const body = table.tBodies.length > 0 ? table.tBodies[0] : table.createTBody();
  const row = body.insertRow();
  const cell = row.insertCell();
  cell.colSpan = 6;
  cell.textContent = message;
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('UserForm');
  if (!(form instanceof HTMLFormElement)) return;

  // Admin guard (same rule as the other admin pages): non-admins get the form
  // area replaced by a message — no form, no user list, nothing else renders.
  if (!isAdminUser()) {
    const area = form.parentElement;
    if (area) {
      while (area.firstChild) area.removeChild(area.firstChild);
      const message = document.createElement('h2');
      message.textContent = ADMIN_MESSAGE;
      area.appendChild(message);
    }
    return;
  }

  const ui = getUi();
  const api = getApi();
  const submitBtn = document.getElementById('addbtn');
  const deleteBtn = document.getElementById('delbtn');

  // NOTE: there is NO delete endpoint in the backend yet, so this button stays
  // a dead control. It is disabled (also in the HTML) instead of wiring a
  // handler that would only fail at runtime. Re-enable once DELETE /users/:id exists.
  if (deleteBtn instanceof HTMLButtonElement) {
    deleteBtn.type = 'button';
    deleteBtn.disabled = true;
    deleteBtn.title = 'Not implemented yet';
  }

  if (submitBtn instanceof HTMLButtonElement) {
    submitBtn.type = 'submit';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (ui) ui.clearFormError(form);

    let userName = '';
    let email = '';
    let password = '';
    let confirmPassword = '';
    let address = '';
    let fullName = '';
    let phoneNo = '';
    let country = '';
    try {
      userName = requireInput('username').value.trim();
      email = requireInput('email').value.trim();
      password = requireInput('pass').value;
      confirmPassword = requireInput('cpass').value;
      address = requireInput('address').value.trim();
      fullName = requireInput('fullname').value.trim();
      phoneNo = requireInput('phone').value.trim();
      country = requireInput('country').value.trim();
    } catch (e) {
      showFormMessage(ui, form, errMessage(e, 'Form is missing required inputs'));
      return;
    }

    // Client-side checks before any network call.
    if (!userName) {
      showFormMessage(ui, form, 'Username is required');
      return;
    }
    if (!email) {
      showFormMessage(ui, form, 'Email is required');
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      showFormMessage(ui, form, 'Please enter a valid email address');
      return;
    }
    if (!password) {
      showFormMessage(ui, form, 'Password is required');
      return;
    }
    if (!PASSWORD_PATTERN.test(password)) {
      showFormMessage(ui, form, PASSWORD_POLICY_MESSAGE);
      return;
    }
    if (!confirmPassword) {
      showFormMessage(ui, form, 'Please confirm the password');
      return;
    }
    if (password !== confirmPassword) {
      showFormMessage(ui, form, 'Passwords do not match');
      return;
    }

    if (!api) {
      showFormMessage(ui, form, 'API helper (api.js) not loaded');
      return;
    }

    if (ui && submitBtn instanceof HTMLElement) ui.setButtonLoading(submitBtn, true);
    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;

    try {
      // Exact field casing the backend register schema expects.
      await api.post('/auth/register', {
        userName,
        email,
        password,
        address,
        fullName,
        phoneNo,
        country
      });
      if (ui) ui.toast('User registered');
      window.location.href = '../Admin/admin.html';
    } catch (e) {
      const message = errMessage(e, 'Registration failed');
      if (ui && submitBtn instanceof HTMLElement) ui.setButtonLoading(submitBtn, false);
      if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
      showFormMessage(ui, form, message);
    }
  });

  void loadUsers();
});
