// YouTube SEO 分析器 — Shared Settings Module
// Loaded before content.js in the content script execution order.

window.YTSEO_SETTINGS = (function() {
  'use strict';

  const DEFAULTS = {
    // — Toggle individual checks —
    check_title_length: true,
    check_tags_empty: true,
    check_tags_count: true,
    check_description_empty: true,
    check_description_150: true,
    check_hashtag: true,
    check_cta: true,
    check_seo_block: true,
    check_search_intent: true,
    check_thumbnail_resolution: true,
    check_thumbnail_contrast: true,
    check_thumbnail_brightness: true,
    check_thumbnail_text: true,
    check_thumbnail_custom: true,
    check_thumbnail_color: true,
    check_transcript_30s: true,
    check_transcript_tags: true,
    check_transcript_density: true,
    check_transcript_wpm: true,
    check_transcript_cta: true,
    check_transcript_asr: true,
    // — Thresholds —
    thresh_cjk_max: 30,
    thresh_tags_min: 15,
    thresh_tags_min_shorts: 8,
    thresh_desc_min: 200,
    thresh_contrast_min: 40,
    thresh_brightness_min: 60,
    thresh_wpm_min: 50,
    thresh_boilerplate_max: 80,
    thresh_tag_relevance_min: 0.2,
    thresh_kw30_min: 0.3,
    thresh_density_min: 0.2,
  };

  let cached = null;

  function loadSync() {
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.sync.get(DEFAULTS, (items) => {
          cached = items;
          resolve(items);
        });
      } else {
        // Fallback for development without chrome API
        cached = DEFAULTS;
        resolve(DEFAULTS);
      }
    });
  }

  function get(key) {
    if (!cached) return DEFAULTS[key];
    return cached[key] !== undefined ? cached[key] : DEFAULTS[key];
  }

  function getAll() {
    return cached || DEFAULTS;
  }

  function resetCache() {
    cached = null;
  }

  // Preload immediately
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.sync.get(DEFAULTS, (items) => { cached = items; });
  } else {
    cached = DEFAULTS;
  }

  return { loadSync, get, getAll, resetCache, DEFAULTS };
})();
