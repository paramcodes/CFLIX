import { QueryClient } from '@tanstack/react-query';

/**
 * Creates and configures a TanStack QueryClient instance.
 * Defaults to 5 minutes staleTime to prevent redundant refetches.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes
        gcTime: 10 * 60 * 1000, // 10 minutes
        refetchOnWindowFocus: false,
        retry: (failureCount: number, error: unknown) => {
          if (error && typeof error === 'object' && 'status' in error) {
            const status = error.status;
            if (
              typeof status === 'number' &&
              (status === 401 || status === 404)
            ) {
              return false;
            }
          }
          return failureCount < 2;
        },
      },
    },
  });
}

let browserQueryClient: QueryClient | null = null;

export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}
