// Named `route.api.ts` so the static GitHub Pages export can leave it out
// (see pageExtensions in next.config.ts). `next build` / `next start` include it.
import { handleChat } from '@/lib/chat-handler';

export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return handleChat(request, {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  });
}
