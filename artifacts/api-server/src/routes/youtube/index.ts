import { Router } from "express";
import { db } from "@workspace/db";
import { youtubePreferencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "../../lib/ai";
import { logger } from "../../lib/logger";

const router = Router();

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

const CATEGORY_MAP: Record<string, string> = {
  music: "10",
  gaming: "20",
  news: "25",
  sports: "17",
  comedy: "23",
  education: "27",
  science: "28",
  technology: "28",
  entertainment: "24",
  film: "1",
  travel: "19",
  pets: "15",
  howto: "26",
};

async function getOrCreatePreferences(): Promise<typeof youtubePreferencesTable.$inferSelect> {
  const prefs = await db.select().from(youtubePreferencesTable).limit(1);
  if (prefs.length > 0) return prefs[0];
  const [created] = await db
    .insert(youtubePreferencesTable)
    .values({
      blockedCategories: [],
      blockedKeywords: [],
      blockedChannels: [],
    })
    .returning();
  return created;
}

function isVideoBlocked(
  video: {
    title: string;
    channelTitle: string;
    categoryId?: string;
  },
  prefs: typeof youtubePreferencesTable.$inferSelect
): boolean {
  const titleLower = video.title.toLowerCase();
  const channelLower = video.channelTitle.toLowerCase();

  for (const keyword of prefs.blockedKeywords) {
    if (titleLower.includes(keyword.toLowerCase())) return true;
  }

  for (const channel of prefs.blockedChannels) {
    if (channelLower.includes(channel.toLowerCase())) return true;
  }

  if (video.categoryId) {
    for (const cat of prefs.blockedCategories) {
      const catId = CATEGORY_MAP[cat.toLowerCase()];
      if (catId && video.categoryId === catId) return true;
    }
  }

  return false;
}

async function fetchYoutubeVideos(
  query: string,
  maxResults = 20
): Promise<
  Array<{
    videoId: string;
    title: string;
    description: string;
    thumbnailUrl: string;
    channelTitle: string;
    publishedAt: string;
    viewCount: string;
    duration: string;
    categoryId: string;
  }>
> {
  if (!YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY not set");
  }

  const searchUrl = `${YOUTUBE_API_BASE}/search?part=snippet&type=video&q=${encodeURIComponent(query)}&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    throw new Error(`YouTube search failed: ${searchRes.statusText}`);
  }
  const searchData = (await searchRes.json()) as {
    items: Array<{
      id: { videoId: string };
      snippet: {
        title: string;
        description: string;
        thumbnails: { medium?: { url: string }; default?: { url: string } };
        channelTitle: string;
        publishedAt: string;
      };
    }>;
  };

  const videoIds = (searchData.items || [])
    .map((item) => item.id.videoId)
    .join(",");
  if (!videoIds) return [];

  const detailsUrl = `${YOUTUBE_API_BASE}/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`;
  const detailsRes = await fetch(detailsUrl);
  const detailsData = (await detailsRes.json()) as {
    items: Array<{
      id: string;
      snippet: {
        title: string;
        description: string;
        thumbnails: { medium?: { url: string }; default?: { url: string } };
        channelTitle: string;
        publishedAt: string;
        categoryId: string;
      };
      statistics: { viewCount?: string };
      contentDetails: { duration: string };
    }>;
  };

  return (detailsData.items || []).map((item) => ({
    videoId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    thumbnailUrl:
      item.snippet.thumbnails?.medium?.url ||
      item.snippet.thumbnails?.default?.url ||
      "",
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    viewCount: item.statistics?.viewCount || "0",
    duration: item.contentDetails?.duration || "",
    categoryId: item.snippet.categoryId || "",
  }));
}

async function fetchTrendingVideos(): Promise<
  Array<{
    videoId: string;
    title: string;
    description: string;
    thumbnailUrl: string;
    channelTitle: string;
    publishedAt: string;
    viewCount: string;
    duration: string;
    categoryId: string;
  }>
> {
  if (!YOUTUBE_API_KEY) {
    throw new Error("YOUTUBE_API_KEY not set");
  }

  const url = `${YOUTUBE_API_BASE}/videos?part=snippet,statistics,contentDetails&chart=mostPopular&regionCode=US&maxResults=24&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`YouTube trending failed: ${res.statusText}`);
  }
  const data = (await res.json()) as {
    items: Array<{
      id: string;
      snippet: {
        title: string;
        description: string;
        thumbnails: { medium?: { url: string }; default?: { url: string } };
        channelTitle: string;
        publishedAt: string;
        categoryId: string;
      };
      statistics: { viewCount?: string };
      contentDetails: { duration: string };
    }>;
  };

  return (data.items || []).map((item) => ({
    videoId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    thumbnailUrl:
      item.snippet.thumbnails?.medium?.url ||
      item.snippet.thumbnails?.default?.url ||
      "",
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    viewCount: item.statistics?.viewCount || "0",
    duration: item.contentDetails?.duration || "",
    categoryId: item.snippet.categoryId || "",
  }));
}

router.get("/search", async (req, res) => {
  const q = req.query.q as string;
  if (!q) {
    res.status(400).json({ error: "Query parameter q is required" });
    return;
  }

  try {
    const prefs = await getOrCreatePreferences();
    const videos = await fetchYoutubeVideos(q, 20);
    const filtered = videos.filter((v) => !isVideoBlocked(v, prefs));
    res.json(filtered);
  } catch (err) {
    req.log.error({ err }, "YouTube search error");
    if (!YOUTUBE_API_KEY) {
      res.json([]);
      return;
    }
    res.status(500).json({ error: "Failed to search YouTube" });
  }
});

