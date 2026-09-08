/*
 * Login page behavior.
 *
 * Plain TypeScript with NO import/export statements so the compiled output
 * (login.js, emitted next to login.html) stays a plain browser script.
 *
 * Depends on helpers loaded BEFORE this file:
 *   ../api/api.js -> window.api : api.post(path, body) => { success, message, data }
 *                                  (throws Error(message) on failure)
 *   ../api/ui.js  -> window.ui  : ui.showFormError / ui.clearFormError / ui.setButtonLoading
 *
 * Backend contract:
 *   POST /auth/login { userName, password }
 *     -> 200 { success: true, data: { token, user: { userId, userName, email, fullName, isAdmin } } }
 *     -> 400/401/500 { success: false, message }
 */

document.addEventListener("DOMContentLoaded", function () {
    interface LoginUser {
        userId?: number | string;
        userName?: string;
        email?: string;
        fullName?: string;
        isAdmin?: boolean;
    }
    interface LoginPayload {
        token?: string;
        user?: LoginUser;
    }
    interface LoginEnvelope {
        success?: boolean;
        message?: string;
        data?: LoginPayload;
    }
    interface ApiHelper {
        post(path: string, body: Record<string, unknown>): Promise<LoginEnvelope>;
    }
    interface UiHelper {
        showFormError(container: HTMLElement | null, message: string): void;
        clearFormError(container: HTMLElement | null): void;
        setButtonLoading(button: HTMLButtonElement | null, loading: boolean): void;
    }

    const helpers = window as unknown as { api?: ApiHelper; ui?: UiHelper };

    const form = document.getElementById("loginForm") as HTMLFormElement | null;
    const button = document.getElementById("login-btn") as HTMLButtonElement | null;
    const userNameInput = document.getElementById("userName") as HTMLInputElement | null;
    const passwordInput = document.getElementById("password") as HTMLInputElement | null;

    if (!form || !button || !userNameInput || !passwordInput) {
        console.warn("[login] Missing required element(s): expected #loginForm, #login-btn, #userName, #password. Login disabled.");
        return;
    }

    let submitting = false;

    const onSubmit = async (event: Event): Promise<void> => {
        event.preventDefault();
        if (submitting) {
            return;
        }

        const api = helpers.api;
        const ui = helpers.ui;
        if (!api || !ui) {
            console.warn("[login] window.api/window.ui helper not loaded; cannot submit login.");
            if (ui) {
                ui.showFormError(form, "Login is unavailable right now. Please refresh the page.");
            }
            return;
        }

        const userName = userNameInput.value.trim();
        const password = passwordInput.value.trim();

        if (userName === "" || password === "") {
            ui.showFormError(form, "Please fill in all fields");
            return;
        }

        ui.clearFormError(form);
        ui.setButtonLoading(button, true);
        submitting = true;

        try {
            const res = await api.post("/auth/login", { userName, password });
            const payload = res && res.data ? res.data : undefined;
            const user = payload ? payload.user : undefined;
            const token = payload ? payload.token : undefined;

            if (!user || !token) {
                throw new Error("Login failed: unexpected response from the server.");
            }

            localStorage.setItem("token", token);
            localStorage.setItem("user", JSON.stringify(user));

            window.location.href = user.isAdmin === true ? "../Admin/admin.html" : "../Home/index.html";
        } catch (error) {
            const message = error instanceof Error && error.message !== "" ? error.message : "Login failed. Please try again.";
            ui.showFormError(form, message);
        } finally {
            submitting = false;
            ui.setButtonLoading(button, false);
        }
    };

    form.addEventListener("submit", onSubmit);
});
