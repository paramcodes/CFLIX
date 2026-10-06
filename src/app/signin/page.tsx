'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi } from '../../lib/api';

interface AuthResponse {
  session?: { token: string; expiresAt: number };
  user?: { id: string; email: string; provider: string };
}

export default function SignInPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isSignUp ? '/api/auth/signup' : '/api/auth/signin';
      const res = await fetchApi<AuthResponse>(endpoint, {
        method: 'POST',
        body: { email, password },
      });

      if (res.session?.token) {
        sessionStorage.setItem('cflix_token', res.session.token);
        router.push('/profiles');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Authentication failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const googleEmail = email.trim() || 'google_user@test.dev';
      const res = await fetchApi<AuthResponse>(`/api/auth/google`, {
        method: 'POST',
        body: { idToken: `google:${googleEmail}` },
      });
      if (res.session?.token) {
        sessionStorage.setItem('cflix_token', res.session.token);
        router.push('/profiles');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Google sign-in failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 bg-black">
      {/* Background Graphic / Dimmer */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-900 via-black to-black opacity-90" />

      {/* Auth Card */}
      <div className="relative z-10 w-full max-w-md bg-black/75 border border-white/10 rounded-xl p-8 sm:p-10 shadow-2xl backdrop-blur-md">
        <h1 className="text-3xl font-extrabold text-white mb-2">
          {isSignUp ? 'Create your account' : 'Sign In to CFLIX'}
        </h1>
        <p className="text-neutral-400 text-sm mb-6">
          {isSignUp
            ? 'Start streaming movies, anime, and series'
            : 'Welcome back to your streaming dashboard'}
        </p>

        {error ? (
          <div className="mb-4 p-3 rounded bg-red-950/80 border border-red-500/50 text-red-200 text-xs">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5 uppercase tracking-wider">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-white placeholder-neutral-500 focus:outline-none focus:border-red-600 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5 uppercase tracking-wider">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-white placeholder-neutral-500 focus:outline-none focus:border-red-600 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-lg hover:shadow-red-900/30 transition-all disabled:opacity-50"
          >
            {loading ? 'Please wait...' : isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-800" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-black/75 px-3 text-neutral-400">
              Or continue with
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          Google
        </button>

        <div className="mt-8 text-center text-sm text-neutral-400">
          {isSignUp ? 'Already have an account? ' : 'New to CFLIX? '}
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError('');
            }}
            className="text-white hover:underline font-semibold"
          >
            {isSignUp ? 'Sign In now' : 'Sign up now'}
          </button>
        </div>
      </div>
    </div>
  );
}
