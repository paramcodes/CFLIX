import { QueryClient } from '@tanstack/react-query';

/**
 * Creates and configures a TanStack QueryClient instance.
 * Defaults to 5 minutes staleTime to prevent redundant refetches.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes
        gcTime: 10 * 60 * 1000, // 10 minutes
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Do not retry 401 or 404 errors
          if (error?.status === 401 || error?.status === 404) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

let browserQueryClient = null;

export function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always create a fresh QueryClient
    return makeQueryClient();
  }
  // Browser: reuse single client instance
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}
