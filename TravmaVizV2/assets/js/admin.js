// CMS editor: all article data is sent to the same-origin server API.
(() => {
  const loginPanel = document.getElementById('login-panel');
  const workspace = document.getElementById('workspace');
  const connectionNotice = document.getElementById('connection-notice');
  const sessionStatus = document.getElementById('session-status');
  const logoutButton = document.getElementById('logout-button');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const articleForm = document.getElementById('article-form');
  const articleList = document.getElementById('article-list');
  const emptyList = document.getElementById('empty-list');
  const articleCount = document.getElementById('article-count');
  const formMessage = document.getElementById('form-message');
  const deleteButton = document.getElementById('delete-button');
  const fields = {
    id: document.getElementById('article-id'),
    title: document.getElementById('article-title'),
    category: document.getElementById('article-category'),
    summary: document.getElementById('article-summary'),
    body: document.getElementById('article-body')
  };
  let articles = [];
  let editingArticleId = '';

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: { ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Не удалось выполнить запрос.');
    return payload;
  }

  function showConnectionError() {
    connectionNotice.textContent = 'Серверный редактор не отвечает. Запустите сайт командой node server.mjs и откройте адрес, который указан в консоли. При обычной статической раздаче файлов управление статьями недоступно.';
    connectionNotice.hidden = false;
    sessionStatus.textContent = 'Сервер недоступен';
    loginPanel.hidden = true;
    workspace.hidden = true;
  }

  function setAuthenticated(authenticated) {
    loginPanel.hidden = authenticated;
    workspace.hidden = !authenticated;
    logoutButton.classList.toggle('hidden', !authenticated);
    sessionStatus.textContent = authenticated ? 'Вы вошли в редактор' : 'Требуется вход';
  }

  function resetEditor() {
    editingArticleId = '';
    fields.id.value = '';
    articleForm.reset();
    document.getElementById('editor-title').textContent = 'Новая статья';
    deleteButton.classList.add('hidden');
    setFormMessage('');
  }

  function setFormMessage(message, isError = false) {
    formMessage.textContent = message;
    formMessage.hidden = !message;
    formMessage.classList.toggle('text-text-muted', !isError);
    formMessage.classList.toggle('text-primary-600', isError);
  }

  function renderArticles() {
    articleList.replaceChildren();
    articleCount.textContent = articles.length ? articles.length + ' ' + wordForCount(articles.length) : '0';
    emptyList.hidden = articles.length > 0;
    articles.forEach((article) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'w-full rounded-xl border border-border bg-surface p-4 text-left transition hover:border-primary hover:bg-surface-2';
      button.setAttribute('aria-label', 'Редактировать: ' + article.title);
      button.addEventListener('click', () => openArticle(article));

      const row = document.createElement('span');
      row.className = 'flex flex-wrap items-center justify-between gap-2';
      const category = document.createElement('span');
      category.className = 'text-xs font-extrabold uppercase tracking-wider text-primary-600';
      category.textContent = article.category;
      const status = document.createElement('span');
      status.className = 'rounded-full border border-border bg-bg px-2.5 py-1 text-xs font-bold text-text-muted';
      status.textContent = article.status === 'published' ? 'Опубликована' : 'Черновик';
      row.append(category, status);

      const title = document.createElement('span');
      title.className = 'mt-3 block font-extrabold';
      title.textContent = article.title;
      const summary = document.createElement('span');
      summary.className = 'mt-1 block text-sm leading-relaxed text-text-muted';
      summary.textContent = article.summary;
      button.append(row, title, summary);
      item.append(button);
      articleList.append(item);
    });
  }

  function wordForCount(count) {
    const remainder100 = count % 100;
    const remainder10 = count % 10;
    if (remainder100 >= 11 && remainder100 <= 14) return 'статей';
    if (remainder10 === 1) return 'статья';
    if (remainder10 >= 2 && remainder10 <= 4) return 'статьи';
    return 'статей';
  }

  function openArticle(article) {
    editingArticleId = article.id;
    fields.id.value = article.id;
    fields.title.value = article.title;
    fields.category.value = article.category;
    fields.summary.value = article.summary;
    fields.body.value = article.body;
    document.getElementById('editor-title').textContent = article.status === 'published' ? 'Редактирование статьи' : 'Редактирование черновика';
    deleteButton.classList.remove('hidden');
    setFormMessage('');
    fields.title.focus();
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  async function loadArticles() {
    const payload = await api('/api/admin/articles');
    articles = payload.articles;
    renderArticles();
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.hidden = true;
    const passwordInput = document.getElementById('admin-password');
    try {
      await api('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: passwordInput.value }) });
      passwordInput.value = '';
      setAuthenticated(true);
      await loadArticles();
    } catch (error) {
      if (error instanceof TypeError) return showConnectionError();
      loginError.textContent = error.message;
      loginError.hidden = false;
    }
  });

  articleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    const payload = {
      title: fields.title.value,
      category: fields.category.value,
      summary: fields.summary.value,
      body: fields.body.value,
      status: submitter?.dataset.saveStatus || 'draft'
    };
    const button = submitter;
    if (button) button.disabled = true;
    setFormMessage('Сохраняем…');
    try {
      const isEditing = Boolean(editingArticleId);
      const url = isEditing ? '/api/admin/articles/' + encodeURIComponent(editingArticleId) : '/api/admin/articles';
      await api(url, { method: isEditing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      resetEditor();
      await loadArticles();
      setFormMessage(payload.status === 'published' ? 'Статья опубликована и будет видна посетителям сайта.' : 'Черновик сохранён. Посетители его пока не увидят.');
    } catch (error) {
      setFormMessage(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  });

  document.getElementById('new-article-button').addEventListener('click', resetEditor);

  deleteButton.addEventListener('click', async () => {
    const current = articles.find((article) => article.id === editingArticleId);
    if (!current || !window.confirm('Удалить статью «' + current.title + '»?')) return;
    deleteButton.disabled = true;
    try {
      await api('/api/admin/articles/' + encodeURIComponent(editingArticleId), { method: 'DELETE' });
      resetEditor();
      await loadArticles();
    } catch (error) {
      setFormMessage(error.message, true);
    } finally {
      deleteButton.disabled = false;
    }
  });

  logoutButton.addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
    setAuthenticated(false);
    resetEditor();
    articles = [];
    articleList.replaceChildren();
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.classList.remove('light', 'dark');
    root.classList.add(nextTheme);
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme;
    try { localStorage.setItem('travmaviz-theme', nextTheme); } catch {}
    document.getElementById('theme-toggle').setAttribute('aria-pressed', String(nextTheme === 'dark'));
  });

  async function initialize() {
    try {
      const payload = await api('/api/admin/session');
      setAuthenticated(Boolean(payload.authenticated));
      if (payload.authenticated) await loadArticles();
    } catch {
      showConnectionError();
    }
  }

  initialize();
})();
