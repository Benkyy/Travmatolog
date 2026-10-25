/* Предпочтение хранится локально. До явного выбора следуем системной теме. */
(() => {
  const root = document.documentElement;
  const button = document.getElementById('theme-toggle');
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = null;
  try { preference = localStorage.getItem('travmaviz-theme'); } catch { /* Хранилище может быть недоступно. */ }
  if (!['light', 'dark'].includes(preference)) preference = null;

  function applyTheme(theme) {
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const isDark = theme === 'dark';
    button.setAttribute('aria-pressed', String(isDark));
    const label = isDark ? 'Включить светлую тему' : 'Включить тёмную тему';
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  applyTheme(preference || (system.matches ? 'dark' : 'light'));
  button.addEventListener('click', () => {
    preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(preference);
    try { localStorage.setItem('travmaviz-theme', preference); } catch { /* Выбор остаётся в текущей вкладке. */ }
  });
  system.addEventListener('change', event => {
    if (!preference) applyTheme(event.matches ? 'dark' : 'light');
  });
  window.addEventListener('storage', event => {
    if (event.key !== 'travmaviz-theme' && event.key !== null) return;
    preference = ['light', 'dark'].includes(event.newValue) ? event.newValue : null;
    applyTheme(preference || (system.matches ? 'dark' : 'light'));
  });

  // Закрываем мобильную навигацию после перехода и по Escape.
  const menu = document.getElementById('mobile-menu');
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => { menu.open = false; }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  const header = document.getElementById('site-header');
  const updateHeader = () => header.classList.toggle('shadow-soft', window.scrollY > 8);
  window.addEventListener('scroll', updateHeader, { passive: true });
  updateHeader();
  document.getElementById('year').textContent = new Date().getFullYear();
})();
