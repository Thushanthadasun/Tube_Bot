chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    preferences: {
      blockedCategories: [],
      blockedKeywords: [],
      blockedChannels: [],
    }
  });
});
