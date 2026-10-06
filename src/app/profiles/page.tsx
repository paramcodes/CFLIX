'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Check, ShieldAlert } from 'lucide-react';
import { fetchApi, getActiveToken } from '../../lib/api';

export interface ProfileData {
  id: string;
  accountId?: string;
  name: string;
  maturity: string;
}

const AVATAR_COLORS = [
  'bg-red-600',
  'bg-blue-600',
  'bg-purple-600',
  'bg-emerald-600',
  'bg-amber-600',
  'bg-indigo-600',
];

export default function ProfilesPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<ProfileData[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileMaturity, setNewProfileMaturity] = useState('adult');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getActiveToken();
    if (!token) {
      router.push('/signin');
      return;
    }

    fetchApi('/api/profiles')
      .then((res: { items?: ProfileData[] }) => {
        setProfiles(res.items || []);
      })
      .catch(() => {
        router.push('/signin');
      })
      .finally(() => setLoading(false));
  }, [router]);

  const selectProfile = (profile: ProfileData) => {
    sessionStorage.setItem('cflix_profile', JSON.stringify(profile));
    router.push('/');
  };

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;
    try {
      const created = await fetchApi<ProfileData>('/api/profiles', {
        method: 'POST',
        body: {
          name: newProfileName.trim(),
          maturity: newProfileMaturity,
        },
      });

      setProfiles((prev) => [...prev, created]);
      setNewProfileName('');
      setNewProfileMaturity('adult');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create profile';
      setError(message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-black">
      <div className="max-w-4xl w-full text-center">
        <h1 className="text-3xl sm:text-5xl font-black text-white mb-8 sm:mb-12 tracking-tight">
          Who’s watching?
        </h1>

        {loading ? (
          <div className="text-neutral-400">Loading profiles...</div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 mb-12">
            {profiles.map((p, idx) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectProfile(p)}
                className="group flex flex-col items-center gap-3 cursor-pointer focus:outline-none"
              >
                <div
                  className={`w-24 h-24 sm:w-32 sm:h-32 rounded-lg ${
                    AVATAR_COLORS[idx % AVATAR_COLORS.length]
                  } flex items-center justify-center text-4xl sm:text-5xl font-bold text-white shadow-xl group-hover:ring-4 group-hover:ring-white transition-all transform-gpu group-hover:scale-105`}
                >
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-sm sm:text-base text-neutral-300 group-hover:text-white font-medium transition-colors">
                    {p.name}
                  </span>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-widest mt-0.5">
                    {p.maturity}
                  </span>
                </div>
              </button>
            ))}

            {/* Add Profile Tile (Max 5) */}
            {profiles.length < 5 ? (
              <button
                type="button"
                onClick={() => setIsDialogOpen(true)}
                className="group flex flex-col items-center gap-3 cursor-pointer focus:outline-none"
              >
                <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-lg border-2 border-dashed border-neutral-700 hover:border-neutral-400 flex items-center justify-center text-neutral-500 hover:text-white transition-all group-hover:scale-105">
                  <Plus className="w-10 h-10" />
                </div>
                <span className="text-sm sm:text-base text-neutral-400 group-hover:text-white transition-colors">
                  Add Profile
                </span>
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* Add Profile Modal Dialog */}
      {isDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-md w-full p-6 sm:p-8 shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-2">Add Profile</h2>
            <p className="text-neutral-400 text-xs sm:text-sm mb-6">
              Add a profile for another person watching CFLIX.
            </p>

            {error ? (
              <div className="mb-4 p-3 rounded bg-red-950/80 border border-red-500/50 text-red-200 text-xs flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 flex-none" />
                <span>{error}</span>
              </div>
            ) : null}

            <form onSubmit={handleCreateProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1.5 uppercase">
                  Name
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Profile Name"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2.5 text-white placeholder-neutral-500 focus:outline-none focus:border-white transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1.5 uppercase">
                  Maturity Level
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'child', label: 'Child', desc: 'All ages' },
                    { id: 'teen', label: 'Teen', desc: 'Teens' },
                    { id: 'adult', label: 'Adult', desc: 'All titles' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setNewProfileMaturity(m.id)}
                      className={`p-2.5 rounded-lg border text-left flex flex-col justify-between transition-colors ${
                        newProfileMaturity === m.id
                          ? 'border-red-600 bg-red-950/30 text-white'
                          : 'border-neutral-800 bg-neutral-800/60 text-neutral-400 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-bold text-xs uppercase">
                          {m.label}
                        </span>
                        {newProfileMaturity === m.id ? (
                          <Check className="w-3.5 h-3.5 text-red-500" />
                        ) : null}
                      </div>
                      <span className="text-[10px] text-neutral-500 mt-1">
                        {m.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setIsDialogOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm text-neutral-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors shadow"
                >
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
