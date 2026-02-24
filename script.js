document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupLocationIntelligence();
});

function initApp() {
    setupDarkMode(); // Shared logic

    // Only run if specific elements exist
    if (document.body.classList.contains('quran-page-body')) {
        setupQuranApp();
    } else {
        // Home page logic
        try {
            setupNavigation();
            setupTimers();
            loadRamadanCalendar();
            loadDailyInsights();
        } catch (err) {
            console.error("Critical error in homepage init:", err);
        }
    }
}

// --- API Config ---
const API_ARABIC = 'https://api.alquran.cloud/v1/quran/quran-uthmani';
const API_ENGLISH = 'https://api.alquran.cloud/v1/quran/en.sahih';
const API_QURAN_DATA = '/api/quran-data';

// --- State ---
let quranArabic = null;
let quranEnglish = null;
let currentSurahIndex = getInitialSurahIndex(); // 0-based index
let hasFullQuranData = false;

function getInitialSurahIndex() {
    if (typeof window !== 'undefined' && Number.isInteger(window.__INITIAL_SURAH_INDEX)) {
        return Math.min(113, Math.max(0, window.__INITIAL_SURAH_INDEX));
    }

    if (typeof window !== 'undefined') {
        const match = window.location.pathname.match(/\/quran\/surah\/(\d+)/i);
        if (match) {
            const parsed = Number(match[1]) - 1;
            if (Number.isInteger(parsed) && parsed >= 0 && parsed < 114) {
                return parsed;
            }
        }

        const querySurah = Number(new URLSearchParams(window.location.search).get('surah'));
        if (Number.isInteger(querySurah) && querySurah >= 1 && querySurah <= 114) {
            return querySurah - 1;
        }
    }

    return 0;
}

async function setupQuranApp() {
    setupSidebarControls();
    setupQuranViewControls();

    const sidebar = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobile-surah-btn');

    if (mobileBtn && sidebar) {
        mobileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('active');
        });

        // Close when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 && sidebar.classList.contains('active')) {
                if (!sidebar.contains(e.target) && e.target !== mobileBtn) {
                    sidebar.classList.remove('active');
                }
            }
        });
    }

    const surahList = document.getElementById('surah-list');
    const quranContainer = document.getElementById('quran-text-container');
    if (!surahList.querySelector('li')) {
        surahList.innerHTML = '<li style="padding:2rem; text-align:center;">Fetching Quran Data...</li>';
    }

    // Prefer lightweight SSR bootstrap to reduce initial payload while keeping SSR HTML intact
    if (window.__SSR_BOOTSTRAP && Array.isArray(window.__SSR_BOOTSTRAP.surahMeta)) {
        try {
            bootstrapQuranState(window.__SSR_BOOTSTRAP);
            populateSurahList();
            renderPagination();
            await loadSurah(currentSurahIndex, false, true);
            setupAudioPlayer();
            ensureFullQuranData().catch(() => { });
        } catch (err) {
            console.error('Failed to initialize SSR bootstrap Quran data:', err);
            if (quranContainer && !quranContainer.querySelector('.verse-block')) {
                quranContainer.innerHTML = '<div class="loading-spinner">Unable to load verses right now. Please refresh.</div>';
            }
        }
        return;
    }

    // Legacy SSR compatibility (full dataset injected)
    if (window.__SSR_DATA && window.__SSR_DATA.quranArabic && window.__SSR_DATA.quranEnglish) {
        quranArabic = window.__SSR_DATA.quranArabic;
        quranEnglish = window.__SSR_DATA.quranEnglish;
        hasFullQuranData = true;

        populateSurahList();
        renderPagination();
        await loadSurah(currentSurahIndex, false, true);

        setupAudioPlayer();
        return;
    }

    try {
        // Parallel Fetch (CSR fallback)
        const [resAr, resEn] = await Promise.all([
            fetch(API_ARABIC),
            fetch(API_ENGLISH)
        ]);

        const jsonAr = await resAr.json();
        const jsonEn = await resEn.json();

        quranArabic = jsonAr.data.surahs;
        quranEnglish = jsonEn.data.surahs;
        hasFullQuranData = true;

        populateSurahList();
        renderPagination();
        await loadSurah(currentSurahIndex);
        setupAudioPlayer();

    } catch (e) {
        console.error("Failed to load Quran:", e);
        surahList.innerHTML = '<li style="color:red; padding:1rem;">Failed to load data. Check internet.</li>';
        if (quranContainer && !quranContainer.querySelector('.verse-block')) {
            quranContainer.innerHTML = '<div class="loading-spinner">Failed to load Surah text. Check internet and refresh.</div>';
        }
    }
}

