// Named `route.api.ts` so the static GitHub Pages export can leave it out
// (see pageExtensions in next.config.ts). `next build` / `next start` include it.
import { handleChat } from '@/lib/chat-handler';

export const dynamic = 'force-dynamic';

export function POST(request: Request): Promise<Response> {
  return handleChat(request, process.env);
}
