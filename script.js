/*
 * RuhVerse client runtime.
 * Debug entry: `initApp()` chooses Quran mode vs homepage mode.
 * Quran mode: load/hydrate surah state, render verses, sync URL/SEO, audio.
 * Homepage mode: nav/auth modal, countdowns, calendar, insights, city search.
 */
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupLocationIntelligence();
});

function isHomepageContext() {
    return Boolean(document.querySelector('#global-directory')) && Boolean(document.querySelector('.hero-section'));
}

function initApp() {
    setupDarkMode(); // Shared logic

    // Only run if specific elements exist
    if (document.body.classList.contains('quran-page-body')) {
        setupQuranApp();
    } else {
        // Home page logic (guarded to avoid heavy work on other static pages)
        if (!isHomepageContext()) {
            try {
                setupNavigation();
            } catch (err) {
                console.error("Critical error in shared init:", err);
            }
            return;
        }

        try {
            setupOpeningAnimation();
            setupNavigation();
            setupHomeAuth();
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
const API_SURAH_INFO = '/api/surah-info';

// --- State ---
let quranArabic = null;
let quranEnglish = null;
let currentSurahIndex = getInitialSurahIndex(); // 0-based index
let hasFullQuranData = false;
let surahIntroByNumber = {};
let chapterMetaByNumber = {};

// Picks initial surah index from SSR bootstrap, canonical path, or ?surah query.
function getInitialSurahIndex() {
    if (typeof window !== 'undefined' && Number.isInteger(window.__INITIAL_SURAH_INDEX)) {
        return Math.min(113, Math.max(0, window.__INITIAL_SURAH_INDEX));
    }

    if (typeof window !== 'undefined') {
        const slugMatch = window.location.pathname.match(/\/quran\/[^/]+\/(\d+)/i);
        if (slugMatch) {
            const parsed = Number(slugMatch[1]) - 1;
            if (Number.isInteger(parsed) && parsed >= 0 && parsed < 114) {
                return parsed;
            }
        }

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

function slugifySurahName(name) {
    const slug = String(name || '')
        .toLowerCase()
        .replace(/['’`]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'surah';
}

function buildSurahPath(surah) {
    if (!surah || !surah.number) return '/quran';
    return `/quran/${slugifySurahName(surah.englishName || surah.englishNameTranslation || '')}/${surah.number}`;
}

function truncateForMeta(text, maxLength = 160) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;
    return `${clean.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeRevelationPlace(placeRaw) {
    const place = String(placeRaw || '').toLowerCase();
    if (place.includes('makk') || place.includes('mecc')) return 'Makkah';
    if (place.includes('med') || place.includes('madin')) return 'Madinah';
    return '';
}

function buildRevelationContext(revelationPlaceRaw, revelationOrder, versesCount) {
    const place = normalizeRevelationPlace(revelationPlaceRaw);
    const order = Number.isInteger(Number(revelationOrder)) && Number(revelationOrder) > 0
        ? Number(revelationOrder)
        : null;
    const verses = Number.isInteger(Number(versesCount)) && Number(versesCount) > 0
        ? Number(versesCount)
        : null;

    const parts = [];
    if (place) {
        parts.push(`Revealed in ${place}.`);
    } else {
        parts.push('Classical sources differ on the exact place of revelation.');
    }
    if (order) {
        parts.push(`Traditionally listed as revelation number ${order}.`);
    }
    if (verses) {
        parts.push(`Contains ${verses} verses.`);
    }

    return `Revelation Context: ${parts.join(' ')}`;
}

function updateClientSeo(surahAr, surahIntro) {
    if (!surahAr) return;

    const ayahCount = Number(surahAr.numberOfAyahs) || surahAr?.ayahs?.length || 0;
    const revelation = surahAr.revelationType || 'Quranic';
    const translatedName = surahAr.englishNameTranslation || surahAr.englishName;
    const title = `Surah ${surahAr.englishName} (${surahAr.number}) - Arabic Text, English Translation, Tafsir Summary | RuhVerse`;
    const description = truncateForMeta(
        `Read Surah ${surahAr.englishName} (${translatedName}) online with Arabic text, English translation, and summary. ${revelation} Surah with ${ayahCount} verses. ${surahIntro?.summary || ''}`,
        160
    );
    const keywords = truncateForMeta(
        [
            `Surah ${surahAr.englishName}`,
            `Surah ${surahAr.number}`,
            `${translatedName}`,
            `Quran ${surahAr.number}`,
            'read Quran online',
            'Quran Arabic English translation',
            'Quran tafsir summary',
            'RuhVerse Quran'
        ].join(', '),
        250
    );
    const canonicalPath = buildSurahPath(surahAr);
    const canonicalUrl = `${window.location.origin}${canonicalPath}`;
    const ogImage = `${window.location.origin}/assets/RuhVerse.jpg`;

    document.title = title;

    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', description);
    const metaKeywords = document.querySelector('meta[name="keywords"]');
    if (metaKeywords) metaKeywords.setAttribute('content', keywords);

    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', canonicalUrl);

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', title);
    const ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription) ogDescription.setAttribute('content', description);
    const ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute('content', canonicalUrl);
    const ogImageMeta = document.querySelector('meta[property="og:image"]');
    if (ogImageMeta) ogImageMeta.setAttribute('content', ogImage);

    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    if (twitterTitle) twitterTitle.setAttribute('content', title);
    const twitterDescription = document.querySelector('meta[name="twitter:description"]');
    if (twitterDescription) twitterDescription.setAttribute('content', description);
    const twitterImage = document.querySelector('meta[name="twitter:image"]');
    if (twitterImage) twitterImage.setAttribute('content', ogImage);
}

// Initializes the Quran reader with SSR bootstrap first, then CSR fallback APIs.
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
            updatePaginationUI();
            await loadSurah(currentSurahIndex, false, false);
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

    chapterMetaByNumber = {};
    meta.forEach((surah) => {
        if (!surah?.number) return;
        chapterMetaByNumber[surah.number] = {
            revelationPlace: surah.revelationPlace || '',
            revelationOrder: surah.revelationOrder || null,
            versesCount: surah.versesCount || surah.numberOfAyahs || null
        };
    });

    const initialNumber = quranArabic[currentSurahIndex]?.number;
    if (initialNumber && bootstrap.initialSurahIntro) {
        surahIntroByNumber[initialNumber] = bootstrap.initialSurahIntro;
    }
}

// Ensures full ayah payload exists for pagination/audio after lightweight SSR boot.
async function ensureFullQuranData() {
    if (hasFullQuranData) return;

    try {
        const res = await fetch(API_QURAN_DATA);
        if (res.ok) {
            const json = await res.json();
            if (json && json.quranArabic && json.quranEnglish) {
                quranArabic = json.quranArabic;
                quranEnglish = json.quranEnglish;
                chapterMetaByNumber = json.chapterMetaMap || {};
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
    chapterMetaByNumber = {};
    hasFullQuranData = true;
}

// --- Audio Engine ---
let audioObj = new Audio();
let isPlaying = false;
let currentAyahIdx = 0;

// Wires audio controls and handles auto-next behavior across ayahs/surahs.
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
    const ayahBlocks = document.querySelectorAll('#quran-text-container .verse-block[data-ayah-index]');
    const target = Array.from(ayahBlocks).find((block) => Number(block.dataset.ayahIndex) === Number(index));
    if (target) {
        target.classList.add('active-verse');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function removeHighlights() {
    document.querySelectorAll('#quran-text-container .active-verse').forEach((v) => v.classList.remove('active-verse'));
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
    if (!nightBtn) return;

    // Preferred: centralized cross-page theme manager (theme.js).
    if (window.RuhVerseTheme && typeof window.RuhVerseTheme.bindToggle === 'function') {
        window.RuhVerseTheme.bindToggle(nightBtn);
        return;
    }

    // Fallback when theme.js is unavailable.
    if (nightBtn.dataset.themeManaged === '1') return;
    nightBtn.dataset.themeManaged = '1';

    const storedTheme = (() => {
        try {
            return sessionStorage.getItem('ruhverse-theme');
        } catch (_) {
            return null;
        }
    })();

    if (storedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }

    nightBtn.addEventListener('click', () => {
        const willBeDark = !document.body.classList.contains('dark-mode');
        document.body.classList.toggle('dark-mode', willBeDark);
        try {
            if (willBeDark) sessionStorage.setItem('ruhverse-theme', 'dark');
            else sessionStorage.removeItem('ruhverse-theme');
        } catch (_) {
            // Ignore storage failures.
        }
    });
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

function stripHtmlTags(value) {
    return String(value || '').replace(/<[^>]*>/g, ' ');
}

function decodeBasicHtmlEntities(value) {
    return String(value || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getClientSummaryFallback(surahEn) {
    const opening = (surahEn?.ayahs || [])
        .slice(0, 2)
        .map((ayah) => normalizeWhitespace(ayah?.text || ''))
        .filter(Boolean)
        .join(' ');

    if (!opening) {
        return 'This surah emphasizes worship of Allah, moral responsibility, and guidance for righteous living.';
    }

    const trimmed = opening.length > 260 ? `${opening.slice(0, 257).trimEnd()}...` : opening;
    return `Opening message: ${trimmed}`;
}

function splitIntoSentences(text) {
    const clean = normalizeWhitespace(text);
    if (!clean) return [];
    return clean
        .split(/(?<=[.!?])\s+/)
        .map((s) => normalizeWhitespace(s))
        .filter((s) => s.length >= 24);
}

function buildClientSignificanceAndBenefits(summaryText) {
    const cleanSummary = String(summaryText || '').replace(/^Opening message:\s*/i, '');
    const sentences = splitIntoSentences(cleanSummary);
    const significance = sentences[0] || truncateForMeta(cleanSummary, 220);
    const benefits = sentences.slice(1, 3);
    return {
        significance: significance || 'This surah carries enduring guidance for belief, character, and daily life.',
        benefits: benefits.length ? benefits : [truncateForMeta(cleanSummary, 220)].filter(Boolean)
    };
}

function buildClientMainTheme(summaryText, surahName) {
    const cleanSummary = String(summaryText || '').replace(/^Opening message:\s*/i, '').trim();
    const firstSentence = splitIntoSentences(cleanSummary)[0] || cleanSummary;
    const normalized = firstSentence
        .replace(/^the\s+(principal\s+)?(subject|theme|central theme|main theme|discourse)\s+(of\s+this\s+surah|of\s+the\s+surah)?\s*(is|was|:)?\s*/i, '')
        .replace(/^its\s+theme\s+is\s+to\s+/i, '')
        .replace(/^this\s+surah\s+(focuses\s+on|is\s+about|deals\s+with)\s+/i, '')
        .replace(/[.]+$/, '')
        .trim();
    const core = normalized || 'sincere faith, moral responsibility, and accountability before Allah';
    return truncateForMeta(`Surah ${surahName} focuses on ${core}.`, 230);
}

function getSurahIntroForClient(surahAr, surahEn) {
    const cachedIntro = surahIntroByNumber[surahAr.number];
    if (cachedIntro && cachedIntro.summary) {
        if (!cachedIntro.mainTheme) {
            cachedIntro.mainTheme = buildClientMainTheme(cachedIntro.summary || '', surahAr.englishName);
        }
        if (!cachedIntro.revelationContext) {
            const chapterMeta = chapterMetaByNumber[surahAr.number] || {};
            cachedIntro.revelationContext = buildRevelationContext(
                chapterMeta.revelationPlace || surahAr.revelationType || '',
                chapterMeta.revelationOrder || null,
                chapterMeta.versesCount || surahAr.numberOfAyahs || surahAr.ayahs.length
            );
        }
        if (!cachedIntro.significance || !Array.isArray(cachedIntro.benefits)) {
            const derived = buildClientSignificanceAndBenefits(cachedIntro.summary || '');
            cachedIntro.significance = derived.significance;
            cachedIntro.benefits = derived.benefits;
        }
        return cachedIntro;
    }

    const chapterMeta = chapterMetaByNumber[surahAr.number] || {};
    const summary = getClientSummaryFallback(surahEn);
    const derived = buildClientSignificanceAndBenefits(summary);
    const generatedIntro = {
        heading: `About Surah ${surahAr.englishName}`,
        meta: `${surahAr.number}. ${surahAr.englishNameTranslation || surahAr.englishName} | ${surahAr.revelationType || 'Quranic'} | ${surahAr.numberOfAyahs || surahAr.ayahs.length} verses`,
        summary,
        mainTheme: buildClientMainTheme(summary, surahAr.englishName),
        significance: derived.significance,
        benefits: derived.benefits
    };
    generatedIntro.revelationContext = buildRevelationContext(
        chapterMeta.revelationPlace || surahAr.revelationType || '',
        chapterMeta.revelationOrder || null,
        chapterMeta.versesCount || surahAr.numberOfAyahs || surahAr.ayahs.length
    );

    surahIntroByNumber[surahAr.number] = generatedIntro;
    return generatedIntro;
}

async function ensureSurahIntroForClient(surahAr, surahEn) {
    const number = surahAr.number;
    const cached = surahIntroByNumber[number];
    if (cached && cached.summary && cached.mainTheme && cached.revelationContext && cached.significance && Array.isArray(cached.benefits)) {
        return cached;
    }

    try {
        const res = await fetch(`${API_SURAH_INFO}/${number}`);
        if (res.ok) {
            const json = await res.json();
            if (json && json.intro && json.intro.summary) {
                surahIntroByNumber[number] = json.intro;
                return json.intro;
            }
        }
    } catch (_) {
        // fallback below
    }

    return getSurahIntroForClient(surahAr, surahEn);
}

async function loadSurah(index, keepAudio = false, forceReload = false) {
    // Check if we already have this surah loaded to avoid unnecessary DOM thrashing
    // But allow forced reload during auto-play transitions
    if (!forceReload && currentSurahIndex === index && document.querySelector('.verse-block .ayah-arabic')) {
        highlightSurahInList(index);
        document.dispatchEvent(new CustomEvent('ruhverse:surah-rendered', {
            detail: {
                surahNumber: quranArabic[index]?.number || (index + 1),
                surahName: quranArabic[index]?.englishName || ''
            }
        }));
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

    const surahIntro = await ensureSurahIntroForClient(surahAr, surahEn);
    updateClientSeo(surahAr, surahIntro);
    const BISMILLAH_TEXT = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";
    if (index !== 0 && index !== 8) {
        const bismDiv = document.createElement('div');
        bismDiv.className = 'bismillah-block';
        bismDiv.textContent = BISMILLAH_TEXT;
        container.appendChild(bismDiv);
    }

    if (surahIntro) {
        const introSection = document.createElement('section');
        introSection.className = 'verse-block surah-intro-block';
        introSection.setAttribute('aria-label', 'Surah introduction');
        introSection.innerHTML = `
            <h2 class="surah-intro-title">${escapeHtml(surahIntro.heading)}</h2>
            <p class="surah-intro-meta">${escapeHtml(surahIntro.meta)}</p>
            <p class="surah-intro-summary">${escapeHtml(stripHtmlTags(decodeBasicHtmlEntities(surahIntro.summary)))}</p>
            <p class="surah-intro-theme"><strong>Main Theme:</strong> ${escapeHtml(stripHtmlTags(decodeBasicHtmlEntities(surahIntro.mainTheme || '')))}</p>
            <p class="surah-intro-revelation">${escapeHtml(stripHtmlTags(decodeBasicHtmlEntities(surahIntro.revelationContext || '')))}</p>
            <div class="surah-significance-block">
                <h3 class="surah-significance-title">Benefits &amp; Significance</h3>
                <p class="surah-significance-text">${escapeHtml(stripHtmlTags(decodeBasicHtmlEntities(surahIntro.significance || '')))}</p>
                ${Array.isArray(surahIntro.benefits) && surahIntro.benefits.length
                ? `<ul class="surah-benefits-list">${surahIntro.benefits.map((item) => `<li>${escapeHtml(stripHtmlTags(decodeBasicHtmlEntities(item)))}</li>`).join('')}</ul>`
                : '<p class="surah-benefits-empty">Key lessons are preserved in this surah&#39;s themes and guidance.</p>'}
            </div>
        `;
        container.appendChild(introSection);
    }

    surahAr.ayahs.forEach((ayah, vIndex) => {
        let text = ayah.text;

        // Strip Bismillah from the first verse if it's there (since we show it as a header)
        if (vIndex === 0 && index !== 0 && index !== 8) {
            text = text.replace(/^\uFEFF/, '');
            if (text.startsWith(BISMILLAH_TEXT)) {
                text = text.slice(BISMILLAH_TEXT.length).trim();
            }
        }

        const div = document.createElement('div');
        div.className = 'verse-block';
        div.id = `ayah-${ayah.numberInSurah}`;
        div.setAttribute('data-ayah-index', String(vIndex));
        div.setAttribute('data-ayah-number', String(ayah.numberInSurah));

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
    document.dispatchEvent(new CustomEvent('ruhverse:surah-rendered', {
        detail: {
            surahNumber: surahAr.number,
            surahName: surahAr.englishName
        }
    }));
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Close sidebar on mobile
    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth <= 768 && sidebar) sidebar.classList.remove('active');
}

window.loadSurah = loadSurah;

function updateQuranUrl(index) {
    if (!window.history || !window.history.replaceState) return;
    const url = buildSurahPath(quranArabic[index]) || `/quran/surah/${index + 1}`;
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

// --- Opening Splash Animation ---
function setupOpeningAnimation() {
    const overlay = document.getElementById('site-opening-overlay');
    if (!overlay) return;

    const dismissOverlay = () => {
        if (!overlay || overlay.classList.contains('dismissed')) return;
        overlay.classList.add('dismissed');
        setTimeout(() => {
            if (overlay && overlay.parentNode) {
                overlay.remove();
            }
        }, 900);
    };

    // Auto-dismiss after 2s
    const timer = setTimeout(dismissOverlay, 2000);

    // Instant skip on tap/click
    overlay.addEventListener('click', () => {
        clearTimeout(timer);
        dismissOverlay();
    });
}

// --- Shared (Home) Logic ---
// Handles home navigation overlay open/close behavior.
function setupNavigation() {
    const hamburger = document.getElementById('hamburger-btn');
    const overlay = document.getElementById('nav-overlay');
    const closeBtn = document.getElementById('close-nav');
    if (hamburger && overlay) {
        hamburger.addEventListener('click', () => overlay.classList.toggle('active'));
    }
    if (closeBtn && overlay) {
        closeBtn.addEventListener('click', () => overlay.classList.remove('active'));
    }
    if (overlay) {
        overlay.querySelectorAll('a, button').forEach((el) => {
            el.addEventListener('click', () => overlay.classList.remove('active'));
        });
    }
}

function setupHomeAuth() {
    const modal = document.getElementById('home-auth-modal');
    if (!modal) return;

    const tokenKey = 'ruhverse_auth_token';
    const userKey = 'ruhverse_auth_user';
    const openers = Array.from(document.querySelectorAll('[data-auth-open]'));
    const closeBtn = document.getElementById('home-auth-close');
    const titleEl = document.getElementById('home-auth-title');
    const hintEl = document.getElementById('home-auth-hint');
    const form = document.getElementById('home-auth-form');
    const usernameInput = document.getElementById('home-auth-username');
    const emailInput = document.getElementById('home-auth-email');
    const passwordInput = document.getElementById('home-auth-password');
    const submitBtn = document.getElementById('home-auth-submit');
    const switchBtn = document.getElementById('home-auth-switch-btn');
    const switchHint = document.getElementById('home-auth-switch-hint');
    const errorEl = document.getElementById('home-auth-error');
    const toast = document.getElementById('home-auth-toast');

    const state = {
        mode: 'login',
        currentUser: null,
        toastTimer: 0
    };

    // Immediately restore cached user state to eliminate layout flash
    const cachedUserRaw = localStorage.getItem(userKey);
    if (cachedUserRaw) {
        try {
            state.currentUser = JSON.parse(cachedUserRaw);
            setLoginButtonState(state.currentUser);
        } catch (_) {}
    }

    function setError(message) {
        if (errorEl) errorEl.textContent = String(message || '');
    }

    function showToast(message, isError = false) {
        if (!toast) return;
        toast.textContent = String(message || '');
        toast.classList.toggle('error', isError);
        toast.classList.add('show');
        window.clearTimeout(state.toastTimer);
        state.toastTimer = window.setTimeout(() => {
            toast.classList.remove('show');
        }, 2200);
    }

    function setMode(nextMode) {
        state.mode = nextMode;
        const isRegister = state.mode === 'register';
        const isAccount = state.mode === 'account';

        if (usernameInput) {
            usernameInput.hidden = !isRegister;
            usernameInput.style.display = isRegister ? '' : 'none';
            usernameInput.required = isRegister;
            usernameInput.disabled = !isRegister;
            if (!isRegister) usernameInput.value = '';
        }
        if (emailInput) {
            emailInput.hidden = isAccount;
            emailInput.style.display = isAccount ? 'none' : '';
            emailInput.required = !isAccount;
        }
        if (passwordInput) {
            passwordInput.hidden = isAccount;
            passwordInput.style.display = isAccount ? 'none' : '';
            passwordInput.required = !isAccount;
        }

        if (isAccount) {
            const userLabel = state.currentUser?.username || state.currentUser?.email || 'Member';
            if (titleEl) titleEl.textContent = 'Your RuhVerse Account';
            if (hintEl) hintEl.textContent = `Signed in as ${userLabel}. Quran bookmarks and reading progress are synced.`;
            if (submitBtn) submitBtn.textContent = 'Log Out';
            if (switchHint) switchHint.textContent = 'Saved verses & notes?';
            if (switchBtn) switchBtn.textContent = 'Open Quran';
        } else if (isRegister) {
            if (titleEl) titleEl.textContent = 'Create Your RuhVerse Account';
            if (hintEl) hintEl.textContent = 'Register once to save Quran bookmarks. You must verify your email before login.';
            if (submitBtn) submitBtn.textContent = 'Create Account';
            if (switchHint) switchHint.textContent = 'Already have an account?';
            if (switchBtn) switchBtn.textContent = 'Login';
        } else {
            if (titleEl) titleEl.textContent = 'Login to Continue Your Journey';
            if (hintEl) hintEl.textContent = 'Sign in to sync your Quran bookmarks and reading progress.';
            if (submitBtn) submitBtn.textContent = 'Login';
            if (switchHint) switchHint.textContent = 'Do not have an account?';
            if (switchBtn) switchBtn.textContent = 'Create one';
        }
        setError('');
    }

    function openModal(mode = 'login') {
        setMode(mode);
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        window.setTimeout(() => {
            if (state.mode === 'login' && emailInput) emailInput.focus();
        }, 20);
    }

    function closeModal() {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        if (form) form.reset();
        setError('');
    }

    function setSubmitBusy(isBusy) {
        if (!submitBtn) return;
        submitBtn.disabled = Boolean(isBusy);
    }

    async function authRequest(path, payload, token) {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const controller = new AbortController();
        const timeoutHandle = window.setTimeout(() => controller.abort(), 15000);
        let response;
        try {
            response = await fetch(path, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload || {}),
                signal: controller.signal
            });
        } catch (error) {
            const isAbort = String(error?.name || '').toLowerCase() === 'aborterror';
            throw new Error(isAbort ? 'Request timed out. Please try again.' : `Network error: ${String(error?.message || 'Unable to reach server.')}`);
        } finally {
            window.clearTimeout(timeoutHandle);
        }
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            const err = new Error(data?.error || `Request failed (${response.status})`);
            err.status = response.status;
            throw err;
        }
        return data;
    }

    async function meRequest(token) {
        const response = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            const err = new Error(data?.error || `Request failed (${response.status})`);
            err.status = response.status;
            throw err;
        }
        return data;
    }

    function truncateName(value, max = 16) {
        const clean = String(value || '').trim();
        if (!clean) return '';
        return clean.length > max ? `${clean.slice(0, max)}...` : clean;
    }

    function resolveDisplayName(user) {
        const explicit = String(user?.username || '').trim();
        if (explicit) return explicit;
        const email = String(user?.email || '').trim();
        return String(email.split('@')[0] || '').trim();
    }

    function setLoginButtonState(user) {
        const isLoggedIn = Boolean(user && (user.username || user.email));
        const displayName = truncateName(resolveDisplayName(user));
        openers.forEach((btn) => {
            const sub = btn.querySelector('.premium-login-sub');
            const main = btn.querySelector('.premium-login-main');
            if (isLoggedIn) {
                btn.classList.add('is-logged-in');
                if (sub) sub.textContent = 'Signed In';
                if (main) main.textContent = displayName || 'Account';
                btn.setAttribute('aria-label', `Account logged in as ${displayName || 'member'}`);
            } else {
                btn.classList.remove('is-logged-in');
                if (sub) sub.textContent = btn.classList.contains('nav-login-mobile') ? 'Member Access' : 'RuhVerse';
                if (main) main.textContent = 'Login';
                btn.setAttribute('aria-label', 'Open login');
            }
        });
    }

    async function bootstrapSession() {
        const token = localStorage.getItem(tokenKey);
        if (!token) {
            state.currentUser = null;
            localStorage.removeItem(userKey);
            setLoginButtonState(null);
            return;
        }
        try {
            const me = await meRequest(token);
            if (me?.user) {
                state.currentUser = me.user;
                localStorage.setItem(userKey, JSON.stringify(me.user));
                setLoginButtonState(me.user);
            }
        } catch (err) {
            // ONLY clear session if server explicitly rejects with 401 or 403
            const status = Number(err?.status);
            const msg = String(err?.message || '');
            if (status === 401 || status === 403 || /401|403|unauthorized|invalid session/i.test(msg)) {
                localStorage.removeItem(tokenKey);
                localStorage.removeItem(userKey);
                state.currentUser = null;
                setLoginButtonState(null);
            }
        }
    }

    openers.forEach((btn) => {
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            if (state.currentUser) {
                openModal('account');
            } else {
                openModal('login');
            }
        });
    });

    if (switchBtn) {
        switchBtn.addEventListener('click', () => {
            if (state.mode === 'account') {
                window.location.href = '/quran';
                return;
            }
            setMode(state.mode === 'login' ? 'register' : 'login');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }

    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.style.display === 'flex') {
            closeModal();
        }
    });

    if (form) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            setError('');

            // Handle manual Log Out
            if (state.mode === 'account') {
                localStorage.removeItem(tokenKey);
                localStorage.removeItem(userKey);
                state.currentUser = null;
                setLoginButtonState(null);
                closeModal();
                showToast('Logged out successfully.');
                return;
            }

            const email = String(emailInput?.value || '').trim();
            const password = String(passwordInput?.value || '');
            const username = String(usernameInput?.value || '').trim();

            if (!email || !password) {
                setError('Email and password are required.');
                return;
            }
            if (state.mode === 'register' && username.length < 2) {
                setError('Username must be at least 2 characters.');
                return;
            }

            setSubmitBusy(true);
            try {
                const route = state.mode === 'register' ? '/api/auth/register' : '/api/auth/login';
                const payload = state.mode === 'register'
                    ? { username, email, password }
                    : { email, password };
                const result = await authRequest(route, payload);

                if (state.mode === 'register') {
                    if (result?.requiresEmailVerification) {
                        closeModal();
                        showToast(result?.message || 'Email verification sent. Please check your email.');
                        return;
                    }
                    if (result?.token) {
                        localStorage.setItem(tokenKey, result.token);
                        const userObj = result?.user || { username, email };
                        state.currentUser = userObj;
                        localStorage.setItem(userKey, JSON.stringify(userObj));
                        setLoginButtonState(userObj);
                        closeModal();
                        showToast(result?.message || 'Account created and login successful.');
                        return;
                    }
                    closeModal();
                    showToast(result?.message || 'Email verification sent. Please check your email.');
                    return;
                }

                if (!result?.token) {
                    throw new Error('Login succeeded but no session token was returned.');
                }

                localStorage.setItem(tokenKey, result.token);
                const userObj = result?.user || { username, email };
                state.currentUser = userObj;
                localStorage.setItem(userKey, JSON.stringify(userObj));
                setLoginButtonState(userObj);
                closeModal();
                showToast('Login successful.');
            } catch (error) {
                let message = error?.message || 'Authentication failed.';
                if (/sending confirmation|confirmation email|smtp/i.test(message)) {
                    message = 'Account created, but verification email could not be delivered yet. Please try again in a minute.';
                }
                if (state.mode === 'register' && /could not create account|create account right now/i.test(message) && email) {
                    try {
                        const resend = await authRequest('/api/auth/resend-verification', { email });
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
                    state.mode === 'login' &&
                    /verify your email|email not confirmed|email confirmation/i.test(message) &&
                    email
                ) {
                    authRequest('/api/auth/resend-verification', { email }).catch(() => null);
                    helper = ' We sent a fresh verification email.';
                }
                const finalMessage = `${message}${helper}`;
                setError(finalMessage);
                showToast(finalMessage, true);
            } finally {
                setSubmitBusy(false);
            }
        });
    }

    bootstrapSession().catch(() => {
        // Leave existing cached state alone if any
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('verified') === '1') {
        showToast('Email verified. You can now log in.');
        params.delete('verified');
        const query = params.toString();
        const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`;
        window.history.replaceState({}, '', cleanUrl);
    }
}

// Handles Ramadan/Eid countdown timers and live prayer countdown cards.
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
        const dayInMs = 24 * 60 * 60 * 1000;

        function updateEidSalahPromo(phase, msReference) {
            const textEl = document.getElementById('eid-promo-text');
            if (!textEl) return;

            const safeMs = Number.isFinite(msReference) ? msReference : 0;
            const daysLeft = Math.max(0, Math.ceil(safeMs / dayInMs));
            const daysText = String(daysLeft).padStart(2, '0');
            const nextState = `${phase}:${daysText}`;
            if (textEl.dataset.state === nextState) return;

            if (phase === 'pre') {
                textEl.innerHTML = `There are only <strong>${daysText}</strong> days left for Eid al-Fitr. Learn how to pray Eid Salah step by step with authentic Hadith guidance.`;
                textEl.dataset.state = nextState;
                return;
            }

            if (phase === 'ramadan') {
                textEl.innerHTML = `There are only <strong>${daysText}</strong> days left for Eid al-Fitr. Learn the Eid Salah method, takbeer, and khutbah before Eid morning.`;
                textEl.dataset.state = nextState;
                return;
            }

            if (phase === 'eid') {
                textEl.innerHTML = 'Eid is here. Read the step-by-step Eid Salah guide with takbeer, 2 rak\'ahs, and khutbah before going to the congregation.';
                textEl.dataset.state = nextState;
                return;
            }

            textEl.innerHTML = 'Bookmark this Eid Salah guide with authentic Hadith so you are prepared for the next Eid prayer.';
            textEl.dataset.state = nextState;
        }

        function updateRamadanCountdown() {
            const now = new Date();
            const msToStart = start - now;
            const msToEnd = end - now;

            const ramadanGrid = document.querySelector('.ramadan-grid');
            const subtitle = document.querySelector('.ramadan-subtitle');
            const sectionTitle = document.querySelector('#ramadan .section-title');

            // --- Phase 1: Countdown to START ---
            if (msToStart > 0) {
                if (sectionTitle) sectionTitle.textContent = 'Ramadan Starts In';
                if (subtitle) subtitle.textContent = 'Counting down to the most blessed month of the year.';
                updateEidSalahPromo('pre', msToEnd);
                renderCountdown(msToStart);
                return;
            }

            // --- Phase 2: Ramadan DAY 1 (Greeting) ---
            if (msToStart <= 0 && msToStart > -dayInMs) {
                if (sectionTitle) sectionTitle.textContent = 'Ramadan Mubarak';
                updateEidSalahPromo('ramadan', msToEnd);
                showFestiveMessage(ramadanGrid, subtitle, '🌙', 'Ramadan Mubarak!', 'The blessed month is here. May your fasts be accepted.', 'رَمَضَانُ مُبَارَكٌ');
                return;
            }

            // --- Phase 3: Ramadan ONGOING (Countdown to END) ---
            if (msToEnd > 0) {
                if (sectionTitle) sectionTitle.textContent = 'Ramadan Ends In';
                if (subtitle) subtitle.textContent = 'The month of mercy is passing. Make the most of every moment.';
                updateEidSalahPromo('ramadan', msToEnd);
                // If we were showing the festive message, we might need to restore the grid
                // This logic assumes renderCountdown handles restoring content if needed
                renderCountdown(msToEnd);
                return;
            }

            // --- Phase 4: Eid Day 1 (Greeting) ---
            if (msToEnd <= 0 && msToEnd > -dayInMs) {
                if (sectionTitle) sectionTitle.textContent = 'Eid Mubarak';
                updateEidSalahPromo('eid', msToEnd);
                showFestiveMessage(ramadanGrid, subtitle, '⭐', 'Eid Mubarak!', 'May Allah accept your fasts and prayers.', 'عيد مبارك');
                return;
            }

            // --- Phase 5: POST EID (Reset to next year) ---
            if (msToEnd <= -dayInMs) {
                updateEidSalahPromo('post', msToEnd);
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
        const unixTs = Math.floor(Date.now() / 1000);
        const endpoints = [
            `https://api.aladhan.com/v1/timings/${unixTs}?latitude=${lat}&longitude=${lon}&method=1`,
            `https://api.aladhan.com/v1/timingsByAddress?address=${encodeURIComponent(`${lat},${lon}`)}&method=1`
        ];

        try {
            let timings = null;
            for (const url of endpoints) {
                const res = await fetch(url);
                const json = await res.json();
                if (json.code === 200 && json.data && json.data.timings) {
                    timings = json.data.timings;
                    break;
                }
            }
            if (timings) {
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
// Renders local Ramadan dataset into table and highlights today's row.
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
// Builds rotating daily insight cards from a deterministic date-based subset.
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
    if (!isHomepageContext()) return;
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
    initHolyMosquesLeafletMaps();
}

function loadLeafletRuntime() {
    if (window.L) return Promise.resolve(window.L);
    if (window.__leafletLoadPromise) return window.__leafletLoadPromise;

    window.__leafletLoadPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-leaflet-runtime="1"]');
        if (existing) {
            existing.addEventListener('load', () => resolve(window.L));
            existing.addEventListener('error', reject);
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.defer = true;
        script.dataset.leafletRuntime = '1';
        script.onload = () => resolve(window.L);
        script.onerror = reject;
        document.head.appendChild(script);
    });

    return window.__leafletLoadPromise;
}

function initHolyMosquesLeafletMaps() {
    const mapNodes = document.querySelectorAll('.holy-mosque-map');
    if (!mapNodes.length) return;

    const section = document.querySelector('.holy-mosques-seo');
    if (!section) return;

    const boot = () => {
        loadLeafletRuntime().then(() => {
            mapNodes.forEach((node) => {
                if (node.dataset.initialized === '1') return;
                const lat = Number(node.dataset.lat);
                const lon = Number(node.dataset.lon);
                const label = node.dataset.label || 'Holy Mosque';
                if (!Number.isFinite(lat) || !Number.isFinite(lon) || !window.L) return;

                const map = L.map(node, { zoomControl: true, dragging: true }).setView([lat, lon], 14);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                }).addTo(map);
                L.marker([lat, lon], { title: label }).addTo(map).bindPopup(label);
                node.dataset.initialized = '1';
                setTimeout(() => map.invalidateSize(), 50);
            });
        }).catch((err) => {
            console.error('Leaflet runtime failed to load:', err);
        });
    };

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            boot();
        }, { rootMargin: '300px 0px' });
        observer.observe(section);
        return;
    }

    boot();
}

const NEARBY_MOSQUE_RADIUS_METERS = 10000;
const NEARBY_MOSQUE_LIMIT = 8;
const HOLY_MOSQUES_FALLBACK = [
    { name: 'Masjid al-Haram (Makkah)', note: 'Home of the Kaaba and the Qibla for all Muslims.' },
    { name: 'Al-Masjid an-Nabawi (Madinah)', note: 'The Prophet’s Mosque and one of Islam’s holiest sites.' },
    { name: 'Al-Aqsa Mosque (Jerusalem)', note: 'The first Qibla and the third holiest mosque in Islam.' },
    { name: 'Quba Mosque (Madinah)', note: 'Regarded as the first mosque established in Islam.' },
    { name: 'Qiblatain Mosque (Madinah)', note: 'Known for the historic change of Qibla direction.' }
];

function toRad(value) {
    return (value * Math.PI) / 180;
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const earthRadiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
}

function escapeHtmlText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderNearbyMosqueSection(title, subtitle, items) {
    const safeItems = Array.isArray(items) ? items : [];
    const listItemsHtml = safeItems.length
        ? safeItems.map((item) => {
            const note = item.note ? `<p>${escapeHtmlText(item.note)}</p>` : '';
            return `
                <li class="nearby-mosque-item">
                    <h4>${escapeHtmlText(item.name)}</h4>
                    ${note}
                </li>
            `;
        }).join('')
        : '<li class="nearby-mosque-item"><h4>No mosque data available right now.</h4></li>';

    return `
        <div class="featured-mosques-card">
            <div class="featured-mosques-header">
                <h3>${escapeHtmlText(title)}</h3>
                <p>${escapeHtmlText(subtitle)}</p>
            </div>
            <ul class="nearby-mosque-list">
                ${listItemsHtml}
            </ul>
        </div>
    `;
}

const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

async function fetchNearbyMosques(latitude, longitude, limit = NEARBY_MOSQUE_LIMIT) {
    const query = `
[out:json][timeout:15];
(
  node(around:${NEARBY_MOSQUE_RADIUS_METERS},${latitude},${longitude})["amenity"="mosque"];
  way(around:${NEARBY_MOSQUE_RADIUS_METERS},${latitude},${longitude})["amenity"="mosque"];
  relation(around:${NEARBY_MOSQUE_RADIUS_METERS},${latitude},${longitude})["amenity"="mosque"];
  node(around:${NEARBY_MOSQUE_RADIUS_METERS},${latitude},${longitude})["amenity"="place_of_worship"]["religion"="muslim"];
  way(around:${NEARBY_MOSQUE_RADIUS_METERS},${latitude},${longitude})["amenity"="place_of_worship"]["religion"="muslim"];
  relation(around:${NEARBY_MOSQUE_RADIUS_METERS},${latitude},${longitude})["amenity"="place_of_worship"]["religion"="muslim"];
);
out center tags;
    `.trim();

    let lastError = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                body: `data=${encodeURIComponent(query)}`,
                signal: controller.signal
            });
            clearTimeout(timer);
            if (!response.ok) continue;

            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('json')) continue;

            const data = await response.json();
            const elements = Array.isArray(data.elements) ? data.elements : [];
            const seen = new Set();
            const normalized = [];

            for (const element of elements) {
                const pointLat = Number(element.lat ?? element.center?.lat);
                const pointLon = Number(element.lon ?? element.center?.lon);
                if (!Number.isFinite(pointLat) || !Number.isFinite(pointLon)) continue;

                const distanceKm = calculateDistanceKm(latitude, longitude, pointLat, pointLon);
                if (!Number.isFinite(distanceKm) || distanceKm > (NEARBY_MOSQUE_RADIUS_METERS / 1000)) continue;

                const name = (element.tags && element.tags.name) ? String(element.tags.name).trim() : 'Local Mosque';
                const key = `${name.toLowerCase()}|${pointLat.toFixed(4)}|${pointLon.toFixed(4)}`;
                if (seen.has(key)) continue;
                seen.add(key);

                normalized.push({
                    name,
                    distanceKm,
                    note: `${distanceKm.toFixed(1)} km away`
                });
            }

            normalized.sort((a, b) => a.distanceKm - b.distanceKm);
            return normalized.slice(0, limit);
        } catch (err) {
            lastError = err;
        }
    }

    if (lastError) console.warn('Overpass lookup notice:', lastError);
    return [];
}

