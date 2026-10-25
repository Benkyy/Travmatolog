/* Навигация по разделам, серверные статьи, поиск и просмотр документов. */
(() => {
  const pages = Array.from(document.querySelectorAll('[data-page]'));
  const aliases = { main: 'doctor', about: 'doctor', education: 'certificates', problems: 'conditions' };
  const searchSynonyms = { 'joint-pain':'суставы колено плечо локоть боль', arthrosis:'остеоартрит хрящ', 'sports-injury':'спорт тренировка бег футбол', 'knee-ligament':'мениск связки колено', fracture:'перелом кость трещина', 'heel-pain':'пятка пяточная шпора стопа фасциит', 'back-pain':'спина позвоночник поясница', 'shoulder-pain':'плечо рука', rehabilitation:'восстановление реабилитация операция' };
  const managedArticles = [];
  const pageTitle = document.getElementById('page-title');
  const kicker = document.getElementById('page-kicker');
  const description = document.getElementById('page-description');
  const breadcrumb = document.getElementById('breadcrumb-current');
  const routeLinks = Array.from(document.querySelectorAll('[data-route]'));
  const parentRoute = { arthrosis:'conditions', 'knee-ligament':'conditions', 'heel-pain':'conditions', 'back-pain':'conditions', 'shoulder-pain':'conditions', 'article-consultation':'articles', 'article-sports':'articles', 'article-rehab':'articles', 'managed-article':'articles' };

  function routeFromHash() {
    const raw = window.location.hash.replace(/^#\/?/, '').split(/[?&]/)[0] || 'doctor';
    if (raw.startsWith('article/')) {
      try { return 'managed:' + decodeURIComponent(raw.slice('article/'.length)); } catch { return 'doctor'; }
    }
    return aliases[raw] || raw;
  }

  function routeHref(route) {
    return route.startsWith('managed:') ? '#/article/' + encodeURIComponent(route.slice('managed:'.length)) : '#/' + route;
  }

  function renderManagedBody(article) {
    const body = document.getElementById('managed-article-body');
    const meta = document.getElementById('managed-article-meta');
    if (!body || !meta) return;
    meta.textContent = article.category + (article.publishedAt ? ' · ' + new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(article.publishedAt)) : '');
    body.replaceChildren();
    String(article.body || '').split(/\r?\n\s*\r?\n/).filter((paragraph) => paragraph.trim()).forEach((paragraph) => {
      const element = document.createElement('p');
      element.className = 'whitespace-pre-line text-base leading-relaxed text-text-muted';
      element.textContent = paragraph.trim();
      body.append(element);
    });
  }

  function renderRoute(route, moveFocus) {
    const slug = route.startsWith('managed:') ? route.slice('managed:'.length) : '';
    const managedArticle = slug ? managedArticles.find((article) => article.slug === slug) : null;
    const requestedPage = slug && managedArticle ? 'managed-article' : route;
    const active = pages.find((page) => page.dataset.page === requestedPage) || pages.find((page) => page.dataset.page === 'doctor');
    pages.forEach((page) => { page.hidden = page !== active; });

    const activeTitle = managedArticle ? managedArticle.title : active.dataset.title;
    const activeKicker = managedArticle ? managedArticle.category + ' · статья' : active.dataset.kicker;
    const activeDescription = managedArticle ? managedArticle.summary : active.dataset.description;
    pageTitle.textContent = activeTitle;
    kicker.textContent = activeKicker;
    description.textContent = activeDescription;
    breadcrumb.textContent = activeTitle;
    if (managedArticle) renderManagedBody(managedArticle);
    document.title = active.dataset.page === 'doctor' ? 'Бесчастнов Дмитрий Валерьевич — травматолог-ортопед | ГБУЗ «Диагностический центр №3 ДЗМ»' : activeTitle + ' — Бесчастнов Дмитрий Валерьевич | Травматолог-ортопед';
    routeLinks.forEach((link) => {
      const topLevel = link.classList.contains('top-tab') || link.classList.contains('topic-tab');
      const selected = link.dataset.route === active.dataset.page || (topLevel && link.dataset.route === parentRoute[active.dataset.page]);
      if (selected) {
        link.setAttribute('aria-current', 'page');
        link.classList.add('is-active');
      } else {
        link.removeAttribute('aria-current');
        link.classList.remove('is-active');
      }
    });
    if (moveFocus) {
      pageTitle.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }

  function goTo(route) {
    const canonical = route.startsWith('managed:') ? route : (aliases[route] || route);
    if (canonical.startsWith('managed:') && !managedArticles.some((article) => article.slug === canonical.slice('managed:'.length))) return;
    if (!canonical.startsWith('managed:') && !pages.some((page) => page.dataset.page === canonical)) return;
    const nextHash = routeHref(canonical);
    if (window.location.hash !== nextHash) window.history.pushState({ route: canonical }, '', nextHash);
    renderRoute(canonical, true);
  }

  function renderManagedCards() {
    const grid = document.getElementById('article-card-grid');
    if (!grid) return;
    grid.querySelectorAll('[data-managed-article]').forEach((card) => card.remove());
    managedArticles.forEach((article) => {
      const route = 'managed:' + article.slug;
      const card = document.createElement('a');
      card.href = routeHref(route);
      card.dataset.route = route;
      card.dataset.managedArticle = article.id;
      card.className = 'article-card';

      const label = document.createElement('span');
      label.className = 'article-label';
      label.textContent = article.category.toLocaleUpperCase('ru');
      const title = document.createElement('h2');
      title.textContent = article.title;
      const summary = document.createElement('p');
      summary.textContent = article.summary;
      const action = document.createElement('span');
      action.className = 'topic-more';
      action.textContent = 'Читать статью →';
      card.append(label, title, summary, action);
      grid.append(card);
    });
  }

  async function loadManagedArticles() {
    const status = document.getElementById('managed-article-status');
    try {
      const response = await fetch('/api/articles', { cache: 'no-store' });
      if (!response.ok) throw new Error('Publication service unavailable');
      const payload = await response.json();
      managedArticles.splice(0, managedArticles.length, ...(Array.isArray(payload.articles) ? payload.articles : []));
      renderManagedCards();
      if (status) status.hidden = true;
      renderRoute(routeFromHash(), false);
    } catch {
      if (status) {
        status.textContent = 'Дополнительные публикации сейчас недоступны. Основные материалы сайта остаются открыты.';
        status.hidden = false;
      }
    }
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-route]');
    if (!link) return;
    event.preventDefault();
    goTo(link.dataset.route);
    const search = document.getElementById('site-search');
    const results = document.getElementById('search-results');
    if (search) search.value = '';
    if (results) results.hidden = true;
  });
  window.addEventListener('hashchange', () => renderRoute(routeFromHash(), false));
  window.addEventListener('popstate', () => renderRoute(routeFromHash(), false));
  renderRoute(routeFromHash(), false);
  loadManagedArticles();

  const searchInput = document.getElementById('site-search');
  const searchButton = document.getElementById('search-button');
  const searchResults = document.getElementById('search-results');

  function getSearchIndex() {
    const pagesIndex = Array.from(document.querySelectorAll('[data-page]'))
      .filter((page) => page.dataset.page !== 'managed-article')
      .map((page) => ({ route: page.dataset.page, title: page.dataset.title, text: page.textContent }));
    const topics = [
      { route: 'joint-pain', title: 'Боли в суставах' }, { route: 'arthrosis', title: 'Артроз' },
      { route: 'sports-injury', title: 'Спортивные травмы' }, { route: 'knee-ligament', title: 'Связки и мениск колена' },
      { route: 'fracture', title: 'Переломы' }, { route: 'heel-pain', title: 'Боль в пятке' },
      { route: 'back-pain', title: 'Боль в спине' }, { route: 'shoulder-pain', title: 'Боль в плече' },
      { route: 'rehabilitation', title: 'Реабилитация после травмы' }, { route: 'services', title: 'Услуги и направления приёма' }
    ];
    const articles = managedArticles.map((article) => ({ route: 'managed:' + article.slug, title: article.title, text: article.category + ' ' + article.summary + ' ' + article.body }));
    return pagesIndex.concat(topics, articles);
  }

  function showSearchResults() {
    const query = searchInput.value.trim().toLocaleLowerCase('ru');
    searchResults.replaceChildren();
    if (!query) {
      searchResults.hidden = true;
      return;
    }
    const matches = getSearchIndex().filter((item, index, all) => {
      const searchable = (item.title + ' ' + (item.text || '') + ' ' + (searchSynonyms[item.route] || '')).toLocaleLowerCase('ru');
      return searchable.includes(query) && all.findIndex((candidate) => candidate.route === item.route) === index;
    }).slice(0, 8);
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.className = 'rounded-lg px-3 py-2 text-sm text-text-muted';
      empty.textContent = 'По этому запросу ничего не найдено.';
      searchResults.append(empty);
    } else {
      matches.forEach((item) => {
        const link = document.createElement('a');
        link.href = routeHref(item.route);
        link.dataset.route = item.route;
        link.className = 'block rounded-lg px-3 py-2 text-sm font-semibold transition hover:bg-surface';
        link.textContent = item.title;
        searchResults.append(link);
      });
    }
    searchResults.hidden = false;
  }
  searchInput.addEventListener('input', showSearchResults);
  searchInput.addEventListener('focus', showSearchResults);
  searchButton.addEventListener('click', showSearchResults);
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      searchResults.hidden = true;
      searchInput.blur();
    } else if (event.key === 'Enter') {
      const firstResult = searchResults.querySelector('a[data-route]');
      if (firstResult) {
        event.preventDefault();
        goTo(firstResult.dataset.route);
        searchResults.hidden = true;
        searchInput.value = '';
      }
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#site-search') && !event.target.closest('#search-results') && !event.target.closest('#search-button')) searchResults.hidden = true;
  });

  const modal = document.getElementById('document-modal');
  const viewer = document.getElementById('document-viewer');
  let lastTrigger = null;
  document.querySelectorAll('[data-document-pages]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      if (!modal || typeof modal.showModal !== 'function') return;
      lastTrigger = trigger;
      document.getElementById('document-modal-title').textContent = trigger.dataset.documentTitle;
      viewer.replaceChildren();
      const pageImages = trigger.dataset.documentPages.split('|');
      pageImages.forEach((src, index) => {
        const figure = document.createElement('figure');
        figure.className = 'mb-4 last:mb-0';
        const status = document.createElement('p');
        status.className = 'p-4 text-sm text-text-muted';
        status.setAttribute('role', 'status');
        status.textContent = 'Загрузка страницы ' + (index + 1) + '…';
        const image = document.createElement('img');
        image.className = 'mx-auto block h-auto w-full';
        image.alt = trigger.dataset.documentTitle + ' — страница ' + (index + 1) + ' из ' + pageImages.length;
        image.decoding = 'async';
        image.addEventListener('load', () => status.remove(), { once: true });
        image.addEventListener('error', () => { status.textContent = 'Не удалось загрузить изображение страницы.'; }, { once: true });
        image.src = src;
        figure.append(status, image);
        viewer.append(figure);
      });
      modal.showModal();
      viewer.scrollTop = 0;
      modal.querySelector('[data-modal-close]').focus();
    });
  });
  document.querySelectorAll('[data-modal-close]').forEach((control) => control.addEventListener('click', () => modal.close()));
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.close(); });
  modal.addEventListener('close', () => {
    viewer.replaceChildren();
    if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus();
  });
})();