router.get("/homepage", async (_req, res) => {
  try {
    const prefs = await getOrCreatePreferences();
    const videos = await fetchTrendingVideos();
    const filtered = videos.filter((v) => !isVideoBlocked(v, prefs));
    res.json(filtered);
  } catch (err) {
    logger.error({ err }, "YouTube homepage error");
    if (!YOUTUBE_API_KEY) {
      res.json([]);
      return;
    }
    res.status(500).json({ error: "Failed to fetch homepage videos" });
  }
});

router.get("/preferences", async (_req, res) => {
  try {
    const prefs = await getOrCreatePreferences();
    res.json({
      id: prefs.id,
      blockedCategories: prefs.blockedCategories,
      blockedKeywords: prefs.blockedKeywords,
      blockedChannels: prefs.blockedChannels,
      updatedAt: prefs.updatedAt,
    });
  } catch (err) {
    logger.error({ err }, "Get preferences error");
    res.status(500).json({ error: "Failed to get preferences" });
  }
});

router.post("/preferences", async (req, res) => {
  try {
    const { blockedCategories, blockedKeywords, blockedChannels } = req.body as {
      blockedCategories?: string[];
      blockedKeywords?: string[];
      blockedChannels?: string[];
    };

    const prefs = await getOrCreatePreferences();

    const [updated] = await db
      .update(youtubePreferencesTable)
      .set({
        ...(blockedCategories !== undefined && { blockedCategories }),
        ...(blockedKeywords !== undefined && { blockedKeywords }),
        ...(blockedChannels !== undefined && { blockedChannels }),
        updatedAt: new Date(),
      })
      .where(eq(youtubePreferencesTable.id, prefs.id))
      .returning();

    res.json({
      id: updated.id,
      blockedCategories: updated.blockedCategories,
      blockedKeywords: updated.blockedKeywords,
      blockedChannels: updated.blockedChannels,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    logger.error({ err }, "Update preferences error");
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

// ─── Auto-interest extraction ─────────────────────────────────────────────────
// Takes the user's YouTube search history + chat history → returns smart video queries
router.post("/auto-interests", async (req, res) => {
  const { chatHistory, recentSearches } = req.body as {
    chatHistory?: Array<{ role: string; content: string }>;
    recentSearches?: string[];
  };

  const hasData = (recentSearches?.length || 0) + (chatHistory?.filter(m => m.role === "user").length || 0);
  if (!hasData) { res.json({ queries: [] }); return; }

  const userMsgs = (chatHistory || [])
    .filter(m => m.role === "user")
    .slice(-20)
    .map(m => m.content)
    .join(" | ");

  const searchHistory = (recentSearches || []).slice(0, 15).join(", ");

  const prompt = `You are a YouTube recommendation engine. Based on the user's activity below, extract 3-5 specific YouTube search queries they would enjoy watching.

YouTube search history: ${searchHistory || "none"}
Chat messages: ${userMsgs || "none"}

Rules:
- Skip any messages about blocking/filtering/hiding content
- Extract actual topics of interest (tutorials, creators, genres, topics)
- Make queries specific and searchable (e.g. "python django tutorial 2024" not just "coding")
- Return ONLY a valid JSON array of strings, nothing else

Example output: ["beginner cooking recipes", "lo-fi hip hop study music", "javascript tips for beginners"]`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 200,
    });
    const text = completion.choices[0]?.message?.content?.trim() || "[]";
    const startIdx = text.indexOf("[");
    const endIdx = text.lastIndexOf("]");
    if (startIdx === -1 || endIdx === -1) { res.json({ queries: recentSearches?.slice(0, 3) || [] }); return; }
    const queries = JSON.parse(text.slice(startIdx, endIdx + 1));
    res.json({ queries: Array.isArray(queries) ? queries.slice(0, 5) : [] });
  } catch (err) {
    logger.error({ err }, "auto-interests AI error");
    res.json({ queries: recentSearches?.slice(0, 3) || [] });
  }
});

// Simple video search endpoint used by the extension to fetch interest videos
router.get("/search", async (req, res) => {
  const q   = (req.query.q as string || "").trim();
  const max = Math.min(parseInt(req.query.max as string || "8", 10), 20);
  if (!q) { res.json([]); return; }
  try {
    const videos = await fetchYoutubeVideos(q, max);
    res.json(videos);
  } catch (err) {
    req.log.error({ err }, "YouTube search endpoint error");
    res.json([]);
  }
});

const YOUTUBE_SYSTEM_PROMPT = `You are TubeChat AI — a friendly AI assistant built right into YouTube. You help people control what they see on their feed and find videos they'd love.

You're smart, warm, and practical. You get to the point. You never give long lectures — just clear, helpful answers.

== WHAT YOU CAN DO ==

1. FILTER THE FEED — hide content the user doesn't want to see
2. SEARCH YOUTUBE — find specific videos
3. CHAT — answer questions conversationally

== HOW TO TELL THEM APART ==

- "block music / hide gaming / no more news" → FILTER (update_preferences)
- "find X / show me videos about X / search for X" → SEARCH (shows in chat only)
- "show me X on my homepage / pin X to my feed / I always want to see X" → set_interests (saves + injects in feed)
- "remove X from my homepage / stop showing X in my feed" → remove_interest
- "clear my interests / remove all pinned" → clear_interests
- "hi / thanks / what can you do / help" → CHAT (action: chat)
- "what am I blocking / show my filters / what's active" → show_preferences
- "remove my music block / stop blocking gaming" → remove_preferences
- "show me only tech / I want cooking videos" → set_preferred
- "show everything / clear all / stop filtering" → clear_preferred

== WHEN BLOCKING CONTENT ==

Think BROADLY. The user says "block music" — they mean ALL of it:
- Songs, official music videos, lyric videos, audio-only, visualizers
- Covers, remixes, acoustic versions, karaoke, instrumentals
- Lofi beats, EDM, hip hop videos, piano covers, guitar covers
- A cappella, mashups, parody songs, live concert performances
- Music reactions, song reviews, album reviews
- Soundtracks, OSTs, theme songs
- Vevo channels, "- Topic" auto-channels, music label channels

Use blockedKeywords with 20-35 keywords (ALL real YouTube title patterns) + blockedCategories.

More examples:
- "block gaming" → gameplay, let's play, walkthrough, playthrough, speedrun, game review, game tier list, esports, gaming highlights, game news, gaming vlog, gaming setup, reaction to gameplay, gaming challenge
- "block news" → breaking news, politics, election, current events, journalism, news analysis, political debate, press conference, world news, daily news, news update
- "block shorts / remove shorts" → blockedCategories: ["shorts"], keywords: ["shorts", "#shorts", "short video", "youtube shorts", "vertical video", "60 seconds", "under a minute"]
- "block movie reviews" → film review, movie review, cinema review, movie breakdown, movie reaction, film analysis, "is it worth watching", movie ranking, movie tier list, movie recap, film critique, movie explained

== PREFERRED CONTENT ("show me only X" / "I want more X on my feed") ==

- "show me only cooking / I like tech / I want fitness content" → set_preferred
- "everything / show all / stop the filter / clear preferred" → clear_preferred
- set_preferred hides everything NOT matching the preferred type, so only preferred shows up

== RESPONSE STYLE ==

- Be warm and direct. No filler. No "Great question!" 
- Keep it short — 1-3 sentences max before the action JSON.
- If blocking: briefly confirm what you're doing in plain words, then the JSON.
- If searching: brief acknowledgment, then the JSON.
- If chatting: be friendly and human.

== ALWAYS PUT THE JSON ON THE LAST LINE ==

For blocking:        {"action": "update_preferences", "blockedCategories": ["music"], "blockedKeywords": ["music video", "official audio", "lyric video", "cover", "remix", ...20+ more]}
For removing:        {"action": "remove_preferences", "unblockCategories": ["music"], "unblockKeywords": ["music video", "official audio"]}
For searching:       {"action": "search", "query": "the exact search query"}
For show list:       {"action": "show_preferences"}
For preferred:       {"action": "set_preferred", "preferredCategories": ["cooking"]}
For clear pref:      {"action": "clear_preferred"}
For pin to homepage: {"action": "set_interests", "interests": ["cooking"], "searchQueries": ["best cooking tutorials for beginners 2024"]}
For remove interest: {"action": "remove_interest", "interest": "cooking"}
For clear interests: {"action": "clear_interests"}
For chat only:       {"action": "chat"}

INTERESTS vs PREFERRED:
- set_interests = ADD specific topics to the top of the homepage feed (doesn't hide anything)
- set_preferred = show ONLY that type, hide everything else (aggressive filter)
- Use set_interests when user says "show me X on my homepage", "pin X", "I always want to see X"
- Use set_preferred when user says "I only want X", "show me nothing but X"

IMPORTANT: In set_interests, "searchQueries" must be specific, high-quality YouTube search terms derived directly from what the user asked for. If user says "show cooking videos", make it "best cooking tutorials" not just "cooking". Always include searchQueries.

The JSON must always be the LAST line. Everything before it is your friendly reply.`;

router.post("/chat", async (req, res) => {
  const { message, history } = req.body as {
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const prefs = await getOrCreatePreferences();

    const contextMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content:
          YOUTUBE_SYSTEM_PROMPT +
          `\n\nCurrent user preferences:\n- Blocked categories: ${prefs.blockedCategories.length > 0 ? prefs.blockedCategories.join(", ") : "none"}\n- Blocked keywords: ${prefs.blockedKeywords.length > 0 ? prefs.blockedKeywords.join(", ") : "none"}\n- Blocked channels: ${prefs.blockedChannels.length > 0 ? prefs.blockedChannels.join(", ") : "none"}`,
      },
      // Include prior conversation so AI has memory
      ...(history || []).slice(-20).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    const stream = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: contextMessages,
      stream: true,
    });

    let fullResponse = "";

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ type: "text", content })}\n\n`);
      }
    }

    const lines = fullResponse.trim().split("\n");
    const lastLine = lines[lines.length - 1].trim();

    let action: {
      action: string;
      query?: string;
      blockedCategories?: string[];
      blockedKeywords?: string[];
      blockedChannels?: string[];
      unblockCategories?: string[];
      unblockKeywords?: string[];
      preferredCategories?: string[];
    } | null = null;

    try {
      if (lastLine.startsWith("{")) {
        action = JSON.parse(lastLine) as typeof action;
      }
    } catch {
      action = { action: "chat" };
    }

    if (action?.action === "search" && action.query) {
      try {
        const videos = await fetchYoutubeVideos(action.query, 12);
        const filtered = videos.filter((v) => !isVideoBlocked(v, prefs));
        res.write(
          `data: ${JSON.stringify({ type: "videos", videos: filtered, query: action.query })}\n\n`
        );
      } catch (err) {
        logger.error({ err }, "YouTube search in chat error");
        if (!YOUTUBE_API_KEY) {
          res.write(
            `data: ${JSON.stringify({ type: "text", content: "\n\n(YouTube API key not configured — video search unavailable)" })}\n\n`
          );
        }
      }
    } else if (action?.action === "update_preferences") {
      try {
        const newBlocked = {
          blockedCategories: [
            ...new Set([
              ...prefs.blockedCategories,
              ...(action.blockedCategories || []),
            ]),
          ],
          blockedKeywords: [
            ...new Set([
              ...prefs.blockedKeywords,
              ...(action.blockedKeywords || []),
            ]),
          ],
          blockedChannels: [
            ...new Set([
              ...prefs.blockedChannels,
              ...(action.blockedChannels || []),
            ]),
          ],
        };

        await db
          .update(youtubePreferencesTable)
          .set({ ...newBlocked, updatedAt: new Date() })
          .where(eq(youtubePreferencesTable.id, prefs.id));

        res.write(
          `data: ${JSON.stringify({ type: "preference_update", preferences: newBlocked })}\n\n`
        );
      } catch (err) {
        logger.error({ err }, "Preference update in chat error");
      }
    } else if (action?.action === "remove_preferences") {
      try {
        const toUnblockCats = (action.unblockCategories || []).map(c => c.toLowerCase());
        const toUnblockKws = (action.unblockKeywords || []).map(k => k.toLowerCase());
        const newBlocked = {
          blockedCategories: prefs.blockedCategories.filter(
            (c) => !toUnblockCats.includes(c.toLowerCase())
          ),
          blockedKeywords: toUnblockKws.length > 0
            ? prefs.blockedKeywords.filter((k) => !toUnblockKws.includes(k.toLowerCase()))
            : prefs.blockedKeywords,
          blockedChannels: prefs.blockedChannels,
        };

        await db
          .update(youtubePreferencesTable)
          .set({ ...newBlocked, updatedAt: new Date() })
          .where(eq(youtubePreferencesTable.id, prefs.id));

        res.write(
          `data: ${JSON.stringify({ type: "preference_update", preferences: newBlocked })}\n\n`
        );
      } catch (err) {
        logger.error({ err }, "Remove preference in chat error");
      }
    }

    if (action?.action === "set_preferred") {
      const cats = (action.preferredCategories || []).map(c => c.toLowerCase());
      res.write(
        `data: ${JSON.stringify({ type: "set_preferred", preferredCategories: cats })}\n\n`
      );
    }

    if (action?.action === "clear_preferred") {
      res.write(
        `data: ${JSON.stringify({ type: "clear_preferred" })}\n\n`
      );
    }

    if (action?.action === "show_preferences") {
      res.write(
        `data: ${JSON.stringify({ type: "show_preferences", preferences: {
          blockedCategories: prefs.blockedCategories,
          blockedKeywords: prefs.blockedKeywords,
          blockedChannels: prefs.blockedChannels,
        }})}\n\n`
      );
    }

    // Interests: pin topics to inject video recommendations on the homepage
    if (action?.action === "set_interests") {
      const typedAction = action as { interests?: string[]; searchQueries?: string[] };
      const interests = (typedAction.interests || []).map((i: string) => i.toLowerCase());
      // Use AI-provided search queries, fall back to interest names
      const searchQueries = typedAction.searchQueries?.length
        ? typedAction.searchQueries
        : interests.map(i => i + " videos");

      if (interests.length > 0) {
        // Fetch a preview of videos using the specific search query
        try {
          const vids = await fetchYoutubeVideos(searchQueries[0], 10);
          // Filter out anything the user has blocked
          const filtered = vids.filter(v => !isVideoBlocked(v, prefs));
          res.write(`data: ${JSON.stringify({ type: "videos", videos: filtered.slice(0, 8), query: searchQueries[0] })}\n\n`);
        } catch (_) {}
        res.write(`data: ${JSON.stringify({ type: "set_interests", interests, searchQueries })}\n\n`);
      }
    }

    if (action?.action === "remove_interest") {
      const interest = ((action as { interest?: string }).interest || "").toLowerCase();
      if (interest) {
        res.write(`data: ${JSON.stringify({ type: "remove_interest", interest })}\n\n`);
      }
    }

    if (action?.action === "clear_interests") {
      res.write(`data: ${JSON.stringify({ type: "clear_interests" })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "YouTube chat error");
    res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to process message" })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
});

