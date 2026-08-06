// ============================================================
// MoniStream — Auth Hook
// ============================================================

'use client';

import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { useAuthStore } from '@/store/authStore';
import type { UserPublic, ApiResponse } from '@/types';

const fetcher = async (url: string) => {
  const res = await fetch(url);

  if (res.status === 401) {
    // Try to refresh the token
    const refreshRes = await fetch('/api/auth/refresh', { method: 'POST' });
    if (refreshRes.ok) {
      // Retry the original request with new token
      const retryRes = await fetch(url);
      if (retryRes.ok) return retryRes.json();
    }
    // Refresh failed — clear persisted auth state
    // The refresh endpoint already clears cookies on failure
    // Do NOT redirect here — the middleware handles route protection
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('monistream-auth-storage');
      } catch { /* ignore */ }
    }
    throw new Error('Session expired');
  }

  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
};

export function useAuth() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, setUser, setLoading, logout: storeLogout } = useAuthStore();

  const { data, error, isValidating, mutate } = useSWR<ApiResponse<{ user: UserPublic }>>(
    '/api/auth/me',
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      errorRetryCount: 1,
      dedupingInterval: 30000, // 30s cache
      onError: () => {
        setUser(null);
      },
    }
  );

  useEffect(() => {
    if (data?.data) {
      setUser(data.data.user);
    } else if (error) {
      setUser(null);
    }
    setLoading(false);
  }, [data, error, setUser, setLoading]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        let errorMsg = 'Login failed';
        try {
          const json = await res.json();
          errorMsg = json.error || errorMsg;
        } catch {
          errorMsg = `Server error: ${res.status} ${res.statusText}`;
        }
        throw new Error(errorMsg);
      }

      const json = await res.json();
      await mutate();
      router.push('/');
      return json;
    },
    [mutate, router]
  );

  const register = useCallback(
    async (data: {
      email: string;
      username: string;
      displayName: string;
      password: string;
    }) => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        let errorMsg = 'Registration failed';
        try {
          const json = await res.json();
          errorMsg = json.error || errorMsg;
        } catch {
          errorMsg = `Server error: ${res.status} ${res.statusText}`;
        }
        throw new Error(errorMsg);
      }

      const json = await res.json();
      await mutate();
      router.push('/');
      return json;
    },
    [mutate, router]
  );

  const { mutate: globalMutate } = useSWRConfig();

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Continue with client-side logout even if API fails
    }
    storeLogout();
    await globalMutate(() => true, undefined, { revalidate: false });
    router.push('/login');
  }, [storeLogout, globalMutate, router]);

  return {
    user,
    isAuthenticated,
    isLoading: isLoading || isValidating,
    login,
    register,
    logout,
    mutate,
  };
}
