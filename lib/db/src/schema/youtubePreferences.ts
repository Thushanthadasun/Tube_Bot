import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const youtubePreferencesTable = pgTable("youtube_preferences", {
  id: serial("id").primaryKey(),
  blockedCategories: text("blocked_categories").array().notNull().default([]),
  blockedKeywords: text("blocked_keywords").array().notNull().default([]),
  blockedChannels: text("blocked_channels").array().notNull().default([]),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertYoutubePreferencesSchema = createInsertSchema(
  youtubePreferencesTable,
).omit({ id: true, updatedAt: true });

export type InsertYoutubePreferences = z.infer<
  typeof insertYoutubePreferencesSchema
>;
export type YoutubePreferences = typeof youtubePreferencesTable.$inferSelect;
