// YouTube SEO 分析器 — Service Worker
// Handles toolbar icon click → opens options page

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