// ─── YouTube topicDetails → our category names ────────────────────────────────
// YouTube extracts these topics from the video's actual content (audio + visual analysis).
// They're Wikipedia page slugs — far more accurate than title keywords.
const TOPIC_SLUG_TO_CAT: Record<string, string> = {
  // Music (very broad)
  Music: "music", Music_video: "music", Pop_music: "music", Rock_music: "music",
  Hip_hop_music: "music", Electronic_music: "music", "R%26B_music": "music",
  Soul_music: "music", Jazz: "music", Classical_music: "music", Reggae: "music",
  Country_music: "music", Christian_music: "music", Indie_pop: "music",
  Rhythm_and_blues: "music", Punk_rock: "music", Heavy_metal_music: "music",
  Dance_music: "music", Folk_music: "music", Gospel_music: "music",
  Soundtrack: "music", Musical_ensemble: "music", Singer: "music",
  Musician: "music", Record_label: "music", Album: "music",
  // Gaming
  Video_game: "gaming", "Action-adventure_game": "gaming", Action_game: "gaming",
  "Role-playing_game": "gaming", "First-person_shooter": "gaming", Strategy_game: "gaming",
  "Massively_multiplayer_online_role-playing_game": "gaming", Esports: "gaming",
  // Sports
  Sport: "sports", Association_football: "sports", American_football: "sports",
  Basketball: "sports", Baseball: "sports", Tennis: "sports", Cricket: "sports",
  Ice_hockey: "sports", Golf: "sports", Boxing: "sports", Motorsport: "sports",
  Olympics: "sports", Rugby: "sports",
  // Film / Entertainment
  Film: "film", Action_film: "film", Comedy_film: "film", Horror_film: "film",
  Drama: "film", Thriller: "film",
  // News / Politics
  Politics: "news", Government: "news",
  // Knowledge / Education
  Knowledge: "education", Education: "education",
};

