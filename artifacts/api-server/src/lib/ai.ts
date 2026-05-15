import OpenAI from "openai";

/**
 * Universal OpenAI client — works on Replit and any other host.
 *
 * On Replit:   uses AI_INTEGRATIONS_OPENAI_* env vars (set automatically)
 * Self-hosted: uses OPENAI_API_KEY (standard OpenAI key from platform.openai.com)
 */
function createClient(): OpenAI {
  // Standard self-hosted path: just set OPENAI_API_KEY
  if (process.env.OPENAI_API_KEY) {
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  // Replit AI integration path (set automatically on Replit)
  if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
    return new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }

  throw new Error(
    "No OpenAI credentials found.\n" +
    "Self-hosted: set OPENAI_API_KEY in your environment.\n" +
    "Replit: add the OpenAI AI Integration in your Replit project."
  );
}

export const openai = createClient();
