import { proxyToBackend } from '../../../lib/proxy';

export const dynamic = 'force-dynamic';

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? 'http://localhost:3000';

const handler = (request: Request): Promise<Response> =>
  proxyToBackend(request, { backendOrigin: BACKEND_ORIGIN });

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