function getTopicsForVideo(topicCategories: string[]): string[] {
  const cats: string[] = [];
  for (const url of (topicCategories || [])) {
    // URL: https://en.wikipedia.org/wiki/Hip_hop_music
    const slug = url.split("/wiki/").pop() || "";
    const cat = TOPIC_SLUG_TO_CAT[slug] || TOPIC_SLUG_TO_CAT[decodeURIComponent(slug)];
    if (cat) cats.push(cat);
  }
  return [...new Set(cats)];
}

function isTopicBlocked(topicCats: string[], blockedCategories: string[]): boolean {
  return topicCats.some(tc => blockedCategories.some(bc => normalizeCategoryName(bc) === tc));
}

// YouTube's official category ID → name mapping
// These are ground truth — YouTube assigns these, so they're highly accurate
const YT_CATEGORY_ID_MAP: Record<string, string> = {
  "1": "film",
  "2": "cars",
  "10": "music",
  "15": "pets",
  "17": "sports",
  "18": "travel",
  "19": "travel",
  "20": "gaming",
  "22": "people",
  "23": "comedy",
  "24": "entertainment",
  "25": "news",
  "26": "howto",
  "27": "education",
  "28": "science",
  "29": "nonprofits",
};

// Synonyms: if user blocks any of these, what category names also match?
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  music: ["music"],
  gaming: ["gaming", "game", "games"],
  news: ["news", "politics", "current events"],
  sports: ["sports", "sport"],
  comedy: ["comedy", "funny", "humor"],
  education: ["education", "educational", "learning", "tutorial"],
  science: ["science", "technology", "tech"],
  film: ["film", "movie", "movies", "cinema"],
  entertainment: ["entertainment"],
  travel: ["travel"],
  pets: ["pets", "animals"],
  howto: ["howto", "how-to", "diy"],
  shorts: ["shorts", "short", "reels", "tiktok"],
};