function bootstrapQuranState(bootstrap) {
    const meta = bootstrap.surahMeta;
    quranArabic = meta.map((surah) => ({
        ...surah,
        ayahs: []
    }));
    quranEnglish = meta.map((surah) => ({
        ...surah,
        ayahs: []
    }));

    const idx = Number.isInteger(bootstrap.initialSurahIndex)
        ? bootstrap.initialSurahIndex
        : currentSurahIndex;
    currentSurahIndex = Math.min(113, Math.max(0, idx));

    if (bootstrap.initialSurahArabic && bootstrap.initialSurahEnglish) {
        quranArabic[currentSurahIndex] = bootstrap.initialSurahArabic;
        quranEnglish[currentSurahIndex] = bootstrap.initialSurahEnglish;
    }
}

async function ensureFullQuranData() {
    if (hasFullQuranData) return;

    try {
        const res = await fetch(API_QURAN_DATA);
        if (res.ok) {
            const json = await res.json();
            if (json && json.quranArabic && json.quranEnglish) {
                quranArabic = json.quranArabic;
                quranEnglish = json.quranEnglish;
                hasFullQuranData = true;
                return;
            }
        }
    } catch (_) {
        // fall through to direct API calls below
    }

    const [resAr, resEn] = await Promise.all([
        fetch(API_ARABIC),
        fetch(API_ENGLISH)
    ]);
    const [jsonAr, jsonEn] = await Promise.all([resAr.json(), resEn.json()]);
    quranArabic = jsonAr.data.surahs;
    quranEnglish = jsonEn.data.surahs;
    hasFullQuranData = true;
}

// --- Audio Engine ---
let audioObj = new Audio();
let isPlaying = false;
let currentAyahIdx = 0;

function setupAudioPlayer() {
    const btnAudio = document.getElementById('btn-audio');
    const btnPlayPause = document.getElementById('audio-play-pause');
    const btnClose = document.getElementById('audio-close');
    const btnNext = document.getElementById('audio-next');
    const btnPrev = document.getElementById('audio-prev');
    const playerBar = document.getElementById('audio-player-bar');

    if (btnAudio) {
        btnAudio.onclick = () => {
            playerBar.classList.add('active');
            playAyah(0);
        };
    }

    btnPlayPause.addEventListener('click', togglePlay);
    btnClose.addEventListener('click', () => {
        stopAudio();
        playerBar.classList.remove('active');
    });

    btnNext.addEventListener('click', () => {
        if (currentAyahIdx < quranArabic[currentSurahIndex].ayahs.length - 1) {
            playAyah(currentAyahIdx + 1);
        }
    });

    btnPrev.addEventListener('click', () => {
        if (currentAyahIdx > 0) {
            playAyah(currentAyahIdx - 1);
        }
    });

    audioObj.onended = async () => {
        const surah = quranArabic[currentSurahIndex];
        if (currentAyahIdx < surah.ayahs.length - 1) {
            // Play next verse in current Surah
            playAyah(currentAyahIdx + 1);
        } else if (currentSurahIndex < 113) {
            // Increment index and load UI (force reload)
            const nextIdx = currentSurahIndex + 1;
            await loadSurah(nextIdx, true, true);
            playAyah(0);
        } else {
            // End of Quran
            stopAudio();
        }
    };
}

function playAyah(index) {
    currentAyahIdx = index;
    const surah = quranArabic[currentSurahIndex];
    const ayah = surah.ayahs[index];

    // Show player bar if not already visible
    const playerBar = document.getElementById('audio-player-bar');
    if (playerBar && !playerBar.classList.contains('active')) {
        playerBar.classList.add('active');
    }

    // Al Quran Cloud Audio CDN pattern: https://cdn.alquran.cloud/media/audio/ayah/ar.alafasy/{ayahNumber}
    // We need the absolute Ayah number (number) not numberInSurah
    const audioUrl = `https://cdn.alquran.cloud/media/audio/ayah/ar.alafasy/${ayah.number}`;

    audioObj.src = audioUrl;
    audioObj.play();
    isPlaying = true;

    updatePlayerUI();
    highlightVerse(index);
}

function togglePlay() {
    if (isPlaying) {
        audioObj.pause();
        isPlaying = false;
    } else {
        audioObj.play();
        isPlaying = true;
    }
    updatePlayerUI();
}

