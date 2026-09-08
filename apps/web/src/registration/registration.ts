/*
 * Registration page behavior.
 *
 * Plain TypeScript with NO import/export statements so the compiled output
 * (registration.js, emitted next to registration.html by the build agent)
 * stays a plain browser script loadable with a normal <script> tag.
 *
 * Depends on helpers loaded BEFORE this file:
 *   ../api/api.js -> window.api : api.post(path, body) => { success, message, data }
 *                                  (throws Error(message) on failure)
 *   ../api/ui.js  -> window.ui  : ui.toast / ui.showFormError / ui.clearFormError /
 *                                  ui.setButtonLoading
 *
 * Backend contract (vehicles-api, default port 4000):
 *   POST /auth/register { userName, email, password, address?, fullName?, phoneNo?, country? }
 *     -> 201 { success: true,  message: 'User registered' }
 *     -> 400 { success: false, message }   (validation)
 *     -> 409 { success: false, message: 'Username or email already exists' }
 *
 * Password policy (mirrors the backend Joi schema):
 *   8+ chars with at least one lowercase letter, one uppercase letter, one
 *   digit and one special character (!@#$%^&*).
 *
 * NOTE: field casing matters — the API expects `fullName` (NOT `fullname`)
 * and `phoneNo` (NOT `phoneno`).
 */

document.addEventListener("DOMContentLoaded", function () {
    interface RegisterEnvelope {
        success?: boolean;
        message?: string;
    }
    interface ApiHelper {
        post(path: string, body: Record<string, unknown>): Promise<RegisterEnvelope>;
    }
    interface UiHelper {
        toast(message: string, type?: "info" | "success" | "error"): void;
        showFormError(container: HTMLElement | null, message: string): void;
        clearFormError(container: HTMLElement | null): void;
        setButtonLoading(button: HTMLButtonElement | null, loading: boolean): void;
    }

    const helpers = window as unknown as { api?: ApiHelper; ui?: UiHelper };

    const form = document.getElementById("registrationForm") as HTMLFormElement | null;
    const button = document.getElementById("registerBtn") as HTMLButtonElement | null;
    const userNameInput = document.getElementById("userName") as HTMLInputElement | null;
    const emailInput = document.getElementById("email") as HTMLInputElement | null;
    const passwordInput = document.getElementById("password") as HTMLInputElement | null;
    const confirmPasswordInput = document.getElementById("confirmPassword") as HTMLInputElement | null;
    const addressInput = document.getElementById("address") as HTMLInputElement | null;
    const fullNameInput = document.getElementById("fullName") as HTMLInputElement | null;
    const phoneNoInput = document.getElementById("phoneNo") as HTMLInputElement | null;
    const countryInput = document.getElementById("country") as HTMLInputElement | null;

    if (
        !form ||
        !button ||
        !userNameInput ||
        !emailInput ||
        !passwordInput ||
        !confirmPasswordInput ||
        !addressInput ||
        !fullNameInput ||
        !phoneNoInput ||
        !countryInput
    ) {
        console.warn(
            "[registration] Missing required element(s): expected #registrationForm, #registerBtn and inputs " +
                "#userName, #email, #password, #confirmPassword, #address, #fullName, #phoneNo, #country. " +
                "Registration disabled."
        );
        return;
    }

    // Same pattern the backend enforces via Joi (services/vehicles-api Helpers).
    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*]).{8,}$/;

    let submitting = false;

    const onSubmit = async (event: Event): Promise<void> => {
        event.preventDefault();
        if (submitting) {
            return; // double-submit guard
        }

        const api = helpers.api;
        const ui = helpers.ui;
        if (!api || !ui) {
            console.warn("[registration] window.api/window.ui helper not loaded; cannot submit registration.");
            if (ui) {
                ui.showFormError(form, "Registration is unavailable right now. Please refresh the page.");
            }
            return;
        }

        // Collect + trim. Passwords are trimmed too so the stored value is
        // exactly what can be re-typed at login (the login page trims as well).
        const userName = userNameInput.value.trim();
        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();
        const confirmPassword = confirmPasswordInput.value.trim();
        const address = addressInput.value.trim();
        const fullName = fullNameInput.value.trim();
        const phoneNo = phoneNoInput.value.trim();
        const country = countryInput.value.trim();

        // ---- Client-side checks (friendly messages BEFORE hitting the API) ----

        // Required fields (address/fullName/phoneNo/country are optional server-side).
        if (userName === "" || email === "" || password === "" || confirmPassword === "") {
            ui.showFormError(form, "Please fill in all required fields: username, email, password and confirm password.");
            return;
        }

        // Username length (backend: min 3, max 50).
        if (userName.length < 3 || userName.length > 50) {
            ui.showFormError(form, "Username must be between 3 and 50 characters.");
            return;
        }

        // Email shape.
        if (!EMAIL_PATTERN.test(email)) {
            ui.showFormError(form, "Please enter a valid email address.");
            return;
        }

        // Confirm-password match.
        if (password !== confirmPassword) {
            ui.showFormError(form, "Passwords do not match");
            return;
        }

        // Password policy.
        if (!PASSWORD_PATTERN.test(password)) {
            ui.showFormError(
                form,
                "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, " +
                    "a number, and a special character (!@#$%^&*)."
            );
            return;
        }

        ui.clearFormError(form);
        ui.setButtonLoading(button, true);
        submitting = true;

        let redirecting = false;
        try {
            const res = await api.post("/auth/register", {
                userName: userName,
                email: email,
                password: password,
                address: address,
                fullName: fullName, // exact casing required by the API
                phoneNo: phoneNo,
                country: country
            });

            // api.post only resolves on success:true, so this is purely defensive.
            if (!res || res.success !== true) {
                const serverMessage =
                    res && typeof res.message === "string" && res.message !== ""
                        ? res.message
                        : "Registration failed. Please try again.";
                throw new Error(serverMessage);
            }

            redirecting = true;
            ui.toast("Account created — please log in", "success");
            // Give the toast a moment to be seen, then continue to login.
            window.setTimeout(function () {
                window.location.href = "../login/login.html";
            }, 900);
        } catch (error) {
            const message =
                error instanceof Error && error.message !== ""
                    ? error.message
                    : "Registration failed. Please try again.";
            ui.showFormError(form, message);
        } finally {
            submitting = false;
            if (!redirecting) {
                ui.setButtonLoading(button, false);
            }
        }
    };

    form.addEventListener("submit", onSubmit);
});