function normalizeCategoryName(name: string): string {
  const lower = name.toLowerCase().trim();
  for (const [key, synonyms] of Object.entries(CATEGORY_SYNONYMS)) {
    if (synonyms.some(s => lower.includes(s))) return key;
  }
  return lower;
}

function isCategoryBlocked(ytCategoryId: string, blockedCategories: string[]): boolean {
  const ytCatName = YT_CATEGORY_ID_MAP[ytCategoryId];
  if (!ytCatName) return false;
  return blockedCategories.some(bc => normalizeCategoryName(bc) === ytCatName);
}

function isChannelBlocked(
  channelTitle: string,
  blockedChannels: string[],
  checkMusicAutoChannels = false
): boolean {
  const lower = channelTitle.toLowerCase();
  // YouTube auto-generates "Artist - Topic" and VEVO channels for music — flag if music blocking is on
  if (checkMusicAutoChannels && (lower.endsWith(" - topic") || lower.includes("vevo"))) return true;
  return blockedChannels.some(bc => lower.includes(bc.toLowerCase()));
}

// ─── CLASSIFICATION SCORING SYSTEM ───────────────────────────────────────────
// Multi-signal scoring: each signal contributes points toward a "blocked" verdict.
// Score >= BLOCK_THRESHOLD → blocked outright (no AI needed)
// Score >= REVIEW_THRESHOLD → ambiguous, send to AI with context
// Score < REVIEW_THRESHOLD → safe (or send to AI only for preferred-category mode)

const BLOCK_THRESHOLD  = 40; // confident block — skip AI
const REVIEW_THRESHOLD = 15; // ambiguous — ask AI

// In-memory classification cache to avoid re-classifying the same video
// Key: `${videoId}:${categoryKey}` → { blocked: bool, ts: number }
const classifyCache = new Map<string, { blocked: boolean; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCached(videoId: string, cat: string): boolean | null {
  const key = `${videoId}:${cat}`;
  const entry = classifyCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { classifyCache.delete(key); return null; }
  return entry.blocked;
}
function setCache(videoId: string, cat: string, blocked: boolean) {
  classifyCache.set(`${videoId}:${cat}`, { blocked, ts: Date.now() });
  // Evict old entries if cache grows large
  if (classifyCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of classifyCache) {
      if (now - v.ts > CACHE_TTL_MS) classifyCache.delete(k);
    }
  }
}