// Queries city timings by city name and renders quick location card.
async function handleCitySearch() {
    const input = document.getElementById('city-search-input');
    const city = input.value.trim();
    if (!city) return alert('Please enter a city name.');

    const btn = document.getElementById('city-search-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Searching...</span>';
    btn.disabled = true;

    try {
        const url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=&method=1`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.code === 200) {
            const meta = data.data && data.data.meta ? data.data.meta : {};
            const timezone = meta.timezone || null;
            const lat = Number(meta.latitude);
            const lon = Number(meta.longitude);
            let mosqueSectionHtml = '';
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                try {
                    const nearbyMosques = await fetchNearbyMosques(lat, lon);
                    if (nearbyMosques && nearbyMosques.length) {
                        mosqueSectionHtml = renderNearbyMosqueSection(
                            `Nearby Mosques in ${city} (Within 10 km)`,
                            `Showing ${nearbyMosques.length} verified mosque${nearbyMosques.length === 1 ? '' : 's'} near ${city}.`,
                            nearbyMosques
                        );
                    } else {
                        mosqueSectionHtml = renderNearbyMosqueSection(
                            'Holy Mosques in Islam',
                            `No local data for ${city}, showing globally revered sanctuaries.`,
                            HOLY_MOSQUES_FALLBACK
                        );
                    }
                } catch (mErr) {
                    console.warn('City mosque fetch notice:', mErr);
                }
            }
            renderLocationCard(city, data.data.timings, timezone, mosqueSectionHtml);
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

// Uses browser geolocation to fetch and render local prayer timings.
function syncUserLocation() {
    if (!navigator.geolocation) return alert('Geolocation is not supported by your browser.');

    const btn = document.getElementById('detect-location-btn');
    btn.innerHTML = '<span>&#128205; Detecting...</span>';

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
            const timezone = prayerData.data && prayerData.data.meta ? prayerData.data.meta.timezone : null;

            let mosqueSectionHtml = '';
            try {
                const nearbyMosques = await fetchNearbyMosques(latitude, longitude);
                mosqueSectionHtml = renderNearbyMosqueSection(
                    'Nearby Mosques (Within 10 km)',
                    'Based on your live location.',
                    nearbyMosques
                );
            } catch (mosqueError) {
                console.error('Nearby mosque lookup failed:', mosqueError);
                mosqueSectionHtml = renderNearbyMosqueSection(
                    'Nearby Mosques',
                    'Unable to fetch nearby data right now.',
                    []
                );
            }

            renderLocationCard(cityName, prayerData.data.timings, timezone, mosqueSectionHtml);
        } catch (e) {
            alert('Detected location, but failed to fetch timings.');
        } finally {
            btn.innerHTML = '<span>&#128205; Detect My City</span>';
        }
    }, (geoError) => {
        alert('Location access denied.');
        if (geoError && geoError.code) {
            console.warn('Geolocation denied/unavailable with code:', geoError.code);
        }

        const holyMosquesSectionHtml = renderNearbyMosqueSection(
            'Holy Mosques in Islam',
            'Location is disabled, so here are globally revered mosques.',
            HOLY_MOSQUES_FALLBACK
        );

        renderLocationCard('Location Access Needed', {
            Fajr: '--:--',
            Dhuhr: '--:--',
            Asr: '--:--',
            Maghrib: '--:--',
            Isha: '--:--'
        }, null, holyMosquesSectionHtml);

        btn.innerHTML = '<span>&#128205; Detect My City</span>';
    });
}

function getMinutesFromTimeString(timeStr) {
    if (!timeStr) return null;
    const normalized = String(timeStr).trim().split(' ')[0]; // handles "05:33 (IST)"
    const parts = normalized.split(':');
    if (parts.length < 2) return null;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return (h * 60) + m;
}

function getNowMinutesInTimezone(timezone) {
    try {
        const current = new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(new Date());
        const [h, m] = current.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        return (h * 60) + m;
    } catch (_) {
        return null;
    }
}

function getActivePrayerName(timings, timezone) {
    const prayerOrder = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    const nowMin = getNowMinutesInTimezone(timezone);
    if (nowMin === null) return null;

    const prayerMinutes = {};
    for (const prayer of prayerOrder) {
        prayerMinutes[prayer] = getMinutesFromTimeString(timings[prayer]);
    }

    const fajr = prayerMinutes.Fajr;
    const dhuhr = prayerMinutes.Dhuhr;
    const asr = prayerMinutes.Asr;
    const maghrib = prayerMinutes.Maghrib;
    const isha = prayerMinutes.Isha;

    if ([fajr, dhuhr, asr, maghrib, isha].some(v => v === null)) return null;

    if (nowMin >= isha || nowMin < fajr) return 'Isha';
    if (nowMin >= maghrib) return 'Maghrib';
    if (nowMin >= asr) return 'Asr';
    if (nowMin >= dhuhr) return 'Dhuhr';
    return 'Fajr';
}

function renderLocationCard(name, t, timezone, mosqueSectionHtml = '') {
    const container = document.getElementById('dynamic-search-results');
    container.style.display = 'block';
    const prayerOrder = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    const activePrayer = getActivePrayerName(t, timezone);
    const timingsHtml = prayerOrder.map((prayer) => {
        const isActive = prayer === activePrayer;
        const activeClass = isActive ? ' current-prayer' : '';
        return `
                <div class="timing-item${activeClass}">
                    <label>${prayer.toUpperCase()}</label>
                    <span>${t[prayer]}</span>
                </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="featured-location-card">
            <div class="loc-header">
                <div>
                    <span style="text-transform: uppercase; font-size: 0.8rem; letter-spacing: 2px; opacity: 0.8;">Active Location</span>
                    <h2>${escapeHtmlText(name)}</h2>
                </div>
                <div style="font-size: 2rem;">🕊️</div>
            </div>
            <div class="timings-strip">
                ${timingsHtml}
            </div>
            <div style="margin-top: 1.5rem; font-size: 0.8rem; opacity: 0.7; text-align: center;">
                Times based on Islamic University, Karachi Method
            </div>
        </div>
        ${mosqueSectionHtml}
    `;

    // Smooth scroll to the result
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
