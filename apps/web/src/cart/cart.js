/*
 * RYNEX cart module.
 * ---------------------------------------------------------------------------
 * Vendored from the Code Boxx "Simple Javascript Shopping Cart" tutorial
 * (see README.txt in this folder for the license/attribution) and integrated
 * with the RYNEX vehicles-api:
 *
 *   - Catalogue: GET /products/getproducts (public) replaces the local demo
 *     map in products.js on success; on failure the local fallback is used
 *     silently. Server pictureUrls ("/images/x.jpg") are rewritten to
 *     "../images/x.jpg" (this page lives in src/cart/, images in src/images/)
 *     with an onerror fallback to the local demo image.
 *   - Checkout: POST /cart { carId, quantity } per line item (Bearer token,
 *     sequential; the server resolves the price — never send prices here).
 *
 * Requires (loaded before this script by cart.html):
 *   ../api/api.js  -> window.api
 *   ../api/ui.js   -> window.ui
 * ---------------------------------------------------------------------------
 */
var cart = {
  // (A) PROPERTIES
  hPdt : null,        // html products list
  hItems : null,      // html current cart
  items : {},         // current items in cart
  iURL : "images/",   // local demo product image url folder
  localImgs : [       // demo images shipped in src/cart/images/ (onerror fallbacks)
    "audi.jpeg", "audiA4.jpg", "audiA5.jpg", "benz.jpeg", "bmw.jpeg",
    "jeep.jpg", "mazdacx5.jpg", "mazdamx5.jpg", "volkswagen.png",
    "vwred.png", "vwToureg.jpg", "volvoxc60.jpg"
  ],
  FALLBACK_IMG : "audi.jpeg", // used when no local demo image matches
  currency : "KES ",  // currency symbol (catalogue prices are KES)
  total : 0,          // total amount

  // (B) LOCALSTORAGE CART
  // (B1) SAVE CURRENT CART INTO LOCALSTORAGE
  save : () => localStorage.setItem("cart", JSON.stringify(cart.items)),

  // (B2) LOAD CART FROM LOCALSTORAGE
  load : () => {
    cart.items = localStorage.getItem("cart");
    if (cart.items == null) { cart.items = {}; }
    else { cart.items = JSON.parse(cart.items); }
  },

  // (B3) EMPTY ENTIRE CART
  nuke : () => { if (confirm("Empty cart?")) {
    cart.items = {};
    localStorage.removeItem("cart");
    cart.list();
  }},

  // (B4) TOAST HELPER - window.ui when available, alert() otherwise
  toast : (msg, type) => {
    if (window.ui && window.ui.toast) { window.ui.toast(msg, type); }
    else { alert(msg); }
  },

  // (C) INITIALIZE
  init : async () => {
    // (C1) GET HTML ELEMENTS
    cart.hPdt = document.getElementById("cart-products");
    cart.hItems = document.getElementById("cart-items");

    // (C2) FETCH CATALOGUE - server first, local demo data as fallback
    try {
      const res = await window.api.get("/products/getproducts");
      const rows = res && res.data;
      if (Array.isArray(rows) && rows.length) {
        const server = {};
        for (const row of rows) {
          if (!row || !row.carId) { continue; }
          // pictureUrl "/images/foo.jpg" -> basename -> page-relative "../images/foo.jpg"
          const base = String(row.pictureUrl || "").split("/").pop();
          server[row.carId] = {
            name : row.model || "Unnamed vehicle",
            img : base ? "../images/" + base : "",
            price : Number(row.prices) || 0
          };
        }
        if (Object.keys(server).length) { products = server; }
      }
    } catch (err) {
      // Offline / API down: keep the local fallback catalogue silently.
      console.warn("[RYNEX cart] catalogue fetch failed, using local demo data:", err && err.message);
    }

    // (C3) DRAW PRODUCTS LIST
    cart.hPdt.innerHTML = "";
    let template = document.getElementById("template-product").content, p, item;
    for (let id in products) {
      p = products[id];
      item = template.cloneNode(true);
      let imgEl = item.querySelector(".p-img");
      // Server rows carry a "../images/<file>" path; local rows a bare filename.
      let fb = p.img;
      if (p.img.indexOf("/") !== -1) {
        imgEl.src = p.img;
        fb = p.img.substring(p.img.lastIndexOf("/") + 1);
      } else {
        imgEl.src = cart.iURL + p.img;
      }
      // (C3-1) ONERROR FALLBACK to the local demo image (dedupe the handler
      // first so a failing fallback cannot loop forever).
      imgEl.onerror = () => {
        imgEl.onerror = null;
        imgEl.src = cart.iURL + (cart.localImgs.indexOf(fb) !== -1 ? fb : cart.FALLBACK_IMG);
      };
      item.querySelector(".p-name").textContent = p.name;
      item.querySelector(".p-price").textContent = cart.currency + p.price.toFixed(2);
      item.querySelector(".p-add").onclick = () => cart.add(id);
      cart.hPdt.appendChild(item);
    }

    // (C4) LOAD CART FROM PREVIOUS SESSION
    cart.load();

    // (C5) LIST CURRENT CART ITEMS
    cart.list();
  },

  // (D) LIST CURRENT CART ITEMS (IN HTML)
  list : () => {
    // (D1) RESET + drop stale rows whose product no longer exists
    // (e.g. removed demo entries, or ids from a catalogue that changed)
    cart.total = 0;
    cart.hItems.innerHTML = "";
    for (let id in cart.items) {
      if (!products[id]) { delete cart.items[id]; }
    }
    cart.save();

    let item, empty = true;
    for (let key in cart.items) {
      if (cart.items.hasOwnProperty(key)) { empty = false; break; }
    }

    // (D2) CART IS EMPTY
    if (empty) {
      item = document.createElement("div");
      item.className = "c-empty-note";
      item.innerHTML = "Cart is empty";
      cart.hItems.appendChild(item);
    }

    // (D3) CART IS NOT EMPTY - LIST ITEMS
    else {
      let template = document.getElementById("template-cart").content, p;
      for (let id in cart.items) {
        p = products[id];
        item = template.cloneNode(true);
        item.querySelector(".c-del").onclick = () => cart.remove(id);
        item.querySelector(".c-name").textContent = p.name;
        item.querySelector(".c-qty").value = cart.items[id];
        item.querySelector(".c-qty").onchange = function () { cart.change(id, this.value); };
        cart.hItems.appendChild(item);
        cart.total += cart.items[id] * p.price;
      }

      // (D3-3) TOTAL AMOUNT
      item = document.createElement("div");
      item.className = "c-total";
      item.id = "c-total";
      item.innerHTML = `TOTAL: ${cart.currency}${cart.total.toFixed(2)}`;
      cart.hItems.appendChild(item);

      // (D3-4) EMPTY & CHECKOUT
      item = document.getElementById("template-cart-checkout").content.cloneNode(true);
      cart.hItems.appendChild(item);
    }
  },

  // (E) ADD ITEM INTO CART
  add : id => {
    if (cart.items[id] == undefined) { cart.items[id] = 1; }
    else { cart.items[id]++; }
    cart.save(); cart.list();
  },

  // (F) CHANGE QUANTITY
  change : (pid, qty) => {
    qty = parseInt(qty, 10);

    // (F1) REMOVE ITEM
    if (isNaN(qty) || qty <= 0) {
      delete cart.items[pid];
      cart.save(); cart.list();
    }

    // (F2) UPDATE TOTAL - recompute for the whole cart, then paint ONCE
    else {
      cart.items[pid] = qty;
      cart.save();
      cart.total = 0;
      for (let id in cart.items) {
        if (products[id]) { cart.total += cart.items[id] * products[id].price; }
      }
      document.getElementById("c-total").innerHTML = `TOTAL: ${cart.currency}${cart.total.toFixed(2)}`;
    }
  },

  // (G) REMOVE ITEM FROM CART
  remove : id => {
    delete cart.items[id];
    cart.save();
    cart.list();
  },

  // (H) CHECKOUT - push the local cart to the server (server resolves prices)
  checkout : async () => {
    // (H1) NOT LOGGED IN - send the user to the login page
    if (!window.api || !window.api.isLoggedIn()) {
      if (confirm("Log in to complete your order?")) {
        location.href = "../login/login.html";
      }
      return;
    }

    // (H2) SNAPSHOT SYNCABLE ITEMS (skip stale rows without catalogue data)
    const ids = Object.keys(cart.items).filter(id => products[id]);
    if (!ids.length) {
      cart.toast("Your cart is empty", "info");
      return;
    }

    const btn = document.querySelector(".c-checkout");
    if (window.ui) { window.ui.setButtonLoading(btn, true); }

    // (H3) POST EACH LINE ITEM SEQUENTIALLY, COLLECTING FAILURES.
    //      { carId, quantity } ONLY - the server resolves brand/price itself.
    let synced = 0;
    const failures = [];
    try {
      for (const id of ids) {
        try {
          await window.api.post("/cart", { carId : id, quantity : Number(cart.items[id]) });
          synced++;
        } catch (err) {
          failures.push((products[id].name || id) + " - " + (err && err.message ? err.message : "sync failed"));
        }
      }
    } finally {
      if (window.ui) { window.ui.setButtonLoading(btn, false); }
    }

    // (H4) SUMMARY - clear the LOCAL cart only when every item was posted
    if (failures.length === 0) {
      cart.items = {};
      cart.save();
      cart.list();
      cart.toast(`Order saved - ${synced} item${synced === 1 ? "" : "s"} synced`, "success");

      // (H5) OFFER A PEEK AT THE SERVER-SIDE CART
      if (confirm("Your order is saved to your RYNEX account. View your server cart now?")) {
        try {
          const res = await window.api.get("/cart");
          const rows = (res && res.data) || [];
          cart.toast(`Server cart: ${rows.length} line${rows.length === 1 ? "" : "s"} saved to your account`, "info");
        } catch (err) {
          cart.toast((err && err.message) || "Could not load the server cart", "error");
        }
      }
    } else if (synced > 0) {
      cart.toast(`Partially synced - ${synced} ok, ${failures.length} failed. ${failures[0]}`, "error");
    } else {
      cart.toast(failures[0] || "Checkout failed - please try again", "error");
    }
  }
};
window.addEventListener("DOMContentLoaded", () => {
  cart.init().catch(err => console.error("[RYNEX cart] init failed:", err));
});
