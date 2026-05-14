// YouTube SEO 分析器 — Content Script v1.1
// Shorts 支援 + Canvas 縮圖視覺分析

(function () {
  'use strict';

  // ======================== STATE ========================

  let panelOpen = false;
  let currentData = null;

  // ======================== UTILITY ========================

  function isShortsPage() {
    return window.location.pathname.startsWith('/shorts/');
  }

  function isWatchPage() {
    return window.location.pathname.startsWith('/watch');
  }

  function getVideoIdFromUrl() {
    if (isWatchPage()) return new URLSearchParams(window.location.search).get('v') || '';
    if (isShortsPage()) return window.location.pathname.split('/shorts/')[1] || '';
    return '';
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function extractDurationFromMeta() {
    const meta = document.querySelector('meta[itemprop="duration"]');
    if (!meta) return 0;
    const content = meta.getAttribute('content') || '';
    const m = content.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1]||'0',10) * 3600) + (parseInt(m[2]||'0',10) * 60) + parseInt(m[3]||'0',10);
  }

  // ======================== DATA EXTRACTION ========================

  function extractVideoData() {
    const videoId = getVideoIdFromUrl();

    // Priority 1: ytInitialPlayerResponse (works for both watch & shorts)
    const pr = window.ytInitialPlayerResponse;
    if (pr?.videoDetails) {
      const vd = pr.videoDetails;
      const _title = vd.title || '';
      const _desc = vd.shortDescription || '';
      return {
        title: _title,
        description: _desc,
        _cjkChars: (_title.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) || []),
        _descLength: _desc ? _desc.trim().length : 0,
        tags: vd.keywords || [],
        channelName: vd.author || '',
        channelId: vd.channelId || '',
        viewCount: parseInt(vd.viewCount || '0', 10),
        duration: parseInt(vd.lengthSeconds || extractDurationFromMeta() || '0', 10),
        videoId: vd.videoId || videoId,
        isLive: !!vd.isLiveContent,
        isPrivate: !!vd.isPrivate,
        thumbnail: vd.thumbnail?.thumbnails?.slice(-1)[0]?.url || '',
        source: 'playerResponse',
        isShorts: isShortsPage(),
      };
    }

    // Priority 2: page-type-specific fallback
    if (isShortsPage()) return extractShortsFallback(videoId);
    return extractWatchFallback();
  }

  // ——— Shorts DOM fallback ———
  function extractShortsFallback(videoId) {
    const title = document.querySelector('h1.title')?.textContent?.trim()
      || document.title.replace(' - YouTube', '').replace(/#Shorts/gi, '').trim()
      || '';

    const descEl = document.querySelector('#description') ||
      document.querySelector('[itemprop="description"]');
    const description = descEl?.textContent?.trim() || descEl?.getAttribute('content') || '';

    const metaTags = document.querySelector('meta[name="keywords"]');
    const tags = metaTags?.getAttribute('content')?.split(',').map(t => t.trim()).filter(Boolean) || [];

    const channelEl = document.querySelector('#owner #channel-name a') ||
      document.querySelector('ytd-channel-name a') ||
      document.querySelector('[role="toolbar"] a[href*="/@"]');
    const channelName = channelEl?.textContent?.trim() || '';

    return {
      title,
      description,
      _cjkChars: (title.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) || []),
      _descLength: description ? description.trim().length : 0,
      tags,
      channelName,
      channelId: '',
      viewCount: 0,
      duration: extractDurationFromMeta(),
      videoId,
      isLive: false,
      isPrivate: false,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      source: 'shorts-dom',
      isShorts: true,
    };
  }

  // ——— Watch DOM fallback ———
  function extractWatchFallback() {
    const title = document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim()
      || document.title.replace(' - YouTube', '') || '';

    const descEl = document.querySelector('#description-inner') || document.querySelector('#description');
    const description = descEl?.textContent?.trim() || '';

    const metaTags = document.querySelector('meta[name="keywords"]');
    const tags = metaTags?.getAttribute('content')?.split(',').map(t => t.trim()).filter(Boolean) || [];

    const channelEl = document.querySelector('#owner #channel-name a') || document.querySelector('ytd-channel-name a');
    const channelName = channelEl?.textContent?.trim() || '';

    const viewEl = document.querySelector('.view-count') || document.querySelector('ytd-video-primary-info-renderer .view-count');
    const viewText = viewEl?.textContent?.replace(/[^0-9]/g, '') || '0';

    return {
      title,
      description,
      _cjkChars: (title.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) || []),
      _descLength: description ? description.trim().length : 0,
      tags,
      channelName,
      channelId: '',
      viewCount: parseInt(viewText) || 0,
      duration: extractDurationFromMeta(),
      videoId: new URLSearchParams(window.location.search).get('v') || '',
      isLive: false,
      isPrivate: false,
      thumbnail: '',
      source: 'watch-dom',
      isShorts: false,
    };
  }

  // ======================== THUMBNAIL VISION ANALYSIS ========================

  function getThumbnailUrl(data) {
    if (data.thumbnail) return data.thumbnail;
    if (data.videoId) return `https://i.ytimg.com/vi/${data.videoId}/maxresdefault.jpg`;
    return null;
  }

  async function analyzeThumbnail(data) {
    const url = getThumbnailUrl(data);
    if (!url) return null;

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const W = 320;
          const H = Math.round(320 * (img.naturalHeight / img.naturalWidth));
          canvas.width = W;
          canvas.height = H;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, W, H);

          const imageData = ctx.getImageData(0, 0, W, H);
          const px = imageData.data;
          const total = W * H;

          // Single-pass: compute brightness, contrast, edge density, and color clusters
          const BLOCK = 8;
          const bw = Math.ceil(W / BLOCK), bh = Math.ceil(H / BLOCK);
          const blockStats = new Array(bw * bh);
          for (let bi = 0; bi < blockStats.length; bi++) blockStats[bi] = { sum: 0, sumSq: 0, cnt: 0 };

          let sumLum = 0, sumLumSq = 0;
          const colorMap = new Map();

          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const idx = (y * W + x) * 4;
              const r = px[idx], g = px[idx + 1], b = px[idx + 2];
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;

              sumLum += lum;
              sumLumSq += lum * lum;

              // Block-level variance (edge density proxy)
              const bx = Math.floor(x / BLOCK), by = Math.floor(y / BLOCK);
              const bs = blockStats[by * bw + bx];
              bs.sum += lum;
              bs.sumSq += lum * lum;
              bs.cnt++;

              // Color quantization
              const qr = Math.round(r / 64) * 64, qg = Math.round(g / 64) * 64, qb = Math.round(b / 64) * 64;
              if (qr + qg + qb >= 60) {
                const key = `${qr},${qg},${qb}`;
                const entry = colorMap.get(key);
                if (entry) entry.count++;
                else colorMap.set(key, { key, r: qr, g: qg, b: qb, count: 1 });
              }
            }
          }

          // Compute derived values
          const avgLum = sumLum / total;
          const variance = sumLumSq / total - avgLum * avgLum;
          const contrast = Math.sqrt(variance);

          let edgeBlocks = 0;
          for (const bs of blockStats) {
            if (bs.cnt > 0) {
              const bAvg = bs.sum / bs.cnt;
              const bVar = bs.sumSq / bs.cnt - bAvg * bAvg;
              if (bVar > 800) edgeBlocks++;
            }
          }
          const edgeDensity = edgeBlocks / blockStats.length;

          const sorted = [...colorMap.values()].sort((a, b) => b.count - a.count);
          const dominantColors = sorted.slice(0, 3).map(c => ({
            rgb: `rgb(${c.r},${c.g},${c.b})`,
            hex: `#${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}`,
            pct: Math.round(c.count / total * 100),
          }));

        // — Resolution check —
        const isMaxRes = img.naturalWidth >= 1280;
        const isCustom = isMaxRes; // maxresdefault only exists for custom thumbnails

        // — Text likelihood score —
        // High edge density + moderate brightness + high contrast = likely text
        const textLikelihood = edgeDensity > 0.15 ? (edgeDensity > 0.25 ? 'high' : 'medium') : 'low';

        resolve({
          width: img.naturalWidth,
          height: img.naturalHeight,
          isMaxRes,
          isCustom,
          avgBrightness: Math.round(avgLum),
          contrast: Math.round(contrast),
          edgeDensity: Math.round(edgeDensity * 100) / 100,
          textLikelihood,
          dominantColors,
          thumbnailUrl: url,
        });
        } catch (e) {
          console.warn('[YT SEO] Canvas analysis failed:', e);
          resolve({
            width: img.naturalWidth, height: img.naturalHeight,
            isMaxRes: img.naturalWidth >= 1280, isCustom: img.naturalWidth >= 1280,
            avgBrightness: 0, contrast: 0, edgeDensity: 0,
            textLikelihood: 'unknown', dominantColors: [],
            thumbnailUrl: url, error: 'canvas_tainted',
          });
        }
      };

      img.onerror = () => {
        // Try lower-res fallback
        const fallback = `https://i.ytimg.com/vi/${data.videoId}/default.jpg`;
        const fImg = new Image();
        fImg.crossOrigin = 'anonymous';
        fImg.onload = () => {
          resolve({
            width: fImg.naturalWidth,
            height: fImg.naturalHeight,
            isMaxRes: false,
            isCustom: false,
            avgBrightness: 0,
            contrast: 0,
            edgeDensity: 0,
            textLikelihood: 'unknown',
            dominantColors: [],
            thumbnailUrl: fallback,
            fallback: true,
          });
        };
        fImg.onerror = () => resolve(null);
        fImg.src = fallback;
      };

      img.src = url;
    });
  }

  // ======================== TRANSCRIPT FETCH ========================

  async function fetchTranscript(videoData) {
    const pr = window.ytInitialPlayerResponse;
    const captionRenderer = pr?.captions?.playerCaptionsTracklistRenderer;
    if (!captionRenderer?.captionTracks?.length) return null;

    // Preference order: zh-Hant > zh-TW > zh > en > first available
    const langPref = ['zh-Hant', 'zh-TW', 'zh-CN', 'zh', 'en'];
    let track = null;
    for (const lang of langPref) {
      track = captionRenderer.captionTracks.find(t => t.languageCode === lang);
      if (track) break;
    }
    if (!track) track = captionRenderer.captionTracks[0];
    if (!track?.baseUrl) return null;

    try {
      // Retry up to 2 times for transient failures (e.g. CDN 503)
      let resp = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        resp = await fetch(track.baseUrl);
        if (resp.ok) break;
        if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
      }
      if (!resp || !resp.ok) return null;
      const xml = await resp.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');
      const textEls = doc.querySelectorAll('text');

      const segments = [];
      textEls.forEach(el => {
        const start = parseFloat(el.getAttribute('start'));
        const dur = parseFloat(el.getAttribute('dur'));
        const text = (el.textContent || '').trim();
        if (text) segments.push({ start, dur, text });
      });

      if (segments.length === 0) return null;

      return {
        language: track.languageCode,
        kind: track.kind || 'manual', // 'asr' for auto-generated
        isAuto: track.kind === 'asr',
        segments,
        fullText: segments.map(s => s.text).join(' '),
        duration: segments[segments.length - 1].start + segments[segments.length - 1].dur,
      };
    } catch (e) {
      console.warn('[YT SEO] Transcript fetch failed:', e);
      return null;
    }
  }

  // ======================== TRANSCRIPT ANALYSIS ========================

  function analyzeTranscript(transcript, videoData) {
    if (!transcript?.segments?.length) return { issues: [], info: null };

    const findings = [];
    const segments = transcript.segments;
    const S = window.YTSEO_SETTINGS ? window.YTSEO_SETTINGS : { get: () => true };
    const fullText = transcript.fullText;
    const totalDuration = transcript.duration;

    // Extract meaningful words from title (split by common delimiters)
    const titleWords = videoData.title
      .split(/[\s,，、.。、:：!！?？/｜—–\-–—()（）\[\]【】]+/)
      .filter(w => w.length > 1 && w.length < 30)
      .map(w => w.replace(/^#/, '')); // strip hashtag prefix

    // — P1: First 30 seconds keyword gap —
    const first30Segs = segments.filter(s => s.start < 30);
    const first30Text = first30Segs.map(s => s.text).join(' ').toLowerCase();
    const titleWordsLower = videoData.title.toLowerCase();

    // Check if any significant title word appears in first 30s
    const significantWords = titleWords.filter(w => w.length >= 2);
    const kwInFirst30 = significantWords.filter(w => first30Text.includes(w.toLowerCase()));
    const kwCoverage30 = significantWords.length > 0 ? kwInFirst30.length / significantWords.length : 0;

    if (S.get('check_transcript_30s') && kwCoverage30 < parseFloat(S.get('thresh_kw30_min')) && significantWords.length >= 2 && first30Text.length > 20) {
      findings.push({
        severity: 'P1', icon: '🎙',
        title: '前 30 秒未提及標題關鍵詞',
        detail: 'YouTube 觀眾在決定是否繼續觀看時，前 30 秒是關鍵。若這段時間沒有提到標題中的核心關鍵詞，觀眾可能覺得影片文不對題而跳出。',
        fix: `在影片開頭 30 秒內直接說出核心關鍵詞，例如：「今天我們要來談${significantWords.slice(0, 2).join('和')}...」。`,
      });
    }

    // — P1: Content relevance — does transcript mention any tags?
    const tags = videoData.tags || [];
    const tagHits = tags.filter(tag => {
      const lower = tag.toLowerCase();
      return fullText.toLowerCase().includes(lower);
    });
    const tagRelevance = tags.length > 0 ? tagHits.length / tags.length : 0;

    if (S.get('check_transcript_tags') && tags.length >= 3 && tagRelevance < parseFloat(S.get('thresh_tag_relevance_min'))) {
      findings.push({
        severity: 'P1', icon: '🎯',
        title: '逐字稿與標籤關聯性低',
        detail: `只有 ${tagHits.length}/${tags.length} 個標籤出現在口語內容中。標籤若與實際內容脫節，YouTube 可能會判定為關鍵詞填充。`,
        fix: '確保標籤是真實反映影片內容的關鍵詞，而非不相關的熱門搜尋詞。或者調整口語內容使其涵蓋這些主題。',
      });
    }

    // — P2: Keyword density in full transcript —
    const wordCount = fullText.split(/\s+/).length;
    const titleHitCount = significantWords.reduce((sum, w) => {
      const regex = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = fullText.match(regex);
      return sum + (matches ? matches.length : 0);
    }, 0);

    if (S.get('check_transcript_density') && wordCount > 50 && titleHitCount === 0 && significantWords.length >= 2) {
      findings.push({
        severity: 'P2', icon: '📊',
        title: '標題關鍵詞完全未出現在口語中',
        detail: `標題中的關鍵詞（${significantWords.slice(0, 3).join('、')}等）完全沒出現在逐字稿中。這可能表示標題與內容脫節。`,
        fix: '確認標題是否準確反映影片內容。如果是，在口語中多提及這些關鍵詞。',
      });
    }

    // — P2: Transcript-to-duration ratio (long silences) —
    if (totalDuration > 60 && wordCount > 0) {
      const wpm = wordCount / (totalDuration / 60);
      if (wpm < parseInt(S.get('thresh_wpm_min'), 10)) {
        findings.push({
          severity: 'P2', icon: '⏱',
          title: '口語密度偏低（可能有大量空白/音樂）',
          detail: `每分鐘約 ${Math.round(wpm)} 字（基準線：100–160 wpm）。低密度可能表示有大量沉默、純音樂或無關內容。`,
          fix: '檢查影片中是否有過長空白段落。對於教學/解說類內容，維持穩定的口語節奏有助於保留觀眾。',
        });
      }
    }

    // — P3: Verbal CTA in last 30s —
    const last30Segs = segments.filter(s => (totalDuration - s.start) <= 30);
    const last30Text = last30Segs.map(s => s.text).join(' ');
    const hasVerbalCTA = /訂閱|subscribe|追蹤|按讚|like|下一[集部]|next|記得.*(按讚|留言|分享)|comment|share/i.test(last30Text);

    if (S.get('check_transcript_cta') && !hasVerbalCTA && totalDuration > 60) {
      findings.push({
        severity: 'P3', icon: '💬',
        title: '結尾缺乏口語行動呼籲 (CTA)',
        detail: '在影片結尾直接用口頭引導觀眾互動（訂閱、留言、看下一集）能顯著提升互動率。僅在說明中寫 CTA 是不夠的。',
        fix: '在影片最後 30 秒加入口頭 CTA：「如果你喜歡這支影片，別忘了訂閱頻道並開啟小鈴鐺！」',
      });
    }

    // — P3: Verbal structure note —
    if (S.get('check_transcript_asr') && transcript.isAuto) {
      findings.push({
        severity: 'P3', icon: '🤖',
        title: '字幕為自動產生 (ASR)',
        detail: '自動字幕準確率約 80-90%。若有較多專業術語或非母語發音，錯誤率更高，可能影響分析結果與非母語觀眾的理解。',
        fix: '上傳手動字幕檔案 (.srt/.vtt) 可確保 100% 準確，並改善影片的可及性與 SEO。',
      });
    }

    // Build transcript info summary
    const info = {
      language: transcript.language,
      isAuto: transcript.isAuto,
      wordCount,
      duration: totalDuration,
      wpm: totalDuration > 0 ? Math.round(wordCount / (totalDuration / 60)) : 0,
      segmentsCount: segments.length,
      hasVerbalCTA,
      titleKwCoverage: Math.round(kwCoverage30 * 100),
    };

    return { issues: findings, info };
  }

  // ======================== SEO ANALYSIS ========================

  function analyzeVideo(data, thumbResult, transcriptFindings) {
    const issues = [];
    const isShorts = data.isShorts;
    let score = 100;

    // Use pre-computed values from data when available, else compute
    const S = window.YTSEO_SETTINGS ? window.YTSEO_SETTINGS : { get: () => true };
    const cjkChars = data._cjkChars || (data.title.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g) || []);
    const descLength = data._descLength != null ? data._descLength : (data.description ? data.description.trim().length : 0);
    const hasNoTags = !data.tags || data.tags.length === 0;

    // =============================================
    //  P0 — Critical
    // =============================================

    if (S.get('check_tags_empty') && hasNoTags) {
      issues.push({
        severity: 'P0', icon: '🏷',
        title: '完全沒有標籤 (Tags)',
        detail: 'YouTube 透過標籤理解影片主題與上下文。無標籤 = 演算法無法有效分類，搜尋排名會顯著降低。',
        fix: '新增 15–20 個標籤，混合中英文：核心關鍵詞 → 長尾變體 → 相關主題 → 年份 → 語言變體。',
      });
      score -= 20;
    }

    // Shorts: #Shorts in title
    if (isShorts && S.get('check_title_length')) {
      const hasShortsTag = /#\s*[Ss]horts/.test(data.title);
      if (!hasShortsTag) {
        issues.push({
          severity: 'P0', icon: '📱',
          title: 'Shorts 標題缺少 #Shorts',
          detail: 'Shorts 需要在標題中標註 #Shorts（或 #shorts）以便 YouTube 正確分類並在 Shorts feed 中推薦。',
          fix: '在標題末尾加入 #Shorts，例如：「5 個拍照技巧 #Shorts」。注意僅 Shorts 頁面有此需求。',
        });
        score -= 15;
      }
    }

    if (S.get('check_title_length') && cjkChars.length > parseInt(S.get('thresh_cjk_max'), 10)) {
      issues.push({
        severity: 'P0', icon: '📱',
        title: `標題中文字元過長（${cjkChars.length} 字）`, 
        detail: `YouTube 在行動裝置上約顯示 30 個中文字。超出 ${cjkChars.length - 30} 字會被截斷。`,
        fix: `前 30 字：${data.title.slice(0, 30)}…。請將核心關鍵詞和鉤子全部移入前 30 字範圍內。`,
      });
      score -= 15;
    }

    if (S.get('check_description_empty') && descLength === 0) {
      issues.push({
        severity: 'P0', icon: '📝',
        title: isShorts ? 'Shorts 說明為空' : '完全沒有影片說明',
        detail: isShorts
          ? 'Shorts 說明雖然通常較短，但空白說明會錯失 SEO 和 CTA 引導的機會。'
          : '說明（Description）是 YouTube SEO 排名第二重要的欄位。空白說明 = 放棄大量搜尋曝光。',
        fix: isShorts
          ? '在說明中加入 1–2 句描述 + #Shorts hashtag，讓演算法能理解內容主題。'
          : '撰寫至少 200 字的說明。前 150 字包含核心關鍵詞和鉤子。',
      });
      score -= 20;
    }

    // =============================================
    //  P1 — Important
    // =============================================

    if (S.get('check_tags_count') && !hasNoTags && data.tags.length < parseInt(S.get(isShorts ? 'thresh_tags_min_shorts' : 'thresh_tags_min'), 10)) {
      issues.push({
        severity: 'P1', icon: '🏷',
        title: `標籤僅 ${data.tags.length} 個（建議 ${isShorts ? '8–12' : '15–20'}）`,
        detail: isShorts
          ? 'Shorts 標籤數量不需要像一般影片那麼多，但仍需至少 8 個才能讓演算法有效分類。'
          : '標籤數量不足會限制 YouTube 對影片主題的判斷粒度和搜尋關聯性。',
        fix: `現有：${data.tags.join(', ')}。增加更多長尾關鍵詞變體。`,
      });
      score -= 10;
    }

    // P1: First 150 chars analysis (skip for Shorts — descriptions are inherently short)
    if (descLength > 0 && !isShorts) {
      const first150 = data.description.trim().substring(0, 150);
      const isBoilerplate = /^\s*(影片|這部|歡迎|嗨|哈囉|hello|hi|大家好|哈摟)/i.test(first150);
      if (S.get('check_description_150') && isBoilerplate && first150.length < parseInt(S.get('thresh_boilerplate_max'), 10)) {
        issues.push({
          severity: 'P1', icon: '📝',
          title: '說明前 150 字被通用開場白佔用',
          detail: 'YouTube 搜尋結果只顯示說明前 ~150 字作為摘要。用「歡迎收看」開頭等於浪費這個黃金 SEO 位置。',
          fix: '前 150 字應直接陳述影片價值：核心關鍵詞 + 觀看理由。',
        });
        score -= 10;
      }

      const titleWords = data.title.split(/[\s,，、.。、:：!！?？]+/).filter(w => w.length > 1 && w.length < 20);
      const keywordInFirst150 = titleWords.some(w => first150.includes(w));
      if (S.get('check_description_150') && !keywordInFirst150 && titleWords.length > 0 && first150.length > 20) {
        issues.push({
          severity: 'P1', icon: '🔍',
          title: '標題關鍵詞未出現在說明前 150 字',
          detail: '說明開頭若包含標題關鍵詞，能強化 YouTube 對主題相關性的判斷。',
          fix: `確保以下詞彙出現在說明開頭：${titleWords.slice(0, 5).join('、')}。`,
        });
        score -= 10;
      }
    }

    // =============================================
    //  Thumbnail Vision Findings (P1–P2)
    // =============================================

    if (thumbResult) {
      if (S.get('check_thumbnail_resolution') && !thumbResult.isMaxRes) {
        issues.push({
          severity: 'P1', icon: '🖼',
          title: '縮圖非最高解析度（低於 1280px）',
          detail: 'YouTube 建議縮圖為 1280x720。低解析度縮圖在 Retina 螢幕上會模糊，降低專業感與點擊率。',
          fix: '上傳 1280x720 以上的 JPEG/PNG 縮圖。使用 maxresdefault 規格。',
        });
        score -= 10;
      }

      if (S.get('check_thumbnail_contrast') && thumbResult.contrast < parseInt(S.get('thresh_contrast_min'), 10) && thumbResult.contrast > 0) {
        issues.push({
          severity: 'P1', icon: '🎨',
          title: '縮圖對比度偏低',
          detail: '低對比度縮圖在 YouTube 的縮小顯示和手機螢幕上難以辨識，會降低 CTR。',
          fix: '增加縮圖的明暗對比。文字使用高對比顏色（白字 + 陰影或黑邊）。避免整體灰濛濛的色調。',
        });
        score -= 10;
      }

      if (S.get('check_thumbnail_brightness') && thumbResult.avgBrightness < parseInt(S.get('thresh_brightness_min'), 10) && thumbResult.avgBrightness > 0) {
        issues.push({
          severity: 'P2', icon: '🌑',
          title: '縮圖整體偏暗',
          detail: '過暗的縮圖在 YouTube 的深色主題和手機螢幕上容易「消失」，特別是在 scroll 過程中。',
          fix: '調亮縮圖，或加入亮色文字/圖示來提升視覺焦點。',
        });
        score -= 5;
      }

      if (S.get('check_thumbnail_text') && thumbResult.textLikelihood === 'high') {
        // Check for title-thumbnail redundancy
        const titleWords = data.title.split(/[\s,，、.。、:：!！?？/#]+/).filter(w => w.length > 1);
        // We can't OCR, but we can flag the general concern
        issues.push({
          severity: 'P2', icon: '🔤',
          title: '縮圖可能含有大量文字',
          detail: '縮圖文字若與標題內容重複，等於浪費兩種媒體各自的優勢：標題負責 SEO 關鍵詞，縮圖負責情緒鉤子。',
          fix: '檢查縮圖文字是否與標題重複。若是，移除縮圖文字或改用標題未涵蓋的情緒鉤子。分工原則：標題 = 搜尋關鍵詞，縮圖 = 情緒 + 視覺證明。',
        });
        score -= 5;
      } else if (S.get('check_thumbnail_text') && thumbResult.textLikelihood === 'medium') {
        issues.push({
          severity: 'P3', icon: '🔤',
          title: '縮圖可能含有文字（邊緣密度中等）',
          detail: '縮圖可能包含部分文字元素。若有文字，確保不與標題重複。',
          fix: '可選：若縮圖有文字，確認其作為標題的情緒補充而非重複。',
        });
        score -= 2;
      }

      if (S.get('check_thumbnail_custom') && thumbResult.isCustom === false) {
        issues.push({
          severity: 'P2', icon: '🤖',
          title: '縮圖為自動生成（非自訂）',
          detail: '使用 YouTube 自動產生的縮圖會讓影片在搜尋結果和推薦中缺乏辨識度，顯著降低 CTR。',
          fix: '上傳自訂縮圖，1280x720，包含品牌識別元素（顏色、字體、人臉）。',
        });
        score -= 8;
      }

      if (S.get('check_thumbnail_color') && thumbResult.dominantColors?.length <= 1 && thumbResult.dominantColors?.length > 0) {
        issues.push({
          severity: 'P3', icon: '🎨',
          title: '縮圖色彩單一',
          detail: '單一色調的縮圖在並排顯示時容易被淹沒。',
          fix: '加入對比色或亮色元素作為視覺焦點。',
        });
        score -= 2;
      }
    }

    // =============================================
    //  P2 — Moderate (only for non-Shorts)
    // =============================================

    if (S.get('check_title_length') && !isShorts && data.title.length > 0 && data.title.length < parseInt(S.get('thresh_cjk_max'), 10) / 2) {
      issues.push({
        severity: 'P2', icon: '📏',
        title: '標題過短',
        detail: '未充分利用 SEO 空間。描述性標題的點擊率通常更高。',
        fix: '加入更多描述性關鍵詞，目標 20–50 字。',
      });
      score -= 5;
    }

    if (descLength > 0) {
      const hashtagCount = (data.description.match(/#[\w\u4e00-\u9fff]+/g) || []).length;
      if (S.get('check_hashtag') && hashtagCount === 0) {
        issues.push({
          severity: isShorts ? 'P2' : 'P2', icon: '#️⃣',
          title: isShorts ? '說明中未使用 Hashtag（Shorts 必備）' : '說明中未使用 Hashtag',
          detail: isShorts
            ? 'Shorts 的 Hashtag 直接影響在 Shorts feed 中的曝光類別。建議在標題或說明中加入 2–3 個主題 hashtag。'
            : 'Hashtag 可增加影片在相關主題探索頁面的曝光。',
          fix: isShorts
            ? '在說明或標題中加入 2–3 個主題 hashtag，如 #旅遊 #攝影教學。'
            : '在說明底部加入 3–5 個相關 hashtag。',
        });
        score -= 5;
      }
    }

    if (S.get('check_description_150') && !isShorts && descLength > 0 && descLength < parseInt(S.get('thresh_desc_min'), 10)) {
      issues.push({
        severity: 'P2', icon: '📝',
        title: `說明文字偏短（${descLength} 字）`,
        detail: '200 字以上的說明明顯有更好的 SEO 表現。',
        fix: '擴充說明到 200 字以上：加入詳細內容描述、時間戳章節、相關連結。',
      });
      score -= 5;
    }

    // =============================================
    //  P3 — Suggestions
    // =============================================

    if (S.get('check_cta') && descLength > 0) {
      const hasCTA = /訂閱|subscribe|追蹤|按讚|like|留言|comment|分享|share/i.test(data.description);
      if (!hasCTA) {
        issues.push({
          severity: 'P3', icon: '💬',
          title: '說明中缺乏行動呼籲 (CTA)',
          detail: 'CTA 能提升互動率，互動信號會間接影響演算法推薦。',
          fix: isShorts
            ? '在說明加入：「你覺得呢？留言告訴我 💬」'
            : '在說明末尾加入：「覺得有幫助嗎？訂閱頻道並留言告訴我你的想法！」',
        });
        score -= 3;
      }
    }

    if (S.get('check_seo_block') && !isShorts && descLength > 100) {
      const hasSEOBlock = /關鍵[字詞]|seo|keywords|tags|search|搜尋/i.test(data.description);
      if (!hasSEOBlock) {
        issues.push({
          severity: 'P3', icon: '🔑',
          title: '缺少 SEO 關鍵詞區塊',
          detail: '在說明底部新增純 SEO 關鍵詞區塊是常見優化手法。',
          fix: '在說明最底部新增一行僅包含關鍵詞的文字。',
        });
        score -= 2;
      }
    }

    if (S.get('check_search_intent') && !isShorts) {
      const titleHasDelimiter = /[|｜—–\-–—]/g.test(data.title);
      if (titleHasDelimiter && cjkChars.length > 20) {
        issues.push({
          severity: 'P3', icon: '🎯',
          title: '標題可能涵蓋多主題（搜尋意圖模糊）',
          detail: '使用分隔符可能表示標題涵蓋多個主題，影響演算法的推薦判斷。',
          fix: '確保主要搜尋關鍵詞只對應一個核心主題。',
        });
        score -= 2;
      }
    }

    // Shorts-specific: description length expectation
    if (S.get('check_description_150') && isShorts && descLength > 0 && descLength < 50) {
      issues.push({
        severity: 'P3', icon: '📝',
        title: 'Shorts 說明有改善空間',
        detail: '雖然 Shorts 說明不需像一般影片那麼長，但 50 字以上的說明能包含更多關鍵詞和 CTA。',
        fix: '將說明撰寫至 50–150 字，包含主題描述 + hashtag + CTA。',
      });
      score -= 2;
    }

    // =============================================
    //  Confirmed good practices
    // =============================================
    const goodPractices = [];

    if (!hasNoTags && data.tags.length >= (isShorts ? 8 : 15)) {
      goodPractices.push(`標籤數量充足（${data.tags.length} 個）`);
    }
    if (cjkChars.length <= 30 && data.title.length > 0) {
      goodPractices.push('標題長度符合行動裝置顯示範圍');
    }
    if (descLength > 200 && !isShorts) {
      goodPractices.push(`說明長度充足（${descLength} 字）`);
    }
    if (descLength > 0) {
      const hc = (data.description.match(/#[\w\u4e00-\u9fff]+/g) || []).length;
      if (hc > 0) goodPractices.push('使用了 Hashtag');
      if (/訂閱|subscribe/i.test(data.description)) goodPractices.push('包含訂閱 CTA');
    }
    if (thumbResult?.isMaxRes) goodPractices.push('縮圖為最高解析度');
    if (thumbResult?.isCustom) goodPractices.push('使用自訂縮圖');
    if (thumbResult && thumbResult.contrast >= 40) goodPractices.push('縮圖對比度良好');

    // Merge transcript findings
    if (transcriptFindings?.issues?.length) {
      for (const tf of transcriptFindings.issues) {
        issues.push(tf);
        const sevPenalty = { P0: 15, P1: 10, P2: 5, P3: 2 };
        score -= sevPenalty[tf.severity] || 3;
      }
    }
    if (transcriptFindings?.info) {
      const ti = transcriptFindings.info;
      if (ti.titleKwCoverage >= 50) goodPractices.push(`前 30 秒關鍵詞覆蓋率 ${ti.titleKwCoverage}%`);
      if (ti.wpm >= 100 && ti.wpm <= 200) goodPractices.push(`口語節奏適中（~${ti.wpm} wpm）`);
      if (ti.hasVerbalCTA) goodPractices.push('結尾含口語 CTA');
      if (!ti.isAuto) goodPractices.push('使用手動字幕（非 ASR）');
    }

    score = Math.max(0, Math.min(100, score));

    return { score, issues, goodPractices, transcriptInfo: transcriptFindings?.info || null };
  }

  // ======================== UI — PANEL (component helpers) ========================

  function renderHeader(isShorts) {
    return `<div class="ytseo-header">
      <h2 class="ytseo-title">${isShorts ? '🔲 Shorts' : '🎬'} SEO 分析</h2>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="ytseo-export-btn" id="ytseo-export" title="匯出 Markdown 報告">↓</button>
        <button class="ytseo-close" id="ytseo-close">&times;</button>
      </div>
    </div>`;
  }

  function renderScoreSection(score, tagsCount, descLength, isShorts) {
    const cls = score >= 80 ? 'good' : score >= 60 ? 'ok' : 'bad';
    const label = score >= 80 ? '表現不錯' : score >= 60 ? '有改善空間' : '需要大幅度優化';
    return `<div class="ytseo-score-bar">
      <div class="ytseo-score-circle ${cls}">
        <span class="ytseo-score-num">${score}</span>
        <span class="ytseo-score-label">/100</span>
      </div>
      <div class="ytseo-score-text">
        ${label}
        <span class="ytseo-score-sub">${tagsCount} 個標籤 · ${descLength} 字說明${isShorts ? ' · Shorts模式' : ''}</span>
      </div>
    </div>`;
  }

  function renderThumbnailSection(tr) {
    if (!tr) return '';
    const textLabel = tr.textLikelihood === 'high' ? '🟠可能' : tr.textLikelihood === 'medium' ? '🟡可能有' : '🟢無/很少';
    const dots = tr.dominantColors?.length > 0
      ? `<span class="ytseo-thumb-colors">${tr.dominantColors.map(c => `<span class="ytseo-color-dot" style="background:${escapeHtml(c.rgb)}" title="${escapeHtml(c.hex)} ${c.pct}%"></span>`).join('')}</span>`
      : '';
    return `<div class="ytseo-thumb-section">
      <img class="ytseo-thumb-img" src="${tr.thumbnailUrl}" alt="Thumbnail" crossorigin="anonymous" />
      <div class="ytseo-thumb-stats">
        <span class="ytseo-thumb-stat">${tr.width}x${tr.height}</span>
        <span class="ytseo-thumb-stat">${tr.isMaxRes ? '高解析' : '標準'}</span>
        <span class="ytseo-thumb-stat">亮度 ${tr.avgBrightness}</span>
        <span class="ytseo-thumb-stat">對比 ${tr.contrast}</span>
        <span class="ytseo-thumb-stat">文字 ${textLabel}</span>
        ${dots}
      </div>
    </div>`;
  }

  function renderTranscriptSection(ti) {
    if (!ti) return '';
    return `<div class="ytseo-thumb-section ytseo-transcript-section">
      <div class="ytseo-thumb-stats">
        <span class="ytseo-thumb-stat">${ti.isAuto ? '🤖 ASR' : '📝 手動字幕'}</span>
        <span class="ytseo-thumb-stat">${escapeHtml(ti.language)}</span>
        <span class="ytseo-thumb-stat">${ti.wordCount} 字</span>
        <span class="ytseo-thumb-stat">${ti.wpm} wpm</span>
        <span class="ytseo-thumb-stat">${ti.segmentsCount} 段落</span>
        <span class="ytseo-thumb-stat">前30s關鍵詞 ${ti.titleKwCoverage}%</span>
      </div>
    </div>`;
  }

  function renderMetaSection(data, durationStr, viewStr, descLength) {
    const tagsHtml = data.tags?.length > 0
      ? `<div class="ytseo-meta-row ytseo-tags-row">
          <span class="ytseo-meta-label">標籤</span>
          <span class="ytseo-meta-val ytseo-tags">${data.tags.slice(0, 20).map(t => `<span class="ytseo-tag">${escapeHtml(t)}</span>`).join('')}</span>
        </div>`
      : '';
    return `<div class="ytseo-meta">
      <div class="ytseo-meta-row"><span class="ytseo-meta-label">頻道</span><span class="ytseo-meta-val">${escapeHtml(data.channelName) || '—'}</span></div>
      <div class="ytseo-meta-row"><span class="ytseo-meta-label">標題</span><span class="ytseo-meta-val">${escapeHtml(data.title) || '—'}</span></div>
      <div class="ytseo-meta-row"><span class="ytseo-meta-label">長度</span><span class="ytseo-meta-val">${durationStr}</span></div>
      <div class="ytseo-meta-row"><span class="ytseo-meta-label">觀看</span><span class="ytseo-meta-val">${viewStr}</span></div>
      <div class="ytseo-meta-row"><span class="ytseo-meta-label">標籤數</span><span class="ytseo-meta-val">${data.tags?.length || 0}</span></div>
      <div class="ytseo-meta-row"><span class="ytseo-meta-label">說明長度</span><span class="ytseo-meta-val">${descLength} 字</span></div>
      ${tagsHtml}
    </div>`;
  }

  function renderGoodPractices(items) {
    if (!items?.length) return '';
    return `<div class="ytseo-section">
      <h3 class="ytseo-section-title">✅ 表現良好的項目</h3>
      <ul class="ytseo-good-list">${items.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
    </div>`;
  }

  function renderIssuesSection(issues, icons) {
    if (!issues?.length) {
      return '<div class="ytseo-section"><h3 class="ytseo-section-title">⚠️ 待優化項目</h3><p class="ytseo-empty">沒有發現明顯問題！這支影片的 SEO 設定很完整。</p></div>';
    }
    return `<div class="ytseo-section">
      <h3 class="ytseo-section-title">⚠️ 待優化項目</h3>
      ${issues.map(issue => `
      <div class="ytseo-issue ytseo-sev-${issue.severity.toLowerCase()}">
        <div class="ytseo-issue-head">
          <span class="ytseo-sev-badge ${issue.severity.toLowerCase()}">${icons[issue.severity] || ''} ${issue.severity}</span>
          <span class="ytseo-issue-title">${issue.icon} ${escapeHtml(issue.title)}</span>
        </div>
        <div class="ytseo-issue-detail">${escapeHtml(issue.detail)}</div>
        <div class="ytseo-issue-fix">
          <span class="ytseo-fix-label">💡 建議：</span>${escapeHtml(issue.fix)}
        </div>
      </div>`).join('')}
    </div>`;
  }

  function renderPriorityGuide() {
    return `<div class="ytseo-priority-guide">
      <h3 class="ytseo-section-title">📋 優先級說明</h3>
      <div class="ytseo-guide-row"><span class="ytseo-sev-badge p0">🔴 P0</span> 嚴重 — 立即處理，影響搜尋曝光</div>
      <div class="ytseo-guide-row"><span class="ytseo-sev-badge p1">🟠 P1</span> 重要 — 下次上片前優化</div>
      <div class="ytseo-guide-row"><span class="ytseo-sev-badge p2">🟡 P2</span> 中等 — 有時間再改進</div>
      <div class="ytseo-guide-row"><span class="ytseo-sev-badge p3">⚪ P3</span> 建議 — 長期持續優化項目</div>
    </div>`;
  }

  function renderFooter() {
    return '<div class="ytseo-footer">YouTube SEO 分析器 v1.9 &mdash; 縮圖分析為 Canvas 像素估算，逐字稿取自頁面字幕</div>';
  }

  function createSEOInfo(data, analysis, thumbResult, transcriptInfo) {
    const durationStr = data.duration > 0
      ? (() => {
          const h = Math.floor(data.duration / 3600);
          const m = Math.floor((data.duration % 3600) / 60);
          const s = data.duration % 60;
          if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          return `${m}:${String(s).padStart(2, '0')}`;
        })()
      : '—';
    const viewStr = data.viewCount > 0 ? data.viewCount.toLocaleString() : '—';
    const severityIcons = { P0: '🔴', P1: '🟠', P2: '🟡', P3: '⚪' };
    const descLength = data._descLength != null ? data._descLength : (data.description ? data.description.trim().length : 0);

    return `<div class="ytseo-panel">
      ${renderHeader(data.isShorts)}
      ${renderScoreSection(analysis.score, data.tags?.length || 0, descLength, data.isShorts)}
      ${renderThumbnailSection(thumbResult)}
      ${renderTranscriptSection(transcriptInfo)}
      ${renderMetaSection(data, durationStr, viewStr, descLength)}
      ${renderGoodPractices(analysis.goodPractices)}
      ${renderIssuesSection(analysis.issues, severityIcons)}
      ${renderPriorityGuide()}
      ${renderFooter()}
    </div>`;
  }

  // ======================== EXPORT MARKDOWN ========================

  function exportToMarkdown(data, analysis, thumbResult, transcriptInfo) {
    const isShorts = data.isShorts;
    const parts = [];

    // Header
    parts.push(`# ${isShorts ? '🔲 Shorts' : '🎬'} SEO 分析報告`);
    parts.push(`> 產生日期：${new Date().toISOString().split('T')[0]}`);
    parts.push(`> 影片 ID：\`${data.videoId || 'N/A'}\``);
    parts.push('');

    // Score
    const scoreLabel = analysis.score >= 80 ? '🟢 良好' : analysis.score >= 60 ? '🟡 普通' : '🔴 待改進';
    parts.push(`## ✅ 綜合評分：**${analysis.score}/100** — ${scoreLabel}`);
    parts.push('');

    // Metadata
    parts.push('## 📋 影片資訊');
    parts.push('');
    parts.push(`| 欄位 | 值 |`);
    parts.push(`|------|-----|`);
    parts.push(`| 標題 | ${data.title || '—'} |`);
    parts.push(`| 頻道 | ${data.channelName || '—'} |`);
    const dur = data.duration > 0
      ? (() => { const h = Math.floor(data.duration / 3600); const m = Math.floor((data.duration % 3600) / 60); const s = data.duration % 60; return h > 0 ? `${h}h${m}m${s}s` : `${m}m${s}s`; })()
      : '—';
    parts.push(`| 長度 | ${dur} |`);
    parts.push(`| 觀看 | ${data.viewCount > 0 ? data.viewCount.toLocaleString() : '—'} |`);
    parts.push(`| 標籤數 | ${data.tags?.length || 0} |`);
    parts.push(`| 說明長度 | ${data.description ? data.description.trim().length : 0} 字 |`);
    parts.push('');

    // Tags
    if (data.tags?.length > 0) {
      parts.push('**標籤：** `' + data.tags.join('`, `') + '`');
      parts.push('');
    }

    // Thumbnail Analysis
    if (thumbResult) {
      parts.push('## 🖼 縮圖分析');
      parts.push('');
      parts.push(`| 項目 | 數據 |`);
      parts.push(`|------|------|`);
      parts.push(`| 解析度 | ${thumbResult.width}x${thumbResult.height} |`);
      parts.push(`| 最高解析 | ${thumbResult.isMaxRes ? '是' : '否'} |`);
      parts.push(`| 自訂縮圖 | ${thumbResult.isCustom ? '是' : '否（自動生成）'} |`);
      parts.push(`| 平均亮度 | ${thumbResult.avgBrightness} / 255 |`);
      parts.push(`| 對比度 | ${thumbResult.contrast} |`);
      parts.push(`| 文字機率 | ${thumbResult.textLikelihood} |`);
      if (thumbResult.dominantColors?.length) {
        const colors = thumbResult.dominantColors.map(c => `${c.hex} (${c.pct}%)`).join(', ');
        parts.push(`| 主色調 | ${colors} |`);
      }
      parts.push('');
    }

    // Transcript Info
    if (transcriptInfo) {
      parts.push('## 🎙 逐字稿分析');
      parts.push('');
      parts.push(`| 項目 | 數據 |`);
      parts.push(`|------|------|`);
      parts.push(`| 語言 | ${transcriptInfo.language} |`);
      parts.push(`| 類型 | ${transcriptInfo.isAuto ? '自動產生 (ASR)' : '手動字幕'} |`);
      parts.push(`| 總字數 | ${transcriptInfo.wordCount} |`);
      parts.push(`| 口語密度 | ${transcriptInfo.wpm} wpm |`);
      parts.push(`| 段落數 | ${transcriptInfo.segmentsCount} |`);
      parts.push(`| 前30s關鍵詞覆蓋 | ${transcriptInfo.titleKwCoverage}% |`);
      parts.push('');
    }

    // Good Practices
    if (analysis.goodPractices?.length > 0) {
      parts.push('## ✅ 表現良好的項目');
      parts.push('');
      analysis.goodPractices.forEach(p => parts.push(`- ${p}`));
      parts.push('');
    }

    // Issues
    if (analysis.issues?.length > 0) {
      parts.push('## ⚠️ 待優化項目');
      parts.push('');
      analysis.issues.forEach((issue, i) => {
        const sevIcon = { P0: '🔴', P1: '🟠', P2: '🟡', P3: '⚪' }[issue.severity] || '⚪';
        parts.push(`### ${i + 1}. ${sevIcon} [${issue.severity}] ${issue.icon} ${issue.title}`);
        parts.push('');
        parts.push(issue.detail);
        parts.push('');
        parts.push(`> 💡 **建議：** ${issue.fix}`);
        parts.push('');
      });
    }

    parts.push('---');
    parts.push('*報告由 YouTube SEO 分析器 v1.4 產生*');

    return parts.join('\n');
  }

  function triggerDownload(markdown, filename) {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function injectPanel(data, analysis, thumbResult, transcriptInfo) {
    const existing = document.querySelector('.ytseo-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ytseo-overlay';
    overlay.innerHTML = createSEOInfo(data, analysis, thumbResult, transcriptInfo);

    document.body.appendChild(overlay);

    document.getElementById('ytseo-close').addEventListener('click', () => {
      overlay.classList.remove('ytseo-open');
      setTimeout(() => overlay.remove(), 300);
    });

    document.getElementById('ytseo-export').addEventListener('click', () => {
      const date = new Date().toISOString().split('T')[0];
      const titleSlug = (data.title || 'video').replace(/[\s<>:"/\\|?*]+/g, '_').substring(0, 40);
      const filename = `SEO分析_${titleSlug}_${date}.md`;
      const md = exportToMarkdown(data, analysis, thumbResult, transcriptInfo);
      triggerDownload(md, filename);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('ytseo-open');
        setTimeout(() => overlay.remove(), 300);
      }
    });

    requestAnimationFrame(() => overlay.classList.add('ytseo-open'));
    panelOpen = true;
  }

  function injectButton() {
    if (document.querySelector('.ytseo-fab')) return;

    const btn = document.createElement('button');
    btn.className = 'ytseo-fab';
    btn.title = 'SEO 分析';
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    `;
    btn.addEventListener('click', doAnalysis);
    document.body.appendChild(btn);
    btn.classList.add('ytseo-visible');
  }

  // ======================== ANALYSIS TRIGGER ========================

  async function doAnalysis() {
    const data = extractVideoData();
    currentData = data;

    // Run thumbnail analysis AND transcript fetch in parallel
    const thumbPromise = analyzeThumbnail(data);
    const transcriptPromise = fetchTranscript(data);

    // Start UI immediately with a loading state
    const overlay = document.createElement('div');
    overlay.className = 'ytseo-overlay';
    overlay.innerHTML = `
      <div class="ytseo-panel">
        <div class="ytseo-header">
          <h2 class="ytseo-title">SEO 分析中...</h2>
          <button class="ytseo-close" id="ytseo-close-loading">&times;</button>
        </div>
        <div class="ytseo-section" style="text-align:center;padding:60px 24px;color:#888;">
          <div style="font-size:32px;margin-bottom:16px;">⏳</div>
          <div>正在分析影片資料、縮圖與逐字稿...</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('ytseo-open'));

    document.getElementById('ytseo-close-loading')?.addEventListener('click', () => {
      overlay.classList.remove('ytseo-open');
      setTimeout(() => overlay.remove(), 300);
      panelOpen = false;
      return;
    });

    // Wait for both
    const [thumbResult, transcript] = await Promise.all([thumbPromise, transcriptPromise]);
    const transcriptAnalysis = transcript ? analyzeTranscript(transcript, data) : { issues: [], info: null };

    // Replace with real results
    const analysis = analyzeVideo(data, thumbResult, transcriptAnalysis);
    overlay.classList.remove('ytseo-open');
    setTimeout(() => {
      overlay.remove();
      injectPanel(data, analysis, thumbResult, transcriptAnalysis.info);
    }, 200);

    console.log('[YT SEO] Analysis:', { data, analysis, thumbResult });
  }

  // ======================== KEYBOARD ========================

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelOpen) {
      const overlay = document.querySelector('.ytseo-overlay');
      if (overlay) {
        overlay.classList.remove('ytseo-open');
        setTimeout(() => overlay.remove(), 300);
        panelOpen = false;
      }
    }
  });

  // ======================== INIT ========================

  function cleanupExtension() {
    const old = document.querySelector('.ytseo-fab');
    if (old) old.remove();
    const oldPanel = document.querySelector('.ytseo-overlay');
    if (oldPanel) oldPanel.remove();
    panelOpen = false;
  }

  function initExtension() {
    cleanupExtension();
    if (!isWatchPage() && !isShortsPage()) return;
    // Ensure settings are loaded before showing button
    if (window.YTSEO_SETTINGS && window.YTSEO_SETTINGS.loadSync) {
      window.YTSEO_SETTINGS.loadSync().then(() => {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => injectButton());
        } else {
          setTimeout(injectButton, 1500);
        }
      });
    } else {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => injectButton());
      } else {
        setTimeout(injectButton, 1500);
      }
    }
  }

  document.addEventListener('yt-navigate-finish', initExtension);

  if (document.readyState === 'complete') {
    initExtension();
  } else {
    window.addEventListener('load', initExtension);
  }
})();
