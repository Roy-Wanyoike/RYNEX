/*
 * Frontend/src/api/ui.js
 * ---------------------------------------------------------------------------
 * Tiny DOM helpers for the carshop frontend (plain JS, no build step, no
 * modules, inline styles only — zero external CSS dependencies). Load with a
 * plain <script> tag BEFORE any page script:
 *
 *   <script src="../api/api.js"></script>
 *   <script src="../api/ui.js"></script>
 *   <script src="your-page-script.js"></script>
 *
 * Exposes window.ui: { toast, showFormError, clearFormError, setButtonLoading }.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var TOAST_BORDER_COLORS = {
    info: '#2563eb',    // blue
    success: '#16a34a', // green
    error: '#dc2626'    // red
  };
  var TOAST_AUTO_DISMISS_MS = 3500;
  var TOAST_CONTAINER_ID = 'ui-toast-container';

  /**
   * Lazily creates (once) a fixed-position container in the top-right corner
   * that stacks toast messages.
   */
  function ensureToastContainer() {
    var container = document.getElementById(TOAST_CONTAINER_ID);
    if (container) {
      return container;
    }
    container = document.createElement('div');
    container.setAttribute('id', TOAST_CONTAINER_ID);
    container.setAttribute('style', [
      'position: fixed',
      'top: 16px',
      'right: 16px',
      'display: flex',
      'flex-direction: column',
      'gap: 8px',
      'z-index: 99999',
      'pointer-events: none'
    ].join(';'));
    document.body.appendChild(container);
    return container;
  }

  /**
   * Shows a transient toast notification (auto-dismisses after 3.5s).
   *
   * @param {string} message Text to display.
   * @param {'info'|'success'|'error'} [type] Visual flavour; defaults to 'info'.
   */
  function toast(message, type) {
    if (!document.body) {
      // Page still parsing: defer until DOM is ready.
      document.addEventListener('DOMContentLoaded', function () {
        toast(message, type);
      });
      return;
    }

    var flavour = TOAST_BORDER_COLORS[type] ? type : 'info';
    var borderColor = TOAST_BORDER_COLORS[flavour];

    var toastEl = document.createElement('div');
    toastEl.textContent = message; // textContent: no HTML injection from server strings
    toastEl.setAttribute('style', [
      'background: #ffffff',
      'color: #1f2937',
      'font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
      'font-size: 14px',
      'line-height: 1.4',
      'padding: 12px 16px',
      'border: 1px solid ' + borderColor,
      'border-left: 5px solid ' + borderColor,
      'border-radius: 6px',
      'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15)',
      'max-width: 320px',
      'word-wrap: break-word',
      'pointer-events: auto'
    ].join(';'));

    ensureToastContainer().appendChild(toastEl);

    window.setTimeout(function () {
      if (toastEl && toastEl.parentNode) {
        toastEl.parentNode.removeChild(toastEl);
      }
    }, TOAST_AUTO_DISMISS_MS);
  }

  /**
   * Renders or updates a SINGLE <p class="form-error"> (red) inside the given
   * container. Calling it repeatedly replaces the message instead of appending
   * duplicate <p> tags (the old login page piled up infinite error paragraphs).
   *
   * @param {HTMLElement} container Element to render the error inside.
   * @param {string} message Error text to display.
   */
  function showFormError(container, message) {
    if (!container) {
      return;
    }
    var errorEl = container.querySelector('p.form-error');
    if (!errorEl) {
      errorEl = document.createElement('p');
      errorEl.className = 'form-error';
      errorEl.setAttribute('style', [
        'color: #dc2626',
        'background: #fef2f2',
        'border: 1px solid #fecaca',
        'border-radius: 4px',
        'padding: 8px 12px',
        'margin: 8px 0',
        'font-size: 14px'
      ].join(';'));
      container.appendChild(errorEl);
    }
    errorEl.textContent = message || 'Something went wrong. Please try again.';
  }

  /**
   * Removes the form error paragraph rendered by showFormError (if present).
   *
   * @param {HTMLElement} container Element that may contain the error.
   */
  function clearFormError(container) {
    if (!container) {
      return;
    }
    var errorEl = container.querySelector('p.form-error');
    if (errorEl && errorEl.parentNode) {
      errorEl.parentNode.removeChild(errorEl);
    }
  }

  /**
   * Toggles a button between normal and loading state.
   * While loading: disabled + label "Please wait..." (original text is stored
   * in the data-original-label attribute and restored on completion).
   *
   * @param {HTMLButtonElement} button Button element to toggle.
   * @param {boolean} loading true = enter loading state, false = restore.
   */
  function setButtonLoading(button, loading) {
    if (!button) {
      return;
    }
    if (loading) {
      if (!button.getAttribute('data-original-label')) {
        // Only snapshot the label on the FIRST loading call (idempotent).
        button.setAttribute('data-original-label', button.textContent);
      }
      button.textContent = 'Please wait...';
      button.disabled = true;
    } else {
      var original = button.getAttribute('data-original-label');
      if (original !== null) {
        button.textContent = original;
        button.removeAttribute('data-original-label');
      }
      button.disabled = false;
    }
  }

  window.ui = {
    toast: toast,
    showFormError: showFormError,
    clearFormError: clearFormError,
    setButtonLoading: setButtonLoading
  };
})();
