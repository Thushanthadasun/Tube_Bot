document.getElementById("open-yt").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.youtube.com" });
});

chrome.storage.local.get("preferences", (result) => {
  const prefs = result.preferences || { blockedCategories: [], blockedKeywords: [], blockedChannels: [] };
  const container = document.getElementById("blocked-list");

  const all = [
    ...(prefs.blockedCategories || []).map(c => ({ label: c, type: "category" })),
    ...(prefs.blockedKeywords || []).map(k => ({ label: k, type: "keyword" })),
    ...(prefs.blockedChannels || []).map(c => ({ label: c, type: "channel" })),
  ];

  if (all.length === 0) return;

  container.innerHTML = all.map(b =>
    `<span class="chip">${b.label}<button class="chip-remove" data-label="${b.label}" data-type="${b.type}">×</button></span>`
  ).join("");

  container.querySelectorAll(".chip-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      const label = btn.dataset.label;
      const type = btn.dataset.type;
      const newPrefs = {
        blockedCategories: type === "category" ? prefs.blockedCategories.filter(c => c !== label) : prefs.blockedCategories,
        blockedKeywords: type === "keyword" ? prefs.blockedKeywords.filter(k => k !== label) : prefs.blockedKeywords,
        blockedChannels: type === "channel" ? prefs.blockedChannels.filter(c => c !== label) : prefs.blockedChannels,
      };
      chrome.storage.local.set({ preferences: newPrefs }, () => location.reload());
    });
  });
});
