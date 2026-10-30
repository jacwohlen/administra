// Light/dark switch of the marketing site. Until the visitor picks one, the
// device's setting applies (prefers-color-scheme in site.css); a choice is
// a class on <html> and stays in this browser's localStorage, nothing is
// sent anywhere. Loaded in <head> so the saved choice applies before the
// first paint; without JavaScript the switch stays hidden.
(() => {
  const root = document.documentElement;
  const key = 'adsumus-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');

  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') root.classList.add(saved);
  } catch {
    // Storage blocked (private mode, strict settings): follow the device
  }
  root.classList.add('js');

  const isDark = () =>
    root.classList.contains('dark') || (!root.classList.contains('light') && system.matches);

  const sync = () => {
    for (const button of document.querySelectorAll('.theme-toggle')) {
      button.setAttribute('aria-pressed', String(isDark()));
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    sync();
    for (const button of document.querySelectorAll('.theme-toggle')) {
      button.addEventListener('click', () => {
        const next = isDark() ? 'light' : 'dark';
        root.classList.remove('light', 'dark');
        root.classList.add(next);
        try {
          localStorage.setItem(key, next);
        } catch {
          // Not remembered, but switched for this page
        }
        sync();
      });
    }
  });
  system.addEventListener('change', sync);
})();
