const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://ruhverse.online';

const API_AR = 'https://api.alquran.cloud/v1/quran/quran-uthmani';
const API_EN = 'https://api.alquran.cloud/v1/quran/en.sahih';
const TEMPLATE_PATH = path.join(__dirname, 'quran.html');
const QURAN_TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8');
const BISMILLAH = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';

let quranCache = null;
let quranCacheTime = 0;
let quranFetchPromise = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function getQuranData() {
  const now = Date.now();
  if (quranCache && (now - quranCacheTime) < CACHE_TTL_MS) {
    return quranCache;
  }

  if (!quranFetchPromise) {
    quranFetchPromise = (async () => {
      const [resAr, resEn] = await Promise.all([fetch(API_AR), fetch(API_EN)]);
      if (!resAr.ok || !resEn.ok) {
        throw new Error(`Quran API failed: ar=${resAr.status}, en=${resEn.status}`);
      }

      const [jsonAr, jsonEn] = await Promise.all([resAr.json(), resEn.json()]);
      const data = {
        quranArabic: jsonAr.data.surahs,
        quranEnglish: jsonEn.data.surahs
      };

      quranCache = data;
      quranCacheTime = Date.now();
      return data;
    })().finally(() => {
      quranFetchPromise = null;
    });
  }

  return quranFetchPromise;
}

function renderSurahHtml(surahAr, surahEn, index) {
  let html = '';
  if (index !== 0 && index !== 8) {
    html += `<div class="bismillah-block">${BISMILLAH}</div>`;
  }

  surahAr.ayahs.forEach((ayah, vIndex) => {
    let text = ayah.text;
    if (vIndex === 0 && index !== 0 && index !== 8 && text.startsWith(BISMILLAH)) {
      text = text.replace(BISMILLAH, '').trim();
    }

    html += `<div class="verse-block">`;
    html += `<p class="ayah-arabic">${escapeHtml(text)} <span class="verse-number">${ayah.numberInSurah}</span></p>`;
    html += `<p class="ayah-translation">${escapeHtml(surahEn.ayahs[vIndex].text)}</p>`;
    html += `</div>`;
  });

  return html;
}

function renderSurahListHtml(quranArabic, activeIndex) {
  return quranArabic.map((surah, index) => {
    const isActive = index === activeIndex ? ' active' : '';
    return `
      <li class="${isActive}">
        <a href="/quran/surah/${surah.number}" style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;text-decoration:none;color:inherit;">
          <span style="font-weight:600;">${surah.number}. ${escapeHtml(surah.englishName)}</span>
          <span class="arabic-name">${escapeHtml(surah.name)}</span>
        </a>
      </li>
    `;
  }).join('');
}

function renderQuranPage(templateHtml, data, initialSurahIndex, canonicalPath) {
  const { quranArabic, quranEnglish } = data;
  const surahAr = quranArabic[initialSurahIndex];
  const surahEn = quranEnglish[initialSurahIndex];
  const surahMeta = quranArabic.map((surah) => ({
    number: surah.number,
    name: surah.name,
    englishName: surah.englishName,
    englishNameTranslation: surah.englishNameTranslation
  }));

  const pageTitle = `Surah ${surahAr.englishName} (${surahAr.number}) - Read Quran Online - RuhVerse`;
  const pageDescription = `Read Surah ${surahAr.englishName} (${surahAr.number}) with Arabic text and English translation on RuhVerse.`;
  const canonical = `${PUBLIC_BASE_URL}${canonicalPath}`;
  const currentTitle = `${surahAr.number}. ${surahAr.englishName}`;

  const ssrData = `
<script>
window.__SSR_BOOTSTRAP = ${JSON.stringify({
  surahMeta,
  initialSurahIndex,
  initialSurahArabic: surahAr,
  initialSurahEnglish: surahEn
})};
window.__INITIAL_SURAH_INDEX = ${initialSurahIndex};
</script>
`;

  return templateHtml
    .replace('<!--SSR_PAGE_TITLE-->Read Quran Online - RuhVerse', escapeHtml(pageTitle))
    .replace('<!--SSR_PAGE_DESCRIPTION-->Read the Holy Quran online with translations, beautiful recitations, and a premium 3D interface on RuhVerse.', escapeHtml(pageDescription))
    .replace('<!--SSR_CANONICAL-->https://ruhverse.online/quran.html', escapeHtml(canonical))
    .replace('<!--SSR_CURRENT_SURAH_TITLE-->Al-Fatihah', escapeHtml(currentTitle))
    .replace('<!--SSR_SURAH_LIST-->', renderSurahListHtml(quranArabic, initialSurahIndex))
    .replace('<!--SSR_QURAN_CONTENT-->', renderSurahHtml(surahAr, surahEn, initialSurahIndex))
    .replace('<!--SSR_DATA-->', ssrData);
}

async function serveQuranPage(req, res, initialSurahIndex, canonicalPath) {
  const templateHtml = QURAN_TEMPLATE;

  try {
    const data = await getQuranData();
    const html = renderQuranPage(templateHtml, data, initialSurahIndex, canonicalPath);
    res.send(html);
  } catch (err) {
    console.error('SSR fetch failed, falling back to static page:', err);
    const fallback = templateHtml
      .replace('<!--SSR_SURAH_LIST-->', '')
      .replace('<!--SSR_QURAN_CONTENT-->', '<div class="loading-spinner">Loading Quran Data...</div>')
      .replace('<!--SSR_DATA-->', '')
      .replace('<!--SSR_CURRENT_SURAH_TITLE-->Al-Fatihah', 'Al-Fatihah')
      .replace('<!--SSR_CANONICAL-->https://ruhverse.online/quran.html', `${PUBLIC_BASE_URL}${canonicalPath}`)
      .replace('<!--SSR_PAGE_TITLE-->Read Quran Online - RuhVerse', 'Read Quran Online - RuhVerse')
      .replace('<!--SSR_PAGE_DESCRIPTION-->Read the Holy Quran online with translations, beautiful recitations, and a premium 3D interface on RuhVerse.', 'Read the Holy Quran online with translations, beautiful recitations, and a premium 3D interface on RuhVerse.');
    res.send(fallback);
  }
}

app.get('/api/quran-data', async (req, res) => {
  try {
    const data = await getQuranData();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to load Quran data' });
  }
});

app.get(['/quran.html', '/quran'], async (req, res) => {
  await serveQuranPage(req, res, 0, '/quran.html');
});

app.get('/quran/surah/1', (req, res) => {
  res.redirect(301, '/quran.html');
});

app.get('/quran/surah/:surahNumber(\\d+)', async (req, res) => {
  const surahNumber = Number(req.params.surahNumber);
  if (surahNumber < 1 || surahNumber > 114) {
    res.status(404).send('Surah not found');
    return;
  }

  const index = surahNumber - 1;
  await serveQuranPage(req, res, index, `/quran/surah/${surahNumber}`);
});

// Static files should be served after SSR Quran routes so quran.html is not served raw.
app.use(express.static(path.join(__dirname)));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`RuhVerse SSR server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
