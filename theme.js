(() => {
    // Shared theme manager used across all pages.
    const STORAGE_KEY = 'ruhverse-theme';
    const DARK_VALUE = 'dark';
    const LIGHT_VALUE = 'light';

    // Read persisted theme from localStorage (safe in restricted environments).
    // Default to dark mode unless explicitly set to 'light'.
    function readStoredTheme() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved === LIGHT_VALUE) {
                return false;
            }
            return true;
        } catch (_) {
            return true;
        }
    }

    // Persist or clear the dark theme preference.
    function persistTheme(isDark) {
        try {
            localStorage.setItem(STORAGE_KEY, isDark ? DARK_VALUE : LIGHT_VALUE);
        } catch (_) {
            // Ignore storage failures in restricted environments.
        }
    }

    // Current source of truth is the `dark-mode` class on body.
    function getCurrentThemeState() {
        return document.body.classList.contains('dark-mode');
    }

    // Keep every known theme toggle button/icon in sync.
    function updateToggleVisuals(isDark) {
        const toggles = document.querySelectorAll('[data-theme-toggle], #night-mode-toggle');
        toggles.forEach((toggle) => {
            toggle.setAttribute('aria-pressed', String(isDark));

            if (toggle.classList.contains('floating-theme-toggle')) {
                toggle.textContent = isDark ? '☀' : '☾';
            }

            if (toggle.id === 'night-mode-toggle') {
                const isSingleIcon =
                    toggle.childElementCount === 0 &&
                    (toggle.textContent || '').trim().length <= 2;
                if (isSingleIcon) {
                    toggle.textContent = isDark ? '☀' : '☾';
                }
            }
        });
    }

    // Apply visual theme classes without touching storage.
    function applyTheme(isDark) {
        if (!document.body) return;
        document.body.classList.toggle('dark-mode', isDark);
        updateToggleVisuals(isDark);
    }

    // Public setter: apply theme and persist preference.
    function setTheme(isDark) {
        applyTheme(isDark);
        persistTheme(isDark);
    }

    // Bind click behavior once per toggle element.
    function bindToggle(toggle) {
        if (!toggle || toggle.dataset.themeManaged === '1') return;
        toggle.dataset.themeManaged = '1';
        if (!toggle.hasAttribute('data-theme-toggle')) {
            toggle.setAttribute('data-theme-toggle', '');
        }
        if (!toggle.hasAttribute('type') && toggle.tagName.toLowerCase() === 'button') {
            toggle.setAttribute('type', 'button');
        }
        toggle.setAttribute('aria-label', 'Toggle dark mode');

        toggle.addEventListener('click', () => {
            setTheme(!getCurrentThemeState());
        });
    }

    // Ensure there is always at least one toggle on the page.
    function ensureToggleExists() {
        const existingToggles = document.querySelectorAll('[data-theme-toggle], #night-mode-toggle');
        if (existingToggles.length) {
            existingToggles.forEach(bindToggle);
            return;
        }

        const floatingToggle = document.createElement('button');
        floatingToggle.id = 'floating-theme-toggle';
        floatingToggle.className = 'floating-theme-toggle';
        floatingToggle.setAttribute('data-theme-toggle', '');
        document.body.appendChild(floatingToggle);
        bindToggle(floatingToggle);
    }

    // Bootstrap theme from storage and sync controls.
    function initTheme() {
        applyTheme(readStoredTheme());
        ensureToggleExists();
        updateToggleVisuals(getCurrentThemeState());
    }

    if (document.body) {
        applyTheme(readStoredTheme());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTheme);
    } else {
        initTheme();
    }

    window.RuhVerseTheme = {
        bindToggle,
        applyTheme,
        setTheme,
        readStoredTheme
    };
})();