function stopAudio() {
    audioObj.pause();
    audioObj.currentTime = 0;
    isPlaying = false;
    updatePlayerUI();
    removeHighlights();

    // Hide player bar
    const playerBar = document.getElementById('audio-player-bar');
    if (playerBar) playerBar.classList.remove('active');
}

function updatePlayerUI() {
    const btnPlayPause = document.getElementById('audio-play-pause');
    const status = document.getElementById('player-status');
    const ayahLabel = document.getElementById('player-ayah');
    const surah = quranArabic[currentSurahIndex];

    if (btnPlayPause) {
        btnPlayPause.textContent = isPlaying ? '⏸' : '▶';
    }
    if (status) {
        status.textContent = `Reciting: ${surah.englishName}`;
    }
    if (ayahLabel) {
        ayahLabel.textContent = `Verse ${currentAyahIdx + 1} of ${surah.ayahs.length}`;
    }
}

function highlightVerse(index) {
    removeHighlights();
    const verses = document.querySelectorAll('.verse-block');
    if (verses[index]) {
        verses[index].classList.add('active-verse');
        verses[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function removeHighlights() {
    document.querySelectorAll('.verse-block').forEach(v => v.classList.remove('active-verse'));
}

function setupSidebarControls() {
    // Search
    const search = document.getElementById('surah-search');
    if (search) {
        search.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const items = document.querySelectorAll('.surah-list li');
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(term) ? 'flex' : 'none';
            });
        });
    }
}

function setupDarkMode() {
    const nightBtn = document.getElementById('night-mode-toggle');
    if (nightBtn) {
        nightBtn.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
        });
    }
}