// Comprehensive keyword lists per category
// "strong" keywords → high-confidence match (15 pts each, up to 3 hits)
// "weak"   keywords → soft signal (8 pts each, up to 3 hits)
const CATEGORY_KEYWORDS: Record<string, { strong: string[]; weak: string[] }> = {
  music: {
    strong: [
      "official music video", "official audio", "official mv", "lyric video",
      "lyrics video", "music video", "audio video", "(mv)", "[mv]",
      "feat.", "ft.", "featuring ", "(feat.", "(ft.",
      "remix", "acoustic cover", "piano cover", "guitar cover", "drum cover",
      "live at ", "live in ", "live from ", "live performance",
      "lofi", "lo-fi", "beats ", "instrumental",
      "music reaction", "song reaction", "album review", "song review",
      "official visualizer", "lyric visualizer", "lyrics visualizer",
      "karaoke", "sing along", "a cappella", "acapella",
      "new song", "new single", "new album", "new music",
      "official lyric", "official live",
    ],
    weak: [
      "song", "album", "single", "track", "ep release",
      "rock", "pop", "jazz", "blues", "rap", "hip hop", "hip-hop", "r&b", "rnb",
      "edm", "electronic", "indie", "country", "folk", "classical",
      "band", "singer", "vocalist", "musician", "rapper", "artist",
      "guitar", "piano", "drums", "bass", "violin", "saxophone",
      "melody", "chorus", "verse", "hook", "riff",
      "streaming", "spotify", "itunes", "apple music", "tidal",
      "concert", "tour", "festival", "gig",
      "music", "vevo",
    ],
  },
  gaming: {
    strong: [
      "gameplay", "let's play", "lets play", "full playthrough",
      "walkthrough", "speedrun", "game review", "gaming pc",
      "esports tournament", "game highlights", "gaming setup",
      "game trailer reaction", "game ranking", "game tier list",
    ],
    weak: [
      "game", "gamer", "gaming", "playthrough",
      "ps5", "playstation", "xbox", "nintendo", "steam", "pc gaming",
      "minecraft", "fortnite", "valorant", "apex", "gta", "cod", "warzone",
      "fps", "rpg", "mmo", "battle royale", "multiplayer", "streamer",
      "twitch", "esports", "tournament", "competitive",
    ],
  },
  news: {
    strong: [
      "breaking news", "news update", "news analysis", "political debate",
      "press conference", "world news", "daily news", "live news coverage",
      "news report", "politics explained",
    ],
    weak: [
      "news", "politics", "election", "government", "policy", "congress",
      "senate", "president", "prime minister", "current events",
      "journalism", "reporter", "media", "headline", "debate",
    ],
  },
  film: {
    strong: [
      "movie review", "film review", "cinema review", "movie breakdown",
      "movie reaction", "film analysis", "is it worth watching",
      "movie explained", "movie recap", "film critique",
      "movie ranking", "movie tier list", "film breakdown",
    ],
    weak: [
      "movie", "film", "cinema", "trailer", "actor", "director",
      "screenplay", "blockbuster", "review", "watch",
    ],
  },
  education: {
    strong: [
      "tutorial", "how to", "beginner guide", "crash course",
      "full course", "step by step", "explained ", "for beginners",
      "complete guide", "lecture series",
    ],
    weak: [
      "learn", "lesson", "class", "school", "university",
      "science", "math", "history", "programming", "coding", "study",
    ],
  },
  sports: {
    strong: [
      "match highlights", "game highlights", "full match", "sports analysis",
      "race highlights", "fight highlights", "training session",
    ],
    weak: [
      "sports", "football", "soccer", "basketball", "baseball", "tennis",
      "cricket", "nba", "nfl", "fifa", "ufc", "boxing", "golf", "f1",
      "athlete", "championship", "league", "team",
    ],
  },
  comedy: {
    strong: [
      "comedy sketch", "stand up", "stand-up comedy", "funny moments",
      "prank video", "comedy show", "roast", "parody video",
    ],
    weak: [
      "funny", "comedy", "humor", "prank", "meme", "jokes",
      "laughing", "hilarious", "sketch", "skit",
    ],
  },
};

// Channel name patterns per category (checked against channelTitle)
const CHANNEL_PATTERNS: Record<string, RegExp[]> = {
  music: [
    /-\s*topic$/i,       // YouTube auto-generated "Artist - Topic"
    /vevo$/i,            // VEVO channels
    / music$/i,          // "Sony Music", "Drake Music"
    / records?$/i,       // "Atlantic Records"
    /musicvevo$/i,
    / official$/i,       // Many music artists use this
  ],
  gaming: [
    /gaming$/i,
    / plays?$/i,
    / gamer$/i,
  ],
};

// Score a video for a given category (returns 0-100)
function scoreVideoForCat(
  video: { videoId: string; title: string; channel: string; description: string; tags: string[]; categoryId: string; topicCats: string[] },
  categoryNorm: string,
  ytCatBlocked: boolean,
  topicsMatch: boolean,
): number {
  let score = 0;

  // YouTube's official category assignment — most reliable single signal
  if (ytCatBlocked) score += 55;

  // YouTube's own topicDetails analysis — very accurate
  if (topicsMatch) score += 45;

  // Channel name patterns
  const chPatterns = CHANNEL_PATTERNS[categoryNorm] || [];
  if (chPatterns.some(p => p.test(video.channel))) score += 25;

  // Keyword scoring across title, tags, description
  const kws = CATEGORY_KEYWORDS[categoryNorm];
  if (kws) {
    const titleL = video.title.toLowerCase();
    const tagsL  = video.tags.join(" ").toLowerCase();
    const descL  = video.description.toLowerCase();
    const allL   = `${titleL} ${tagsL} ${descL}`;

    // Strong matches in TITLE (highest weight — title is the most deliberate signal)
    let strongTitleHits = 0;
    for (const kw of kws.strong) {
      if (titleL.includes(kw)) { score += 18; if (++strongTitleHits >= 2) break; }
    }

    // Strong matches in tags/description
    let strongAllHits = 0;
    for (const kw of kws.strong) {
      if (tagsL.includes(kw) || descL.includes(kw)) { score += 8; if (++strongAllHits >= 3) break; }
    }

    // Weak matches in title
    let weakTitleHits = 0;
    for (const kw of kws.weak) {
      if (titleL.includes(kw)) { score += 7; if (++weakTitleHits >= 3) break; }
    }

    // Weak matches in tags (tags are author-provided, reliable)
    let weakTagHits = 0;
    for (const kw of kws.weak) {
      if (tagsL.includes(kw)) { score += 5; if (++weakTagHits >= 3) break; }
    }
  }

  return Math.min(score, 100);
}

