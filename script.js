document.addEventListener('DOMContentLoaded', () => {
    setupDarkMode(); // Shared logic

    // Only run if specific elements exist
    if (document.body.classList.contains('quran-page-body')) {
        setupQuranApp();
    } else {
        // Home page logic
        try {
            loadContent();
            setupNavigation();
            setupTimers();
            loadRamadanCalendar();
            loadDailyInsights();
        } catch (err) {
            console.error("Critical error in homepage init:", err);
        }
    }
});

// --- API Config ---
const API_ARABIC = 'https://api.alquran.cloud/v1/quran/quran-uthmani';
const API_ENGLISH = 'https://api.alquran.cloud/v1/quran/en.sahih';

// --- State ---
let quranArabic = null;
let quranEnglish = null;
let currentSurahIndex = 0; // 0-based index

async function setupQuranApp() {
    setupSidebarControls();
    setupQuranViewControls();

    // --- Surah Click Scroll ---
    const sidebar = document.getElementById('sidebar');
    const surahHeader = sidebar ? sidebar.querySelector('h2') : null;
    if (surahHeader && sidebar) {
        surahHeader.style.cursor = 'pointer';
        surahHeader.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                sidebar.classList.toggle('expanded');
            }
        });
    }

    const surahList = document.getElementById('surah-list');
    surahList.innerHTML = '<li style="padding:2rem; text-align:center;">Fetching Quran Data...</li>';

    try {
        // Parallel Fetch
        const [resAr, resEn] = await Promise.all([
            fetch(API_ARABIC),
            fetch(API_ENGLISH)
        ]);

        const jsonAr = await resAr.json();
        const jsonEn = await resEn.json();

        quranArabic = jsonAr.data.surahs;
        quranEnglish = jsonEn.data.surahs;

        populateSurahList();
        loadSurah(0); // Load Al-Fatihah

    } catch (e) {
        console.error("Failed to load Quran:", e);
        list.innerHTML = '<li style="color:red; padding:1rem;">Failed to load data. Check internet.</li>';
    }
}

function setupSidebarControls() {
    // Login (Mock)
    const loginBtn = document.getElementById('login-btn-sidebar');
    const modal = document.getElementById('login-modal');
    const close = document.querySelector('.close-btn');

    if (loginBtn) loginBtn.onclick = () => modal.style.display = 'flex';
    if (close) close.onclick = () => modal.style.display = 'none';
    window.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

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
            <div style="display:flex; flex-direction:column;">
                <span style="font-weight:600;">${index + 1}. ${surah.englishName}</span>
                <span style="font-size:0.8rem; color:#888;">${surah.englishNameTranslation}</span>
            </div>
            <span class="arabic-name">${surah.name}</span>
        `;
        li.onclick = () => loadSurah(index);
        list.appendChild(li);
    });
}

function loadSurah(index) {
    currentSurahIndex = index;
    const surahAr = quranArabic[index];
    const surahEn = quranEnglish[index];

    // Update Title
    document.getElementById('current-surah-title').textContent = `${surahAr.number}. ${surahAr.englishName}`;

    // Highlight in list
    document.querySelectorAll('.surah-list li').forEach((li, idx) => {
        if (idx === index) li.classList.add('active');
        else li.classList.remove('active');
    });

    // Render Verses
    const container = document.getElementById('quran-text-container');
    container.innerHTML = '';

    // Bismillah (Simpler logic: just render verses, usually verse 1 has it)

    surahAr.ayahs.forEach((ayah, vIndex) => {
        const div = document.createElement('div');
        div.className = 'verse-block';

        // Arabic
        const arP = document.createElement('p');
        arP.className = 'ayah-arabic';
        arP.innerHTML = `${ayah.text} <span class="verse-number">${ayah.numberInSurah}</span>`;

        // English
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
let globalData = null;
async function loadContent() {
    try {
        const response = await fetch('data/content.json');
        if (response.ok) globalData = await response.json();
    } catch (error) { console.error('Error loading content:', error); }
}

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
        2024: { start: '2024-03-11', end: '2024-04-09' },
        2025: { start: '2025-03-01', end: '2025-03-30' },
        2026: { start: '2026-02-19', end: '2026-03-20' },
        2027: { start: '2027-02-08', end: '2027-03-09' },
        2028: { start: '2028-01-28', end: '2028-02-26' },
        2029: { start: '2029-01-16', end: '2029-02-14' },
        2030: { start: '2030-01-05', end: '2030-02-03' },
        2031: { start: '2031-12-26', end: '2032-01-24' },
        2032: { start: '2032-12-14', end: '2033-01-12' },
        2033: { start: '2033-12-03', end: '2034-01-01' },
        2034: { start: '2034-11-22', end: '2034-12-21' },
        2035: { start: '2035-11-12', end: '2035-12-11' },
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

        console.log('[Ramadan] Start:', start.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
        console.log('[Ramadan] End:  ', end.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
        console.log('[Ramadan] Now:  ', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));

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
    const PRAYER_IDS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

    function format12h(timeStr) {
        if (!timeStr) return '';
        const [h, m] = timeStr.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
    }

    function timeStrToDate(timeStr) {
        // timeStr is "HH:MM" in IST
        const [h, m] = timeStr.split(':').map(Number);
        const now = new Date();
        // Build a date in IST by using UTC offset +5:30
        const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const d = new Date(istNow);
        d.setHours(h, m, 0, 0);
        return d;
    }

    function updatePrayerCountdown(times) {
        const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

        let nextPrayer = null;
        let nextTime = null;

        for (let i = 0; i < PRAYER_NAMES.length; i++) {
            const t = timeStrToDate(times[PRAYER_NAMES[i]]);
            if (t > nowIST) {
                nextPrayer = PRAYER_NAMES[i];
                nextTime = t;
                break;
            }
        }

        // If all prayers passed, next is Fajr tomorrow
        if (!nextPrayer) {
            nextPrayer = 'Fajr';
            const fajrTomorrow = timeStrToDate(times['Fajr']);
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
            const t = timeStrToDate(times[name]);
            card.classList.remove('active');
            // Mark the most recent past prayer as active
            if (i < PRAYER_NAMES.length - 1) {
                const next = timeStrToDate(times[PRAYER_NAMES[i + 1]]);
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
        console.log('Ramadan calendar data loaded:', data.days.length, 'days found.');

        // Get today's date string in IST (DD Mon YYYY format to match)
        const now = new Date();
        const istDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        const day = String(istDate.getDate()).padStart(2, '0');
        const month = months[istDate.getMonth()];
        const year = istDate.getFullYear();
        const todayIST = `${day} ${month} ${year}`;

        console.log('Determined today (IST):', todayIST);

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
            console.log('Found today row, scrolling into view.');
            setTimeout(() => {
                todayRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 800);
        } else {
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

    // Initialize position and handle resize
    window.addEventListener('resize', updateCarousel);
    setTimeout(updateCarousel, 100); // Small delay to ensure layout is ready
}