function populateSurahList() {
    const list = document.getElementById('surah-list');
    list.innerHTML = '';

    quranArabic.forEach((surah, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.75rem;">
                <button class="surah-play-btn" title="Listen ${surah.englishName}">▶</button>
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:600;">${index + 1}. ${surah.englishName}</span>
                    <span style="font-size:0.8rem; color:#888;">${surah.englishNameTranslation}</span>
                </div>
            </div>
            <span class="arabic-name">${surah.name}</span>
        `;

        // Main click loads the text
        li.onclick = () => loadSurah(index);

        // Play button click starts audio
        const playBtn = li.querySelector('.surah-play-btn');
        playBtn.onclick = async (e) => {
            e.stopPropagation(); // Don't trigger the li.onclick

            // If already on this surah, just start playing. Otherwise load it first.
            if (currentSurahIndex !== index) {
                await loadSurah(index);
            }
            playAyah(0);
        };

        list.appendChild(li);
    });
}

async function loadSurah(index, keepAudio = false, forceReload = false) {
    // Check if we already have this surah loaded to avoid unnecessary DOM thrashing
    // But allow forced reload during auto-play transitions
    if (!forceReload && currentSurahIndex === index && document.querySelector('.verse-block')) {
        highlightSurahInList(index);
        return;
    }

    currentSurahIndex = index;
    if (!quranArabic[index]?.ayahs?.length || !quranEnglish[index]?.ayahs?.length) {
        const loadingContainer = document.getElementById('quran-text-container');
        if (loadingContainer) {
            loadingContainer.innerHTML = '<div class="loading-spinner">Loading Surah...</div>';
        }
        try {
            await ensureFullQuranData();
        } catch (err) {
            console.error('Unable to load full Quran data:', err);
            if (loadingContainer) {
                loadingContainer.innerHTML = '<div class="loading-spinner">Unable to load Surah text right now.</div>';
            }
            return;
        }
    }
    const surahAr = quranArabic[index];
    const surahEn = quranEnglish[index];
    updateQuranUrl(index);

    // Reset Audio if active and NOT requested to keep (keepAudio is true during auto-play transition)
    if (isPlaying && !keepAudio) {
        stopAudio();
    }

    // Update Title
    document.getElementById('current-surah-title').textContent = `${surahAr.number}. ${surahAr.englishName}`;

    highlightSurahInList(index);

    // Render Verses
    const container = document.getElementById('quran-text-container');
    container.innerHTML = '';

    const BISMILLAH_TEXT = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";

    // Show Bismillah header separately (Traditional Look)
    // Except for Surah 9 (At-Tawbah) and Surah 1 (where Bismillah is Verse 1)
    if (index !== 0 && index !== 8) {
        const bismDiv = document.createElement('div');
        bismDiv.className = 'bismillah-block';
        bismDiv.textContent = BISMILLAH_TEXT;
        container.appendChild(bismDiv);
    }

    surahAr.ayahs.forEach((ayah, vIndex) => {
        let text = ayah.text;

        // Strip Bismillah from the first verse if it's there (since we show it as a header)
        if (vIndex === 0 && index !== 0 && index !== 8) {
            if (text.startsWith(BISMILLAH_TEXT)) {
                text = text.replace(BISMILLAH_TEXT, "").trim();
            }
        }

        const div = document.createElement('div');
        div.className = 'verse-block';

        const arP = document.createElement('p');
        arP.className = 'ayah-arabic';
        arP.innerHTML = `${text} <span class="verse-number">${ayah.numberInSurah}</span>`;

        const enP = document.createElement('p');
        enP.className = 'ayah-translation';
        enP.textContent = surahEn.ayahs[vIndex].text;

        div.appendChild(arP);
        div.appendChild(enP);
        container.appendChild(div);
    });

    // Respect current view mode
    const isTransActive = document.getElementById('btn-trans').classList.contains('active');
    if (isTransActive) container.classList.add('show-translation');
    else container.classList.remove('show-translation');

    updatePaginationUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Close sidebar on mobile
    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth <= 768 && sidebar) sidebar.classList.remove('active');
}

function updateQuranUrl(index) {
    if (!window.history || !window.history.replaceState) return;
    const url = index === 0 ? '/quran.html' : `/quran/surah/${index + 1}`;
    window.history.replaceState({}, '', url);
}

function highlightSurahInList(index) {
    document.querySelectorAll('.surah-list li').forEach((li, idx) => {
        if (idx === index) li.classList.add('active');
        else li.classList.remove('active');
    });
}

function renderPagination() {
    const bottom = document.getElementById('pagination-bottom');
    if (!bottom) return;

    const html = `
        <button class="nav-pill prev-surah" onclick="changeSurah(-1)">← Previous</button>
        <div class="page-num-display">Surah <span class="current-idx">1</span> of 114</div>
        <button class="nav-pill next-surah" onclick="changeSurah(1)">Next →</button>
    `;
    bottom.innerHTML = html;
}

function updatePaginationUI() {
    const displays = document.querySelectorAll('.current-idx');
    displays.forEach(el => el.textContent = currentSurahIndex + 1);

    const prevBtns = document.querySelectorAll('.prev-surah');
    const nextBtns = document.querySelectorAll('.next-surah');

    prevBtns.forEach(btn => btn.disabled = (currentSurahIndex === 0));
    nextBtns.forEach(btn => btn.disabled = (currentSurahIndex === 113));
}

function changeSurah(delta) {
    const newIndex = currentSurahIndex + delta;
    if (newIndex >= 0 && newIndex < 114) {
        loadSurah(newIndex);
    }
}

function setupQuranViewControls() {
    const btnAr = document.getElementById('btn-arabic');
    const btnTr = document.getElementById('btn-trans');
    const container = document.getElementById('quran-text-container');

    btnAr.onclick = () => {
        btnAr.classList.add('active');
        btnTr.classList.remove('active');
        container.classList.remove('show-translation'); // CSS handles hiding
    };

    btnTr.onclick = () => {
        btnTr.classList.add('active');
        btnAr.classList.remove('active');
        container.classList.add('show-translation');
    };
}

// --- Shared (Home) Logic ---
function setupNavigation() {
    const hamburger = document.getElementById('hamburger-btn');
    const overlay = document.getElementById('nav-overlay');
    const closeBtn = document.getElementById('close-nav');
    if (hamburger) hamburger.addEventListener('click', () => overlay.classList.toggle('active'));
    if (closeBtn) closeBtn.addEventListener('click', () => overlay.classList.remove('active'));
}

function setupTimers() {
    // --- Hardcoded Ramadan dates (IST) — accurate for India ---
    // Source: Islamic calendar. Ramadan starts at Fajr on the listed date.
    const RAMADAN_DATES = {
        2026: { start: '2026-02-19', end: '2026-03-21' },
        2027: { start: '2027-02-08', end: '2027-03-09' },
        2028: { start: '2028-01-28', end: '2028-02-26' },
        2029: { start: '2029-01-16', end: '2029-02-14' },
        2030: { start: '2030-01-05', end: '2030-02-03' },
    };

    function getRamadanDates() {
        const now = new Date();
        const year = now.getFullYear();
        // Try current year, then next year (in case Ramadan already ended)
        for (const y of [year, year + 1]) {
            const entry = RAMADAN_DATES[y];
            if (!entry) continue;
            const start = new Date(entry.start + 'T00:00:00+05:30');
            const end = new Date(entry.end + 'T00:00:00+05:30');
            // If Ramadan hasn't ended yet, use this entry
            if (end > now) return { start, end };
        }
        return { start: null, end: null };
    }

    function initRamadanCountdown() {
        const { start, end } = getRamadanDates();
        if (!start || !end) return;

        let ramadanInterval = null;

        function updateRamadanCountdown() {
            const now = new Date();
            const msToStart = start - now;
            const msToEnd = end - now;
            const dayInMs = 24 * 60 * 60 * 1000;

            const ramadanGrid = document.querySelector('.ramadan-grid');
            const subtitle = document.querySelector('.ramadan-subtitle');
            const sectionTitle = document.querySelector('#ramadan .section-title');

            // --- Phase 1: Countdown to START ---
            if (msToStart > 0) {
                if (sectionTitle) sectionTitle.textContent = 'Ramadan Starts In';
                if (subtitle) subtitle.textContent = 'Counting down to the most blessed month of the year.';
                renderCountdown(msToStart);
                return;
            }

            // --- Phase 2: Ramadan DAY 1 (Greeting) ---
            if (msToStart <= 0 && msToStart > -dayInMs) {
                if (sectionTitle) sectionTitle.textContent = 'Ramadan Mubarak';
                showFestiveMessage(ramadanGrid, subtitle, '🌙', 'Ramadan Mubarak!', 'The blessed month is here. May your fasts be accepted.', 'رَمَضَانُ مُبَارَكٌ');
                return;
            }

            // --- Phase 3: Ramadan ONGOING (Countdown to END) ---
            if (msToEnd > 0) {
                if (sectionTitle) sectionTitle.textContent = 'Ramadan Ends In';
                if (subtitle) subtitle.textContent = 'The month of mercy is passing. Make the most of every moment.';
                // If we were showing the festive message, we might need to restore the grid
                // This logic assumes renderCountdown handles restoring content if needed
                renderCountdown(msToEnd);
                return;
            }

            // --- Phase 4: Eid Day 1 (Greeting) ---
            if (msToEnd <= 0 && msToEnd > -dayInMs) {
                if (sectionTitle) sectionTitle.textContent = 'Eid Mubarak';
                showFestiveMessage(ramadanGrid, subtitle, '⭐', 'Eid Mubarak!', 'May Allah accept your fasts and prayers.', 'عيد مبارك');
                return;
            }

            // --- Phase 5: POST EID (Reset to next year) ---
            if (msToEnd <= -dayInMs) {
                clearInterval(ramadanInterval);
                setTimeout(() => initRamadanCountdown(), 1000);
                return;
            }

            function renderCountdown(ms) {
                const f = fmtDHMS(ms);
                const rD = document.getElementById('ram-days');
                const rH = document.getElementById('ram-hrs');
                const rM = document.getElementById('ram-min');
                const rS = document.getElementById('ram-sec');

                if (!rD && ramadanGrid) {
                    // Restore grid if it was replaced by a greeting
                    ramadanGrid.innerHTML = `
                        <div class="timer-card"><h3 id="ram-days">00</h3><p>Days</p></div>
                        <div class="timer-card"><h3 id="ram-hrs">00</h3><p>Hours</p></div>
                        <div class="timer-card"><h3 id="ram-min">00</h3><p>Minutes</p></div>
                        <div class="timer-card"><h3 id="ram-sec">00</h3><p>Seconds</p></div>
                    `;
                }

                if (rD) rD.textContent = String(f.d).padStart(2, '0');
                if (rH) rH.textContent = String(f.h).padStart(2, '0');
                if (rM) rM.textContent = String(f.m).padStart(2, '0');
                if (rS) rS.textContent = String(f.s).padStart(2, '0');
            }

            function showFestiveMessage(grid, sub, emoji, titleText, subText, arabicText) {
                if (grid && !grid.querySelector('.festive-wrap')) {
                    grid.innerHTML = `
                        <div class="festive-wrap" style="text-align:center; padding: 2rem 0; width: 100%;">
                            <div style="font-size: 3.5rem; margin-bottom: 1rem;">${emoji}</div>
                            <h3 style="font-family: var(--font-display); font-size: 2.5rem; color: var(--emerald); margin-bottom: 0.75rem;">
                                ${titleText}
                            </h3>
                            <p style="font-size: 1.2rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                                ${subText}
                            </p>
                            <p style="font-size: 1rem; color: var(--gold); font-style: italic;">
                                ${arabicText}
                            </p>
                        </div>
                    `;
                }
                if (sub) sub.textContent = subText;
            }

            function fmtDHMS(ms) {
                if (ms <= 0) return { d: 0, h: 0, m: 0, s: 0 };
                const s = Math.floor(ms / 1000);
                const m = Math.floor(s / 60);
                const h = Math.floor(m / 60);
                const d = Math.floor(h / 24);
                return { d, h: h % 24, m: m % 60, s: s % 60 };
            }
        }

        updateRamadanCountdown();
        ramadanInterval = setInterval(updateRamadanCountdown, 1000);
    }

    initRamadanCountdown();

    // --- Live Prayer Times via Aladhan API (IST / India) ---
    const PRAYER_NAMES = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

    function format12h(timeStr) {
        if (!timeStr) return '';
        const [h, m] = timeStr.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
    }

    function timeStrToDate(timeStr, baseDate) {
        // timeStr is "HH:MM" in IST
        const [h, m] = timeStr.split(':').map(Number);
        const d = new Date(baseDate);
        d.setHours(h, m, 0, 0);
        return d;
    }

    function updatePrayerCountdown(times) {
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

        let nextPrayer = null;
        let nextTime = null;

        for (let i = 0; i < PRAYER_NAMES.length; i++) {
            const t = timeStrToDate(times[PRAYER_NAMES[i]], nowIST);
            if (t > nowIST) {
                nextPrayer = PRAYER_NAMES[i];
                nextTime = t;
                break;
            }
        }

        // If all prayers passed, next is Fajr tomorrow
        if (!nextPrayer) {
            nextPrayer = 'Fajr';
            const fajrTomorrow = timeStrToDate(times['Fajr'], nowIST);
            fajrTomorrow.setDate(fajrTomorrow.getDate() + 1);
            nextTime = fajrTomorrow;
        }

        const nameEl = document.getElementById('next-prayer-name');
        if (nameEl) nameEl.textContent = nextPrayer;

        const countdownEl = document.getElementById('prayer-countdown');
        if (countdownEl) {
            const diff = Math.max(0, nextTime - nowIST);
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            countdownEl.textContent =
                String(h).padStart(2, '0') + ':' +
                String(m).padStart(2, '0') + ':' +
                String(s).padStart(2, '0');
        }
    }

    function renderPrayerCards(times) {
        const cards = document.querySelectorAll('.prayer-card');
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

        cards.forEach((card, i) => {
            const name = PRAYER_NAMES[i];
            if (!name || !times[name]) return;

            const h4 = card.querySelector('h4');
            const span = card.querySelector('span');
            if (h4) h4.textContent = name;
            if (span) span.textContent = format12h(times[name]);

            // Highlight active prayer
            const t = timeStrToDate(times[name], nowIST);
            card.classList.remove('active');
            // Mark the most recent past prayer as active
            if (i < PRAYER_NAMES.length - 1) {
                const next = timeStrToDate(times[PRAYER_NAMES[i + 1]], nowIST);
                if (t <= nowIST && nowIST < next) card.classList.add('active');
            } else {
                if (t <= nowIST) card.classList.add('active');
            }
        });
    }

    async function fetchPrayerTimes(lat, lon) {
        const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' })
            .split('/').reverse().join('-'); // YYYY-MM-DD
        const url = `https://api.aladhan.com/v1/timings/${today}?latitude=${lat}&longitude=${lon}&method=1`;
        // method=1 = University of Islamic Sciences, Karachi (standard for India/Pakistan)

        try {
            const res = await fetch(url);
            const json = await res.json();
            if (json.code === 200) {
                const timings = json.data.timings;
                renderPrayerCards(timings);
                updatePrayerCountdown(timings);
                setInterval(() => updatePrayerCountdown(timings), 1000);
            }
        } catch (e) {
            console.error('Failed to fetch prayer times:', e);
        }
    }

    // Try geolocation, fallback to New Delhi
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => fetchPrayerTimes(pos.coords.latitude, pos.coords.longitude),
            () => fetchPrayerTimes(28.6139, 77.2090) // New Delhi fallback
        );
    } else {
        fetchPrayerTimes(28.6139, 77.2090);
    }
}