router.post("/classify", async (req, res) => {
  const { videoIds, preferences: prefs, preferredCategories: preferredCats } = req.body as {
    videoIds: string[];
    preferences: {
      blockedCategories: string[];
      blockedKeywords: string[];
      blockedChannels: string[];
    };
    preferredCategories?: string[];
  };

  if (!videoIds || videoIds.length === 0) {
    res.json({ blockedVideoIds: [], notPreferredVideoIds: [] });
    return;
  }

  const hasBlockPrefs =
    (prefs?.blockedCategories?.length > 0) ||
    (prefs?.blockedKeywords?.length > 0) ||
    (prefs?.blockedChannels?.length > 0);
  const hasPreferred = (preferredCats?.length || 0) > 0;

  if (!hasBlockPrefs && !hasPreferred) {
    res.json({ blockedVideoIds: [], notPreferredVideoIds: [] });
    return;
  }

  const blockedVideoIds: string[] = [];
  const notPreferredVideoIds: string[] = [];

  try {
    if (!YOUTUBE_API_KEY) {
      res.json({ blockedVideoIds: [], notPreferredVideoIds: [] });
      return;
    }

    // Fetch rich metadata: snippet (title/desc/tags/category) AND topicDetails
    // topicDetails.topicCategories are Wikipedia URLs extracted by YouTube from the
    // video's actual audio+visual content — this is YouTube's own semantic classification.
    const ids = videoIds.slice(0, 25).join(",");
    const metaUrl = `${YOUTUBE_API_BASE}/videos?part=snippet,topicDetails&id=${ids}&key=${YOUTUBE_API_KEY}`;
    const metaRes = await fetch(metaUrl);

    if (!metaRes.ok) {
      res.json({ blockedVideoIds: [], notPreferredVideoIds: [] });
      return;
    }

    const metaData = (await metaRes.json()) as {
      items: Array<{
        id: string;
        snippet: {
          title: string;
          channelTitle: string;
          description: string;
          categoryId: string;
          tags?: string[];
          thumbnails: { medium?: { url: string }; default?: { url: string } };
        };
        topicDetails?: {
          topicCategories?: string[];  // Wikipedia URLs e.g. https://en.wikipedia.org/wiki/Music
        };
      }>;
    };

    const videos = (metaData.items || []).map((item) => ({
      videoId: item.id,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      description: (item.snippet.description || "").substring(0, 400),
      categoryId: item.snippet.categoryId || "",
      categoryName: YT_CATEGORY_ID_MAP[item.snippet.categoryId] || "unknown",
      tags: (item.snippet.tags || []).slice(0, 20),
      // topicCategories: YouTube-extracted Wikipedia topic slugs (most accurate signal)
      topicCats: getTopicsForVideo(item.topicDetails?.topicCategories || []),
      topicCategoryUrls: (item.topicDetails?.topicCategories || []).map(u => u.split("/wiki/").pop() || ""),
    }));

    // ── MULTI-SIGNAL SCORING CLASSIFICATION ──────────────────────────────────
    // Every video is scored against each blocked category using multiple signals.
    // score >= BLOCK_THRESHOLD (40)  → blocked, no AI needed
    // score >= REVIEW_THRESHOLD (15) → ambiguous, sent to AI for final decision
    // score < REVIEW_THRESHOLD       → safe (or AI for preferred-mode only)
    const needsAI: typeof videos = [];

    for (const v of videos) {
      // 0. Cache hit?
      let cachedBlock = false;
      let cacheHit = false;
      for (const cat of (prefs.blockedCategories || [])) {
        const norm = normalizeCategoryName(cat);
        const cached = getCached(v.videoId, norm);
        if (cached !== null) { if (cached) { cachedBlock = true; } cacheHit = true; }
      }
      if (cacheHit && cachedBlock) { blockedVideoIds.push(v.videoId); continue; }

      // 1. Explicit user keyword match (user's own words → always block)
      const fullText = `${v.title} ${v.tags.join(" ")} ${v.description}`.toLowerCase();
      const userKwMatch = (prefs.blockedKeywords || []).some(kw => fullText.includes(kw.toLowerCase()));
      if (userKwMatch) { blockedVideoIds.push(v.videoId); continue; }

      // 2. Explicit user channel block
      const channelLower = v.channel.toLowerCase();
      const userChMatch = (prefs.blockedChannels || []).some(bc => channelLower.includes(bc.toLowerCase()));
      if (userChMatch) { blockedVideoIds.push(v.videoId); continue; }

      // 3. Score against each blocked category
      let highestScore = 0;
      let highestCat   = "";

      for (const cat of (prefs.blockedCategories || [])) {
        const norm         = normalizeCategoryName(cat);
        const ytCatBlocked = isCategoryBlocked(v.categoryId, [cat]);
        const topicsMatch  = v.topicCats.length > 0 && isTopicBlocked(v.topicCats, [cat]);
        const score        = scoreVideoForCat(v, norm, ytCatBlocked, topicsMatch);

        if (score > highestScore) { highestScore = score; highestCat = norm; }

        // Cache this result for 30 min
        if (score >= BLOCK_THRESHOLD) setCache(v.videoId, norm, true);
        else if (score < REVIEW_THRESHOLD) setCache(v.videoId, norm, false);
      }

      if (highestScore >= BLOCK_THRESHOLD) {
        // High-confidence block — no AI needed
        blockedVideoIds.push(v.videoId);
      } else if (highestScore >= REVIEW_THRESHOLD || hasPreferred) {
        // Ambiguous or need preferred check — send to AI
        needsAI.push(v);
      }
      // else: low score → safe, don't add to either list
    }

    // TIER 3: AI classifies the remaining ambiguous videos using ALL metadata
    // Also determines if videos match preferredCategories when that filter is active
    if (needsAI.length > 0) {
      const blockParts: string[] = [];
      if (prefs.blockedCategories?.length > 0)
        blockParts.push(`Block these content types: ${prefs.blockedCategories.join(", ")}`);
      if (prefs.blockedKeywords?.length > 0)
        blockParts.push(`Block content related to: ${prefs.blockedKeywords.slice(0, 20).join(", ")}`);

      const preferredPart = hasPreferred
        ? `\nUSER PREFERRED CONTENT (show ONLY these types, hide everything else):\n${preferredCats!.join(", ")}`
        : "";

      const catExamples: Record<string,string> = {
        music: `"music" includes: ANY song, ANY music video (official, lyric, audio, visualizer), covers, instrumentals,
          piano/guitar/violin covers, lofi, beats, DJ sets, EDM, hip hop, rap, pop, rock videos,
          karaoke, remixes, mashups, acoustic versions, a cappella, live concerts/performances of music,
          soundtracks, OSTs, theme songs, music reactions, song/album reviews, music vlog. 
          RULE: If a channel is a music artist's channel (e.g. "Drake", "Taylor Swift", "BTS") or any 
          video where the main content IS the music, BLOCK IT. Err on the side of blocking.`,
        gaming: `"gaming" includes: gameplay, walkthroughs, let's plays, game reviews, speedruns, esports,
          game tier lists, game news, gaming highlights, Twitch clips, gaming vlogs, gaming challenges.`,
        news: `"news" includes: news reports, breaking news, political commentary, elections, current events,
          journalism, press conferences, political debates, news analysis, talk shows about current events.`,
        shorts: `"shorts" includes: YouTube Shorts (vertical format, usually <60s), TikTok-style content, 
          #shorts, reels, rapid-fire content.`,
        film: `"film"/"movie" includes: movie reviews, film critiques, trailers, movie reactions,
          movie recaps, cinematic analysis, "is it worth watching", ranking films, director interviews.`,
      };

      const relevantExamples = (prefs.blockedCategories || [])
        .map(c => catExamples[c.toLowerCase()])
        .filter(Boolean)
        .join("\n\n");

      const classifyPrompt = `You are a strict YouTube content classifier enforcing user content filters.
Your job is to PROTECT the user from seeing content they explicitly asked to block.

CRITICAL PHILOSOPHY: 
- When uncertain, BLOCK. The user would rather miss a borderline video than see unwanted content.
- Be especially aggressive for categories the user has explicitly blocked.
- Use ALL available signals: title, channel name, tags, description, YouTube's own topic categories.

USER'S BLOCKED CONTENT:
${blockParts.join("\n")}

WHAT EACH CATEGORY MEANS (BE THIS STRICT):
${relevantExamples || blockParts.join("\n")}
${preferredPart}

${hasPreferred ? `PREFERRED CONTENT RULES:
- Mark as "notPreferred" if the video clearly does NOT match: ${preferredCats!.join(", ")}
- Only leave off "notPreferred" if you're confident it matches the preferred type` : ""}

VIDEOS TO CLASSIFY (analyze every field carefully):
${needsAI.map((v) =>
  `[${v.videoId}]
Title: "${v.title}"
Channel: "${v.channel}"
YouTube category: ${v.categoryName} (ID: ${v.categoryId})
YouTube topic analysis: ${v.topicCategoryUrls.length > 0 ? v.topicCategoryUrls.join(", ") : "none"}
Tags: ${v.tags.length > 0 ? v.tags.slice(0, 15).join(", ") : "none"}
Description snippet: ${v.description || "none"}`
).join("\n\n---\n\n")}

${hasPreferred
  ? `Reply with ONLY valid JSON: {"blocked": ["id1","id2"], "notPreferred": ["id3","id4"]}
Example (nothing to block/filter): {"blocked": [], "notPreferred": []}`
  : `Reply with ONLY a JSON array of video IDs to block: ["id1","id2"]
Example (nothing to block): []`}`;

      try {
        const result = await openai.chat.completions.create({
          model: "gpt-5.2",
          messages: [{ role: "user", content: classifyPrompt }],
          max_completion_tokens: 500,
        });

        const aiContent = result.choices[0]?.message?.content || "";

        if (hasPreferred) {
          // Parse {"blocked": [...], "notPreferred": [...]}
          const objMatch = aiContent.match(/\{[\s\S]*\}/);
          if (objMatch) {
            try {
              const parsed = JSON.parse(objMatch[0]) as { blocked?: string[]; notPreferred?: string[] };
              blockedVideoIds.push(...(parsed.blocked || []).filter(id => videoIds.includes(id)));
              notPreferredVideoIds.push(...(parsed.notPreferred || []).filter(id => videoIds.includes(id)));
            } catch (_) {}
          }
        } else {
          const match = aiContent.match(/\[[\s\S]*?\]/);
          if (match) {
            const aiBlocked = JSON.parse(match[0]) as string[];
            blockedVideoIds.push(...aiBlocked.filter(id => videoIds.includes(id)));
          }
        }
      } catch (aiErr) {
        logger.error({ aiErr }, "AI classification error");
      }
    }

    res.json({
      blockedVideoIds: [...new Set(blockedVideoIds)],
      notPreferredVideoIds: [...new Set(notPreferredVideoIds)],
    });
  } catch (err) {
    logger.error({ err }, "Video classify error");
    res.json({ blockedVideoIds: [], notPreferredVideoIds: [] });
  }
});

export default router;
