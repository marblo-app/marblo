import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

export function proxy(request: import('next/server').NextRequest) {
  return intlMiddleware(request);
}

export const config = {
  matcher: ['/', '/(ko|en|ja)/:path*'],
};
