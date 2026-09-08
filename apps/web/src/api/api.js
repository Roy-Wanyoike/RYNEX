/*
 * Frontend/src/api/api.js
 * ---------------------------------------------------------------------------
 * Shared browser API helper for the carshop frontend (plain JS, no build step,
 * no modules). Load it with a plain <script> tag BEFORE any page script, e.g.:
 *
 *   <!-- optional: override the API base BEFORE loading api.js -->
 *   <script>window.__API_BASE__ = 'https://api.example.com';</script>
 *   <script src="../api/api.js"></script>
 *   <script src="your-page-script.js"></script>
 *
 * It exposes window.api (plus window.api.request for custom verbs/paths).
 * ---------------------------------------------------------------------------
 *
 * BACKEND CONTRACT (Backend/, Express, default port 4000)
 * Every endpoint replies with a JSON envelope: { success: boolean, message: string, data?: any }
 *
 *   POST /auth/login   { userName, password }
 *        -> data { token, user: { userId, userName, email, fullName, isAdmin } }
 *   POST /auth/register { userName, email, password, address?, fullName?, phoneNo?, country? }
 *
 *   GET  /products/getproducts            -> data: car rows (public catalogue)
 *   POST /products            (admin)     { model, bodyType, brand, prices, pictureUrl }
 *   POST /products/softdeletecar/:carId   (admin, soft delete)
 *
 *   GET  /users                           (admin: list registered users)
 *
 *   POST /cart                { carId, quantity }
 *   GET  /cart                            -> data: current user's cart rows
 *   POST /cart/add/:cardID                (increment quantity)
 *   POST /cart/subtract/:cardID           (decrement quantity)
 *   GET  /cart/all                        (admin: every user's cart)
 *
 * Auth: send "Authorization: Bearer <token>" (token from login response.data.token).
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // A page may set window.__API_BASE__ BEFORE loading this file to point at a
  // different backend (e.g. a deployed server instead of localhost).
  var API_BASE = window.__API_BASE__ || 'http://localhost:4000';

  var TOKEN_KEY = 'token';
  var USER_KEY = 'user';

  /**
   * Returns the stored JWT token, or null when absent/unavailable.
   */
  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (err) {
      return null; // e.g. storage disabled
    }
  }

  /**
   * Returns the stored user object (parsed from localStorage 'user'),
   * or null when absent or when the stored value is not valid JSON.
   */
  function getUser() {
    try {
      var raw = localStorage.getItem(USER_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  /**
   * True when a token is present in localStorage.
   */
  function isLoggedIn() {
    return Boolean(getToken());
  }

  /**
   * Removes token + user without touching navigation (used on stale 401s).
   */
  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (err) { /* ignore */ }
    try {
      localStorage.removeItem(USER_KEY);
    } catch (err) { /* ignore */ }
  }

  /**
   * Logs out: clears the stored token/user keys and redirects (best effort)
   * to the login page relative to the current page's directory.
   */
  function logout() {
    clearSession();
    try {
      window.location.href = '../login/login.html';
    } catch (err) {
      // Navigation is best effort only; session is already cleared.
    }
  }

  /**
   * Core request helper.
   *
   * @param {string} method HTTP verb ('GET', 'POST', ...)
   * @param {string} path   Path starting with '/', e.g. '/auth/login'
   * @param {*}      [body] Optional request payload (JSON-stringified)
   * @returns {Promise<{success: boolean, message: string, data?: any}>}
   *   Resolves with the FULL response envelope; rejects with an Error whose
   *   message is safe to show directly to the user.
   */
  function request(method, path, body) {
    var token = getToken();
    var headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }

    var options = { method: method, headers: headers };
    if (body !== undefined && body !== null) {
      options.body = JSON.stringify(body);
    }

    var response;
    return fetch(API_BASE + path, options)
      .catch(function () {
        // fetch only rejects on network-level failures (DNS, refused, CORS...).
        throw new Error('Cannot reach the server. Is the API running on ' + API_BASE + '?');
      })
      .then(function (res) {
        response = res;
        // Non-JSON bodies (proxies, empty 204s) must not crash the flow.
        return res.json().catch(function () {
          return null;
        });
      })
      .then(function (json) {
        if (response.ok && json && json.success === true) {
          return json; // full envelope { success, message, data }
        }
        if (response.status === 401 && token) {
          // Stale/expired credentials: drop them so isLoggedIn() reflects reality.
          clearSession();
          throw new Error((json && json.message) || 'Session expired. Please log in again.');
        }
        throw new Error((json && json.message) || ('Request failed (' + response.status + ')'));
      });
  }

  /**
   * GET wrapper. @param {string} path
   */
  function get(path) {
    return request('GET', path);
  }

  /**
   * POST wrapper. @param {string} path @param {*} [body]
   */
  function post(path, body) {
    return request('POST', path, body);
  }

  /**
   * DELETE wrapper. @param {string} path
   */
  function del(path) {
    return request('DELETE', path);
  }

  window.api = {
    API_BASE: API_BASE,
    request: request,
    get: get,
    post: post,
    del: del,
    getToken: getToken,
    getUser: getUser,
    isLoggedIn: isLoggedIn,
    logout: logout
  };
})();
