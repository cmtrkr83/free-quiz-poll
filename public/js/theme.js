/* Açık / karanlık tema — her iki ekranda ortak. */
(() => {
  'use strict';

  const KEY = 'co:theme';
  const COLORS = { dark: '#070a14', light: '#f3f5fb' };

  function savedTheme() {
    try {
      const value = localStorage.getItem(KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }

  function systemTheme() {
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }

  const current = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

  function updateMeta(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COLORS[theme]);
    let scheme = document.querySelector('meta[name="color-scheme"]');
    if (!scheme) {
      scheme = document.createElement('meta');
      scheme.setAttribute('name', 'color-scheme');
      document.head.appendChild(scheme);
    }
    scheme.setAttribute('content', theme === 'light' ? 'light' : 'dark');
  }

  function updateButtons() {
    const theme = current();
    const next = theme === 'dark' ? 'light' : 'dark';
    const icon = theme === 'dark' ? '☀' : '☾';
    const title = next === 'light' ? 'Açık temaya geç' : 'Karanlık temaya geç';
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      // Aynı değeri yeniden yazmak DOM değişikliği üretir ve MutationObserver'ı
      // tekrar tetikleyerek sonsuz yenileme döngüsüne yol açar.
      if (button.textContent !== icon) button.textContent = icon;
      if (button.title !== title) button.title = title;
      if (button.getAttribute('aria-label') !== title) button.setAttribute('aria-label', title);
      const pressed = String(theme === 'light');
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    });
  }

  function apply(theme, persist = false) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    updateMeta(next);
    updateButtons();
    if (persist) {
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* gizli mod */
      }
    }
  }

  function toggle() {
    apply(current() === 'dark' ? 'light' : 'dark', true);
  }

  function createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn theme-toggle';
    button.setAttribute('data-theme-toggle', '');
    button.addEventListener('click', toggle);
    return button;
  }

  function sync() {
    document.querySelectorAll('.topbar, .p-top').forEach((bar) => {
      if (!bar.querySelector('[data-theme-toggle]')) bar.appendChild(createButton());
    });
    updateButtons();
  }

  apply(savedTheme() || systemTheme());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync, { once: true });
  } else {
    sync();
  }

  // SPA ekranları yeniden çizdiğinde düğmeyi geri ekle.
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sync();
    });
  });
  const startObserver = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });

  window.CanliTheme = { apply, toggle, sync, current };
})();
