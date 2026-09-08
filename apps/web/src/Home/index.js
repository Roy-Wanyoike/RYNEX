(function () {
  'use strict';

  // --- Footer: auto-set the copyright year -------------------------------
  var yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  // --- Newsletter subscribe button (moved off the inline onclick) --------
  var newsletterBtn = document.getElementById('newsletter-btn');
  if (newsletterBtn) {
    newsletterBtn.addEventListener('click', function () {
      window.alert('Thank you!! You will be receiving updates on your email');
    });
  }

  // --- Hero slideshow -----------------------------------------------------
  // Dependency-free. Hardened against the old assumptions:
  //   * zero images  -> no-op (old code crashed on index 0)
  //   * one image    -> static hero, no timer
  //   * reduced motion -> static first image, no animation at all
  //   * next slide is preloaded/decoded before it fades in

  var SLIDE_DELAY_MS = 5000;
  var LOAD_FALLBACK_MS = 8000; // never stall the show on a hanging/broken image

  var slides = Array.prototype.slice.call(
    document.querySelectorAll('.intro-slideshow img')
  );

  var prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (slides.length === 0) {
    return; // no slideshow markup on the page: nothing to do
  }

  if (prefersReducedMotion) {
    slides.forEach(function (img) {
      img.style.transition = 'none'; // also kill the 0.75s fade-in on first paint
    });
  }

  // The first image is shown in every mode.
  slides[0].style.opacity = '1';

  // Fewer than two images, or reduced motion: keep the hero static.
  if (slides.length < 2 || prefersReducedMotion) {
    return;
  }

  var current = 0;

  // Resolves once the next slide is loaded and decoded so it never fades
  // in blank. Warms the browser cache via a detached <img> first, then
  // waits for decode() (with a load/error-listener fallback for old
  // browsers). A broken or never-loading image must not freeze the show,
  // so the promise is raced against a generous timeout.
  function whenReady(img) {
    if (img.complete && img.naturalWidth > 0) {
      return Promise.resolve(img);
    }
    var warm = new Image();
    warm.src = img.currentSrc || img.src;

    var ready =
      typeof img.decode === 'function'
        ? img.decode()
        : new Promise(function (resolve, reject) {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', reject, { once: true });
          });

    return Promise.race([
      ready.catch(function () {
        /* broken image: still advance rather than freeze */
      }),
      new Promise(function (resolve) {
        window.setTimeout(resolve, LOAD_FALLBACK_MS);
      })
    ]).then(function () {
      return img;
    });
  }

  function advance() {
    var nextIndex = (current + 1) % slides.length;
    whenReady(slides[nextIndex]).then(function (img) {
      slides[current].style.opacity = '0';
      current = nextIndex;
      img.style.opacity = '1';
      // Schedule the next cycle only after this slide is visible, so a
      // slow-loading image can never make two transitions overlap.
      window.setTimeout(advance, SLIDE_DELAY_MS);
    });
  }

  window.setTimeout(advance, SLIDE_DELAY_MS);
})();