// --- Ramadan 2026 Calendar ---
function loadRamadanCalendar() {
    const tbody = document.getElementById('ramadan-cal-body');
    if (!tbody) {
        console.warn('Ramadan calendar tbody not found.');
        return;
    }

    try {
        // Use global variable from ramadan_2026.js (fixes file:// protocol fetch issues)
        if (typeof RAMADAN_2026_DATA === 'undefined') {
            throw new Error('RAMADAN_2026_DATA is not defined. Check if data/ramadan_2026.js is loaded.');
        }

        const data = RAMADAN_2026_DATA;

        // Get today's date string in IST (DD Mon YYYY format to match)
        const now = new Date();
        const istDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        const day = String(istDate.getDate()).padStart(2, '0');
        const month = months[istDate.getMonth()];
        const year = istDate.getFullYear();
        const todayIST = `${day} ${month} ${year}`;

        let todayRow = null;
        tbody.innerHTML = ''; // Clear previous/loading state

        data.days.forEach(d => {
            const tr = document.createElement('tr');

            // Robust comparison: remove dots and match
            const cleanDDate = d.date.replace(/\./g, '');
            const isToday = cleanDDate === todayIST;
            const isQadr = !!d.special;

            if (isToday) tr.classList.add('today-row');
            if (isQadr) tr.classList.add('qadr-row');

            const todayBadge = isToday
                ? `<span class="today-badge">Today</span>` : '';
            const qadrBadge = isQadr
                ? `<span class="qadr-badge">⭐ Qadr</span>` : '';

            tr.innerHTML = `
                <td><strong>${d.day}</strong></td>
                <td>${d.date} <small style="color:var(--text-muted)">${d.weekday}</small>${todayBadge}</td>
                <td style="color:var(--text-muted); font-size:0.85rem;">${d.hijri}</td>
                <td><strong>${d.sehri}</strong></td>
                <td style="color:var(--text-muted)">${d.fajr}</td>
                <td><strong style="color:var(--emerald)">${d.iftar}</strong></td>
                <td>${qadrBadge}</td>
            `;

            tbody.appendChild(tr);
            if (isToday) todayRow = tr;
        });

        // Scroll today's row into view smoothly
        if (todayRow) {
            setTimeout(() => {
                todayRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 800);
        }

    } catch (e) {
        console.error('Failed to load Ramadan calendar:', e);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:3rem;color:var(--text-muted)">
                <div style="font-size:1.5rem; margin-bottom:1rem;">⚠️</div>
                Calendar data unavailable.<br>
                <small>${e.message}</small>
            </td></tr>`;
        }
    }
}

// --- Daily Dynamic Insights ---
function loadDailyInsights() {
    const track = document.getElementById('insights-track');
    const nav = document.getElementById('slider-nav');
    const btnPrev = document.getElementById('ins-prev');
    const btnNext = document.getElementById('ins-next');

    if (!track || typeof QURAN_INSIGHTS === 'undefined') return;

    // Deterministic seed based on date (YYYYMMDD)
    const now = new Date();
    const dateSeed = now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();

    const dailySubset = [];
    const pool = [...QURAN_INSIGHTS];
    const subsetCount = Math.min(5, pool.length);

    for (let i = 0; i < subsetCount; i++) {
        const index = (dateSeed + i * 7) % pool.length;
        dailySubset.push(pool.splice(index, 1)[0]);
    }

    let activeIndex = 0;
    track.innerHTML = '';
    nav.innerHTML = '';

    // Render cards and dots
    dailySubset.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = `fact-card ${idx === 0 ? 'active' : ''}`;
        card.innerHTML = `
            <h4>${item.title}</h4>
            <p>${item.text}</p>
        `;
        track.appendChild(card);

        const dot = document.createElement('div');
        dot.className = `nav-dot ${idx === 0 ? 'active' : ''}`;
        dot.onclick = () => {
            activeIndex = idx;
            updateCarousel();
        };
        nav.appendChild(dot);
    });

    const cards = track.querySelectorAll('.fact-card');
    const dots = nav.querySelectorAll('.nav-dot');

    function updateCarousel() {
        const containerWidth = track.parentElement.clientWidth;
        const cardWidth = cards[0].clientWidth;
        const gap = 32; // 2rem matches CSS gap

        // Calculate the offset to center the active card
        // Offset = (ContainerCenter) - (CardCenter + PreviousCardsWidth)
        const offset = (containerWidth / 2) - (cardWidth / 2) - (activeIndex * (cardWidth + gap));

        track.style.transform = `translateX(${offset}px)`;

        cards.forEach((card, i) => {
            card.classList.toggle('active', i === activeIndex);
        });

        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i === activeIndex);
        });
    }

    if (btnPrev) btnPrev.onclick = () => {
        activeIndex = (activeIndex - 1 + subsetCount) % subsetCount;
        updateCarousel();
    };

    if (btnNext) btnNext.onclick = () => {
        activeIndex = (activeIndex + 1) % subsetCount;
        updateCarousel();
    };

    // --- Touch Swipe Support ---
    let touchStartX = 0;
    let touchEndX = 0;

    track.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    track.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, { passive: true });

    function handleSwipe() {
        const swipeThreshold = 50; // Minimum pixels for a swipe
        const diff = touchStartX - touchEndX;

        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                // Swiped Left -> Next
                activeIndex = (activeIndex + 1) % subsetCount;
            } else {
                // Swiped Right -> Prev
                activeIndex = (activeIndex - 1 + subsetCount) % subsetCount;
            }
            updateCarousel();
        }
    }

    // Initialize position and handle resize
    window.addEventListener('resize', updateCarousel);
    setTimeout(updateCarousel, 100); // Small delay to ensure layout is ready
}

/**
 * 7. Location Intelligence & Global City Search
 */
function setupLocationIntelligence() {
    const searchBtn = document.getElementById('city-search-btn');
    const detectBtn = document.getElementById('detect-location-btn');
    const cityInput = document.getElementById('city-search-input');

    if (searchBtn) searchBtn.addEventListener('click', () => handleCitySearch());
    if (detectBtn) detectBtn.addEventListener('click', () => syncUserLocation());
    if (cityInput) {
        cityInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleCitySearch();
        });
    }
}

async function handleCitySearch() {
    const input = document.getElementById('city-search-input');
    const city = input.value.trim();
    if (!city) return alert('Please enter a city name.');

    const btn = document.getElementById('city-search-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Searching...</span>';
    btn.disabled = true;

    try {
        const url = `https://api.aladhan.com/v1/timingsByCity?city=${city}&country=&method=1`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.code === 200) {
            renderLocationCard(city, data.data.timings);
        } else {
            alert('City not found. Please try a major city name.');
        }
    } catch (error) {
        console.error('Search error:', error);
        alert('Could not connect to the intelligence hub.');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function syncUserLocation() {
    if (!navigator.geolocation) return alert('Geolocation is not supported by your browser.');

    const btn = document.getElementById('detect-location-btn');
    btn.innerHTML = '<span>📍 Detecting...</span>';

    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
            // Reverse Geocode for City Name
            const geoUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;
            const geoRes = await fetch(geoUrl);
            const geoData = await geoRes.json();
            const cityName = geoData.city || geoData.locality || 'Current Location';

            const prayerUrl = `https://api.aladhan.com/v1/timings/${Math.floor(Date.now() / 1000)}?latitude=${latitude}&longitude=${longitude}&method=1`;
            const prayerRes = await fetch(prayerUrl);
            const prayerData = await prayerRes.json();

            renderLocationCard(cityName, prayerData.data.timings);
        } catch (e) {
            alert('Detected location, but failed to fetch timings.');
        } finally {
            btn.innerHTML = '<span>📍 Detect My City</span>';
        }
    }, () => {
        alert('Location access denied.');
        btn.innerHTML = '<span>📍 Detect My City</span>';
    });
}

