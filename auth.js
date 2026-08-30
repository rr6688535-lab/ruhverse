'use strict';

(() => {
  const TOKEN_KEY = 'ruhverse_auth_token';
  const state = {
    token: '',
    user: null,
    bookmarks: [],
    authMode: 'login',
    currentSurah: { number: null, name: '' }
  };

  const ui = {
    authBtn: null,
    bookmarkToggleBtn: null,
    mobileAuthSlot: null,
    bookmarksCountBadge: null,
    bookmarksBackdrop: null,
    bookmarksPanel: null,
    bookmarksList: null,
    bookmarksEmpty: null,
    bookmarksStatus: null,
    clearBookmarksBtn: null,
    modal: null,
    modalTitle: null,
    modalHint: null,
    usernameInput: null,
    emailInput: null,
    passwordInput: null,
    submitBtn: null,
    switchBtn: null,
    switchHint: null,
    errorText: null,
    form: null,
    toast: null
  };
  let viewportBindingAttached = false;

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.body.classList.contains('quran-page-body')) return;
    initAuthAndBookmarks().catch((err) => {
      console.error('Auth bootstrap failed:', err);
    });
  });

  // Bootstraps auth + bookmark UI state when the Quran page loads.
  async function initAuthAndBookmarks() {
    ensureScaffold();
    bindUiEvents();

    state.token = localStorage.getItem(TOKEN_KEY) || '';
    await bootstrapSession();
    updateAuthUi();
    renderBookmarksPanel();
    decorateVerseBlocksForBookmarks();
    handleAuthIntentFromQuery();

    document.addEventListener('ruhverse:surah-rendered', (event) => {
      const detail = event?.detail || {};
      state.currentSurah = {
        number: Number(detail.surahNumber) || null,
        name: String(detail.surahName || '').trim()
      };
      decorateVerseBlocksForBookmarks();
      syncBookmarkButtons();
    });
  }

  // Opens login/register modal when `?auth=login|register` is present in the URL.
  function handleAuthIntentFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const authIntent = String(params.get('auth') || '').trim().toLowerCase();
    if (authIntent !== 'login' && authIntent !== 'register') return;

    params.delete('auth');
    const query = params.toString();
    const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', cleanUrl);

    if (state.user) return;
    setAuthMode(authIntent === 'register' ? 'register' : 'login');
    openModal();
  }

  // Ensures required auth/bookmark DOM nodes exist before binding behavior.
  function ensureScaffold() {
    const controls = document.querySelector('.sidebar-controls');
    if (controls && !document.getElementById('auth-toggle-btn')) {
      const authBtn = document.createElement('button');
      authBtn.id = 'auth-toggle-btn';
      authBtn.className = 'premium-login-btn quran-auth-login-btn';
      authBtn.type = 'button';
      authBtn.innerHTML = '<span class="premium-login-sub">RuhVerse</span><span class="premium-login-main">Login</span>';
      authBtn.title = 'Login';
      controls.appendChild(authBtn);
    }

    if (controls && !document.getElementById('bookmarks-toggle-btn')) {
      const bookmarksBtn = document.createElement('button');
      bookmarksBtn.id = 'bookmarks-toggle-btn';
      bookmarksBtn.className = 'bookmarks-toggle-btn';
      bookmarksBtn.type = 'button';
      bookmarksBtn.innerHTML = `
        <span class="bookmarks-toggle-icon" aria-hidden="true">&#128278;</span>
        <span class="bookmarks-toggle-text">Bookmarks</span>
        <span class="bookmarks-toggle-count" id="bookmarks-toggle-count">0</span>
      `;
      bookmarksBtn.title = 'Open bookmarks';
      bookmarksBtn.setAttribute('aria-expanded', 'false');
      controls.appendChild(bookmarksBtn);
    }

    const toolbarLead = document.querySelector('.quran-toolbar > div') || document.querySelector('.quran-toolbar');
    if (toolbarLead && !document.getElementById('quran-mobile-auth-slot')) {
      const slot = document.createElement('div');
      slot.id = 'quran-mobile-auth-slot';
      slot.className = 'quran-mobile-auth-slot';
      toolbarLead.appendChild(slot);
    }
    let panel = document.getElementById('bookmarks-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'bookmarks-panel';
      panel.className = 'bookmarks-panel';
      panel.innerHTML = `
        <div class="bookmarks-head">
          <h3>Saved Bookmarks</h3>
          <button type="button" id="clear-bookmarks-btn" class="clear-bookmarks-btn" aria-label="Delete all bookmarks" title="Delete all bookmarks">&#128465;</button>
        </div>
        <p id="bookmarks-status" class="bookmarks-status">Sign in to sync your Quran bookmarks.</p>
        <p id="bookmarks-empty" class="bookmarks-empty">No bookmarks yet.</p>
        <ul id="bookmarks-list" class="bookmarks-list"></ul>
      `;
      document.body.appendChild(panel);
    } else if (panel.parentElement !== document.body) {
      // Keep this modal outside transformed containers such as the mobile sidebar.
      document.body.appendChild(panel);
    }

    let backdrop = document.getElementById('bookmarks-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'bookmarks-backdrop';
      backdrop.className = 'bookmarks-backdrop';
      document.body.appendChild(backdrop);
    } else if (backdrop.parentElement !== document.body) {
      document.body.appendChild(backdrop);
    }

    if (!document.getElementById('auth-modal')) {
      const modal = document.createElement('div');
      modal.className = 'modal auth-modal home-auth-modal';
      modal.id = 'auth-modal';
      modal.innerHTML = `
        <div class="modal-content home-auth-content auth-modal-content">
          <button type="button" class="home-auth-close auth-close-btn" id="auth-close-btn" aria-label="Close login dialog">&times;</button>
          <p class="home-auth-tag">RuhVerse Member Access</p>
          <h3 id="auth-modal-title">Login to Continue Your Journey</h3>
          <p id="auth-modal-hint" class="home-auth-hint auth-modal-hint">Sign in to sync bookmarks and reading progress.</p>
          <form id="auth-form" class="auth-form home-auth-form" autocomplete="on">
            <input id="auth-username" class="input-field home-auth-input" type="text" placeholder="Choose a username" minlength="2" maxlength="40" hidden disabled />
            <input id="auth-email" class="input-field home-auth-input" type="email" placeholder="Enter your email" required />
            <input id="auth-password" class="input-field home-auth-input" type="password" placeholder="Enter your password" required minlength="6" />
            <button id="auth-submit-btn" class="home-auth-submit auth-submit-btn" type="submit">Login</button>
          </form>
          <p class="home-auth-switch-row auth-switch-row">
            <span id="auth-switch-hint">Do not have an account?</span>
            <button id="auth-switch-btn" class="home-auth-switch-btn auth-switch-btn" type="button">Create one</button>
          </p>
          <p id="auth-error" class="home-auth-error auth-error" role="alert" aria-live="polite"></p>
        </div>
      `;
      document.body.appendChild(modal);
    }

    if (!document.getElementById('auth-toast')) {
      const toast = document.createElement('div');
      toast.id = 'auth-toast';
      toast.className = 'auth-toast';
      document.body.appendChild(toast);
    }

    ui.authBtn = document.getElementById('auth-toggle-btn');
    ui.bookmarkToggleBtn = document.getElementById('bookmarks-toggle-btn');
    ui.mobileAuthSlot = document.getElementById('quran-mobile-auth-slot');
    ui.bookmarksCountBadge = document.getElementById('bookmarks-toggle-count');
    ui.bookmarksBackdrop = document.getElementById('bookmarks-backdrop');
    ui.bookmarksPanel = document.getElementById('bookmarks-panel');
    ui.bookmarksList = document.getElementById('bookmarks-list');
    ui.bookmarksEmpty = document.getElementById('bookmarks-empty');
    ui.bookmarksStatus = document.getElementById('bookmarks-status');
    ui.clearBookmarksBtn = document.getElementById('clear-bookmarks-btn');
    ui.modal = document.getElementById('auth-modal');
    ui.modalTitle = document.getElementById('auth-modal-title');
    ui.modalHint = document.getElementById('auth-modal-hint');
    ui.usernameInput = document.getElementById('auth-username');
    ui.emailInput = document.getElementById('auth-email');
    ui.passwordInput = document.getElementById('auth-password');
    ui.submitBtn = document.getElementById('auth-submit-btn');
    ui.switchBtn = document.getElementById('auth-switch-btn');
    ui.switchHint = document.getElementById('auth-switch-hint');
    ui.errorText = document.getElementById('auth-error');
    ui.form = document.getElementById('auth-form');
    ui.toast = document.getElementById('auth-toast');
    placeQuranAuthControlsForViewport();
  }

  // Wires all auth, modal, bookmark, and keyboard event handlers.
  function bindUiEvents() {
    if (!viewportBindingAttached) {
      window.addEventListener('resize', placeQuranAuthControlsForViewport);
      window.addEventListener('orientationchange', placeQuranAuthControlsForViewport);
      viewportBindingAttached = true;
    }

    if (ui.authBtn) {
      ui.authBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (state.user) {
          logout();
          showToast('Logged out.');
          return;
        }
        setAuthMode('login');
        openModal();
      });
    }

    if (ui.bookmarkToggleBtn && ui.bookmarksPanel) {
      ui.bookmarkToggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (ui.bookmarksPanel.classList.contains('open')) {
          closeBookmarksPanel();
        } else {
          openBookmarksPanel();
        }
      });
    }

    if (ui.clearBookmarksBtn) {
      ui.clearBookmarksBtn.addEventListener('click', async () => {
        if (!state.user) {
          showToast('Login first to manage bookmarks.', true);
          return;
        }
        if (!state.bookmarks.length) return;

        const ok = window.confirm('Clear all saved bookmarks?');
        if (!ok) return;

        try {
          for (const bookmark of [...state.bookmarks]) {
            await apiRequest(`/api/bookmarks/${bookmark.surahNumber}/${bookmark.ayahNumber}`, { method: 'DELETE' });
          }
          state.bookmarks = [];
          renderBookmarksPanel();
          syncBookmarkButtons();
          showToast('All bookmarks cleared.');
        } catch (err) {
          showToast(err.message || 'Could not clear bookmarks.', true);
        }
      });
    }

    if (ui.form) {
      ui.form.addEventListener('submit', async (event) => {
        event.preventDefault();
        ui.errorText.textContent = '';
        const username = String(ui.usernameInput?.value || '').trim();
        const email = String(ui.emailInput?.value || '').trim();
        const password = String(ui.passwordInput?.value || '');

        if (!email || !password) {
          ui.errorText.textContent = 'Email and password are required.';
          return;
        }
        if (state.authMode === 'register' && username.length < 2) {
          ui.errorText.textContent = 'Username must be at least 2 characters.';
          return;
        }

        ui.submitBtn.disabled = true;
        try {
          if (state.authMode === 'register') {
            const result = await register(username, email, password);
            if (result?.requiresEmailVerification) {
              closeModal();
              showToast(result?.message || 'Email verification sent. Please check your email.');
              return;
            }
            if (result?.token) {
              state.token = result.token;
              state.user = result.user || { username, email };
              persistToken();
              await fetchBookmarks();
              updateAuthUi();
              renderBookmarksPanel();
              syncBookmarkButtons();
              closeModal();
              showToast(result?.message || 'Account created and login successful.');
              return;
            }
            closeModal();
            showToast(result?.message || 'Email verification sent. Please check your email.');
            return;
          } else {
            await login(email, password);
            showToast('Login successful.');
            closeModal();
          }
        } catch (err) {
          let message = err.message || 'Authentication failed.';
          if (/sending confirmation|confirmation email|smtp/i.test(message)) {
            message = 'Account created, but verification email could not be delivered yet. Please try again in a minute.';
          }
          if (state.authMode === 'register' && /could not create account|create account right now/i.test(message) && email) {
            try {
              const resend = await apiRequest('/api/auth/resend-verification', {
                method: 'POST',
                auth: false,
                body: { email }
              });
              closeModal();
              showToast(resend?.message || 'Email verification sent. Please check your email.');
              return;
            } catch (_) {
              closeModal();
              showToast('Email verification may already be sent. Please check your inbox and spam folder.');
              return;
            }
          }
          let helper = '';
          if (
            state.authMode === 'login' &&
            /verify your email|email not confirmed|email confirmation/i.test(message) &&
            email
          ) {
            apiRequest('/api/auth/resend-verification', {
              method: 'POST',
              auth: false,
              body: { email }
            }).catch(() => null);
            helper = ' We sent a fresh verification email.';
          }
          ui.errorText.textContent = `${message}${helper}`;
        } finally {
          ui.submitBtn.disabled = false;
        }
      });
    }

    if (ui.switchBtn) {
      ui.switchBtn.addEventListener('click', () => {
        setAuthMode(state.authMode === 'login' ? 'register' : 'login');
      });
    }

    const closeBtn = document.getElementById('auth-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }

    if (ui.modal) {
      ui.modal.addEventListener('click', (event) => {
        if (event.target === ui.modal) closeModal();
      });
    }

    if (ui.bookmarksBackdrop) {
      ui.bookmarksBackdrop.addEventListener('click', closeBookmarksPanel);
    }

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (ui.modal?.style.display === 'flex') closeModal();
      if (ui.bookmarksPanel?.classList.contains('open')) closeBookmarksPanel();
    });

    if (ui.bookmarksList) {
      ui.bookmarksList.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.matches('[data-action="jump"]')) {
          const surahNumber = Number(target.getAttribute('data-surah'));
          const ayahNumber = Number(target.getAttribute('data-ayah'));
          await jumpToBookmark(surahNumber, ayahNumber);
          return;
        }

        if (target.matches('[data-action="remove"]')) {
          if (!state.user) return;
          const surahNumber = Number(target.getAttribute('data-surah'));
          const ayahNumber = Number(target.getAttribute('data-ayah'));
          try {
            await apiRequest(`/api/bookmarks/${surahNumber}/${ayahNumber}`, { method: 'DELETE' });
            state.bookmarks = state.bookmarks.filter((x) => !(x.surahNumber === surahNumber && x.ayahNumber === ayahNumber));
            renderBookmarksPanel();
            syncBookmarkButtons();
            showToast('Bookmark removed.');
          } catch (err) {
            showToast(err.message || 'Failed to remove bookmark.', true);
          }
        }
      });
    }
  }

  // Restores an existing session token and loads user bookmarks.
  async function bootstrapSession() {
    if (!state.token) {
      state.user = null;
      state.bookmarks = [];
      return;
    }

    const cachedUser = localStorage.getItem('ruhverse_auth_user');
    if (cachedUser) {
      try {
        state.user = JSON.parse(cachedUser);
      } catch (_) {}
    }

    try {
      const me = await apiRequest('/api/auth/me');
      if (me && me.user) {
        state.user = me.user;
        localStorage.setItem('ruhverse_auth_user', JSON.stringify(me.user));
      }
      await fetchBookmarks();
    } catch (err) {
      const msg = String(err?.message || '');
      if (/401|403|unauthorized|invalid session/i.test(msg)) {
        logout();
      }
    }
  }

  // Calls register API and returns server payload for auth flow handling.
  async function register(username, email, password) {
    return apiRequest('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: { username, email, password }
    });
  }

  // Logs in, persists token, and refreshes UI/bookmark state.
  async function login(email, password) {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: { email, password }
    });
    state.token = data.token || '';
    state.user = data.user || null;
    persistToken();
    if (state.user) {
      localStorage.setItem('ruhverse_auth_user', JSON.stringify(state.user));
    }
    await fetchBookmarks();
    updateAuthUi();
    renderBookmarksPanel();
    syncBookmarkButtons();
  }

  // Clears local session state and resets authenticated UI.
  function logout() {
    state.user = null;
    state.bookmarks = [];
    state.token = '';
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('ruhverse_auth_user');
    updateAuthUi();
    renderBookmarksPanel();
    syncBookmarkButtons();
  }

  // Fetches bookmarks for the signed-in user.
  async function fetchBookmarks() {
    if (!state.user || !state.token) {
      state.bookmarks = [];
      return;
    }
    const data = await apiRequest('/api/bookmarks');
    state.bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  }

  // Trims long display names so the auth button text stays compact.
  function truncateName(value, max = 16) {
    const clean = String(value || '').trim();
    if (!clean) return '';
    return clean.length > max ? `${clean.slice(0, max)}...` : clean;
  }

  // Resolves best display name (username first, then email prefix).
  function getDisplayName(user) {
    const explicit = String(user?.username || '').trim();
    if (explicit) return explicit;
    const email = String(user?.email || '').trim();
    return String(email.split('@')[0] || '').trim() || 'Member';
  }

  // Updates login button text/style based on current auth state.
  function updateAuthUi() {
    if (!ui.authBtn) return;
    const sub = ui.authBtn.querySelector('.premium-login-sub');
    const main = ui.authBtn.querySelector('.premium-login-main');
    if (state.user) {
      const displayName = getDisplayName(state.user);
      ui.authBtn.classList.add('is-logged-in');
      if (sub) sub.textContent = 'Signed In';
      if (main) main.textContent = truncateName(displayName, 16);
      ui.authBtn.title = `Signed in as ${displayName}`;
    } else {
      ui.authBtn.classList.remove('is-logged-in');
      if (sub) sub.textContent = 'RuhVerse';
      if (main) main.textContent = 'Login';
      ui.authBtn.title = 'Login or create account';
    }
  }

  // Renders bookmark list, empty states, and logged-in status text.
  function renderBookmarksPanel() {
    if (!ui.bookmarksList || !ui.bookmarksStatus || !ui.bookmarksEmpty) return;
    updateBookmarkToggleUi();

    if (!state.user) {
      ui.bookmarksStatus.textContent = 'Sign in to sync your Quran bookmarks.';
      ui.bookmarksEmpty.style.display = 'block';
      ui.bookmarksEmpty.textContent = 'No bookmarks yet.';
      ui.bookmarksList.innerHTML = '';
      return;
    }

    ui.bookmarksStatus.textContent = `Logged in as ${getDisplayName(state.user)}`;
    if (!state.bookmarks.length) {
      ui.bookmarksEmpty.style.display = 'block';
      ui.bookmarksEmpty.textContent = 'Save verses to see them here.';
      ui.bookmarksList.innerHTML = '';
      return;
    }

    ui.bookmarksEmpty.style.display = 'none';
    ui.bookmarksList.innerHTML = '';

    const sorted = [...state.bookmarks].sort((a, b) => {
      return String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || ''));
    });

    const fragment = document.createDocumentFragment();
    for (const item of sorted) {
      const li = document.createElement('li');
      li.className = 'bookmark-item';

      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'bookmark-jump-btn';
      title.setAttribute('data-action', 'jump');
      title.setAttribute('data-surah', String(item.surahNumber));
      title.setAttribute('data-ayah', String(item.ayahNumber));
      const surahLabel = item.surahName ? `${item.surahName}` : `Surah ${item.surahNumber}`;
      title.textContent = `${surahLabel} - Ayah ${item.ayahNumber}`;

      const translation = document.createElement('p');
      translation.className = 'bookmark-preview';
      translation.textContent = (item.note || item.textTranslation || item.textArabic || '').slice(0, 120) || 'Open bookmark';

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'bookmark-remove-btn';
      remove.setAttribute('data-action', 'remove');
      remove.setAttribute('data-surah', String(item.surahNumber));
      remove.setAttribute('data-ayah', String(item.ayahNumber));
      remove.textContent = 'Remove';

      li.appendChild(title);
      li.appendChild(translation);
      li.appendChild(remove);
      fragment.appendChild(li);
    }
    ui.bookmarksList.appendChild(fragment);
  }

  // Updates bookmark counter badge and toggle button visual state.
  function updateBookmarkToggleUi() {
    if (!ui.bookmarkToggleBtn) return;
    const count = Array.isArray(state.bookmarks) ? state.bookmarks.length : 0;
    if (ui.bookmarksCountBadge) {
      ui.bookmarksCountBadge.textContent = String(count);
      ui.bookmarksCountBadge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
    ui.bookmarkToggleBtn.classList.toggle('has-items', count > 0);
  }

  // Locks/unlocks body scrolling when modal or bookmarks panel is open.
  function syncBodyOverlayState() {
    const authOpen = ui.modal?.style.display === 'flex';
    const bookmarksOpen = ui.bookmarksPanel?.classList.contains('open');
    document.body.classList.toggle('modal-open', Boolean(authOpen || bookmarksOpen));
  }

  // Opens bookmark side panel and backdrop.
  function openBookmarksPanel() {
    if (!ui.bookmarksPanel) return;
    closeMobileSidebarIfNeeded();
    if (ui.bookmarksPanel.parentElement !== document.body) {
      document.body.appendChild(ui.bookmarksPanel);
    }
    ui.bookmarksPanel.classList.add('open');
    ui.bookmarksBackdrop?.classList.add('open');
    ui.bookmarkToggleBtn?.classList.add('is-open');
    ui.bookmarkToggleBtn?.setAttribute('aria-expanded', 'true');
    syncBodyOverlayState();
  }

  // Closes bookmark side panel and backdrop.
  function closeBookmarksPanel() {
    if (!ui.bookmarksPanel) return;
    ui.bookmarksPanel.classList.remove('open');
    ui.bookmarksBackdrop?.classList.remove('open');
    ui.bookmarkToggleBtn?.classList.remove('is-open');
    ui.bookmarkToggleBtn?.setAttribute('aria-expanded', 'false');
    syncBodyOverlayState();
  }

  // Injects bookmark action buttons into rendered ayah blocks.
  function decorateVerseBlocksForBookmarks() {
    const surahMeta = getCurrentSurahMeta();
    if (!surahMeta.number) return;

    const blocks = document.querySelectorAll('#quran-text-container .verse-block[data-ayah-number]');
    blocks.forEach((block) => {
      if (!(block instanceof HTMLElement)) return;
      if (block.querySelector('.bookmark-btn')) return;

      const ayahNumber = Number(block.getAttribute('data-ayah-number'));
      if (!Number.isInteger(ayahNumber)) return;

      const actions = document.createElement('div');
      actions.className = 'verse-actions';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bookmark-btn';
      btn.setAttribute('data-surah', String(surahMeta.number));
      btn.setAttribute('data-ayah', String(ayahNumber));
      btn.setAttribute('data-surah-name', surahMeta.name || `Surah ${surahMeta.number}`);
      applyBookmarkButtonVisual(btn, false);

      btn.addEventListener('click', async () => {
        await onBookmarkButtonClick(btn, block);
      });

      actions.appendChild(btn);
      block.appendChild(actions);
    });

    syncBookmarkButtons();
  }

  // Syncs each verse button with saved/unsaved bookmark state.
  function syncBookmarkButtons() {
    const buttons = document.querySelectorAll('.bookmark-btn');
    buttons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const surahNumber = Number(button.getAttribute('data-surah'));
      const ayahNumber = Number(button.getAttribute('data-ayah'));
      const active = isBookmarked(surahNumber, ayahNumber);
      applyBookmarkButtonVisual(button, active);
    });
  }

  // Applies saved/unsaved icon state and accessibility labels to a bookmark button.
  function applyBookmarkButtonVisual(button, isSaved) {
    button.classList.toggle('is-saved', Boolean(isSaved));
    button.innerHTML = '<span class="bookmark-btn-icon" aria-hidden="true">&#128278;</span>';
    button.setAttribute('aria-label', isSaved ? 'Remove bookmark' : 'Save bookmark');
    button.title = isSaved ? 'Remove bookmark' : 'Save bookmark';
  }

  // Handles add/remove bookmark actions from verse controls.
  async function onBookmarkButtonClick(button, verseBlock) {
    const surahNumber = Number(button.getAttribute('data-surah'));
    const ayahNumber = Number(button.getAttribute('data-ayah'));
    const surahName = String(button.getAttribute('data-surah-name') || '').trim();

    if (!state.user) {
      setAuthMode('login');
      openModal('Login to save bookmarks.');
      return;
    }

    button.disabled = true;
    try {
      if (isBookmarked(surahNumber, ayahNumber)) {
        await apiRequest(`/api/bookmarks/${surahNumber}/${ayahNumber}`, { method: 'DELETE' });
        state.bookmarks = state.bookmarks.filter((x) => !(x.surahNumber === surahNumber && x.ayahNumber === ayahNumber));
        showToast('Bookmark removed.');
      } else {
        const bookmarkPayload = {
          surahNumber,
          ayahNumber,
          surahName,
          note: getTranslationText(verseBlock) || getArabicText(verseBlock)
        };
        const data = await apiRequest('/api/bookmarks', { method: 'POST', body: bookmarkPayload });
        if (data?.bookmark) {
          upsertBookmark(data.bookmark);
        }
        showToast('Bookmark saved.');
      }
      renderBookmarksPanel();
      syncBookmarkButtons();
      openBookmarksPanel();
    } catch (err) {
      showToast(err.message || 'Bookmark action failed.', true);
    } finally {
      button.disabled = false;
    }
  }

  // Reads current surah number/name from event state or page title.
  function getCurrentSurahMeta() {
    if (state.currentSurah.number) return state.currentSurah;
    const titleEl = document.getElementById('current-surah-title');
    const raw = String(titleEl?.textContent || '').trim();
    const match = raw.match(/^(\d+)\.\s*(.+)$/);
    if (!match) return { number: null, name: '' };
    return { number: Number(match[1]), name: String(match[2] || '').trim() };
  }

  // Extracts plain Arabic ayah text from a verse block.
  function getArabicText(block) {
    if (!(block instanceof HTMLElement)) return '';
    const arabic = block.querySelector('.ayah-arabic');
    if (!(arabic instanceof HTMLElement)) return '';
    const clone = arabic.cloneNode(true);
    clone.querySelectorAll('.verse-number').forEach((el) => el.remove());
    return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Extracts plain translation text from a verse block.
  function getTranslationText(block) {
    if (!(block instanceof HTMLElement)) return '';
    const translation = block.querySelector('.ayah-translation');
    return String(translation?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Returns whether a specific surah+ayah pair is saved.
  function isBookmarked(surahNumber, ayahNumber) {
    return state.bookmarks.some((x) => x.surahNumber === surahNumber && x.ayahNumber === ayahNumber);
  }

  // Inserts or updates a bookmark in local in-memory state.
  function upsertBookmark(bookmark) {
    const idx = state.bookmarks.findIndex(
      (x) => x.surahNumber === bookmark.surahNumber && x.ayahNumber === bookmark.ayahNumber
    );
    if (idx >= 0) state.bookmarks[idx] = bookmark;
    else state.bookmarks.push(bookmark);
  }

  // Navigates to a bookmarked ayah and highlights it briefly.
  async function jumpToBookmark(surahNumber, ayahNumber) {
    if (!Number.isInteger(surahNumber) || !Number.isInteger(ayahNumber)) return;
    if (typeof window.loadSurah === 'function') {
      await window.loadSurah(surahNumber - 1, false, true);
    }
    setTimeout(() => {
      const target = document.getElementById(`ayah-${ayahNumber}`);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('bookmark-focus');
      setTimeout(() => target.classList.remove('bookmark-focus'), 1800);
    }, 80);
  }

  // Toggles modal copy/fields between login and register modes.
  function setAuthMode(mode) {
    state.authMode = mode === 'register' ? 'register' : 'login';
    if (!ui.modalTitle || !ui.submitBtn || !ui.switchBtn || !ui.switchHint || !ui.modalHint) return;

    const isRegister = state.authMode === 'register';
    if (ui.usernameInput) {
      ui.usernameInput.hidden = !isRegister;
      ui.usernameInput.style.display = isRegister ? '' : 'none';
      ui.usernameInput.required = isRegister;
      ui.usernameInput.disabled = !isRegister;
      if (!isRegister) ui.usernameInput.value = '';
    }

    if (isRegister) {
      ui.modalTitle.textContent = 'Create Your RuhVerse Account';
      ui.modalHint.textContent = 'Register once to save Quran bookmarks. You must verify your email before login.';
      ui.submitBtn.textContent = 'Create Account';
      ui.switchHint.textContent = 'Already have an account?';
      ui.switchBtn.textContent = 'Login';
    } else {
      ui.modalTitle.textContent = 'Login to Continue Your Journey';
      ui.modalHint.textContent = 'Sign in to sync bookmarks and reading progress.';
      ui.submitBtn.textContent = 'Login';
      ui.switchHint.textContent = 'Do not have an account?';
      ui.switchBtn.textContent = 'Create one';
    }

    if (ui.errorText) ui.errorText.textContent = '';
  }

  // Opens auth modal and optionally overrides the helper hint text.
  function openModal(optionalHint) {
    if (!ui.modal) return;
    closeMobileSidebarIfNeeded();
    if (optionalHint && ui.modalHint) ui.modalHint.textContent = optionalHint;
    ui.modal.style.display = 'flex';
    syncBodyOverlayState();
    setTimeout(() => ui.emailInput?.focus(), 20);
  }

  // Closes auth modal and resets form/error state.
  function closeModal() {
    if (!ui.modal) return;
    ui.modal.style.display = 'none';
    syncBodyOverlayState();
    if (ui.form) ui.form.reset();
    if (ui.errorText) ui.errorText.textContent = '';
    setAuthMode(state.authMode);
  }

  // Syncs auth token to localStorage.
  function persistToken() {
    if (!state.token) {
      localStorage.removeItem(TOKEN_KEY);
      return;
    }
    localStorage.setItem(TOKEN_KEY, state.token);
  }

  // Repositions auth controls for desktop sidebar vs mobile toolbar.
  function placeQuranAuthControlsForViewport() {
    const controls = document.querySelector('.sidebar-controls');
    const authBtn = document.getElementById('auth-toggle-btn');
    const bookmarksBtn = document.getElementById('bookmarks-toggle-btn');
    if (!authBtn || !bookmarksBtn) return;

    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const target = isMobile ? ui.mobileAuthSlot : controls;
    if (!target) return;

    if (authBtn.parentElement !== target) target.appendChild(authBtn);
    if (bookmarksBtn.parentElement !== target) target.appendChild(bookmarksBtn);
  }

  // Closes the mobile surah sidebar before opening overlays.
  function closeMobileSidebarIfNeeded() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    sidebar.classList.remove('active');
  }

  // Wrapper around fetch with auth header, timeout, JSON parsing, and normalized errors.
  async function apiRequest(url, options = {}) {
    const method = options.method || 'GET';
    const withAuth = options.auth !== false;
    const headers = {};

    if (options.body) headers['Content-Type'] = 'application/json';
    if (withAuth && state.token) headers.Authorization = `Bearer ${state.token}`;

    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
    } catch (err) {
      const isAbort = String(err?.name || '').toLowerCase() === 'aborterror';
      throw new Error(isAbort ? 'Request timed out. Please try again.' : `Network error: ${String(err?.message || 'Unable to reach server.')}`);
    } finally {
      window.clearTimeout(timeoutHandle);
    }

    let payload = null;
    const contentType = String(res.headers.get('content-type') || '');
    if (contentType.includes('application/json')) {
      payload = await res.json().catch(() => null);
    }

    if (!res.ok) {
      const msg = payload?.error || `Request failed (${res.status})`;
      throw new Error(msg);
    }

    return payload;
  }

  // Shows a short-lived toast message for success/error feedback.
  function showToast(message, isError = false) {
    if (!ui.toast) return;
    ui.toast.textContent = String(message || '');
    ui.toast.classList.toggle('error', isError);
    ui.toast.classList.add('show');
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(() => {
      ui.toast.classList.remove('show');
    }, 2000);
  }
})();



