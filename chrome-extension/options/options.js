// YouTube SEO 分析器 — Options Page Logic

const DEFAULTS = {
  check_title_length: true, check_tags_empty: true, check_tags_count: true,
  check_description_empty: true, check_description_150: true, check_hashtag: true,
  check_cta: true, check_seo_block: true, check_search_intent: true,
  check_thumbnail_resolution: true, check_thumbnail_contrast: true,
  check_thumbnail_brightness: true, check_thumbnail_text: true,
  check_thumbnail_custom: true, check_thumbnail_color: true,
  check_transcript_30s: true, check_transcript_tags: true,
  check_transcript_density: true, check_transcript_wpm: true,
  check_transcript_cta: true, check_transcript_asr: true,
  thresh_cjk_max: 30, thresh_tags_min: 15, thresh_tags_min_shorts: 8,
  thresh_desc_min: 200, thresh_contrast_min: 40, thresh_brightness_min: 60,
  thresh_wpm_min: 50,
};

function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (items) => {
    for (const [key, val] of Object.entries(items)) {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = val;
      else if (el.type === 'number') el.value = val;
    }
  });
}

function saveSetting(key, val) {
  chrome.storage.sync.set({ [key]: val }, () => {
    const status = document.getElementById('save-status');
    status.textContent = '✓ 已儲存';
    status.className = 'saved';
    clearTimeout(status._timer);
    status._timer = setTimeout(() => { status.textContent = ''; status.className = ''; }, 2000);
  });
}

function setupListeners() {
  document.querySelectorAll('input[type="checkbox"]').forEach(el => {
    el.addEventListener('change', () => saveSetting(el.id, el.checked));
  });
  document.querySelectorAll('input[type="number"]').forEach(el => {
    el.addEventListener('change', () => saveSetting(el.id, parseInt(el.value, 10)));
  });
}

document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm('確定重設所有設定為預設值？')) return;
  chrome.storage.sync.set(DEFAULTS, () => {
    loadSettings();
    const status = document.getElementById('save-status');
    status.textContent = '✓ 已重設為預設值';
    status.className = 'saved';
    setTimeout(() => { status.textContent = ''; status.className = ''; }, 3000);
  });
});

loadSettings();
setupListeners();