function renderLocationCard(name, t) {
    const container = document.getElementById('dynamic-search-results');
    container.style.display = 'block';

    container.innerHTML = `
        <div class="featured-location-card">
            <div class="loc-header">
                <div>
                    <span style="text-transform: uppercase; font-size: 0.8rem; letter-spacing: 2px; opacity: 0.8;">Active Location</span>
                    <h2>${name}</h2>
                </div>
                <div style="font-size: 2rem;">🕊️</div>
            </div>
            <div class="timings-strip">
                <div class="timing-item">
                    <label>Fajr</label>
                    <span>${t.Fajr}</span>
                </div>
                <div class="timing-item">
                    <label>Dhuhr</label>
                    <span>${t.Dhuhr}</span>
                </div>
                <div class="timing-item" style="border-color: var(--gold);">
                    <label>Asr</label>
                    <span>${t.Asr}</span>
                </div>
                <div class="timing-item">
                    <label>Maghrib</label>
                    <span>${t.Maghrib}</span>
                </div>
                <div class="timing-item">
                    <label>Isha</label>
                    <span>${t.Isha}</span>
                </div>
            </div>
            <div style="margin-top: 1.5rem; font-size: 0.8rem; opacity: 0.7; text-align: center;">
                Times based on Islamic University, Karachi Method
            </div>
        </div>
    `;

    // Smooth scroll to the result
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
