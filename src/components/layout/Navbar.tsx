'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Search, User, LogOut } from 'lucide-react';
import { getActiveProfile } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';

interface NavbarProfile {
  name: string;
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [profile, setProfile] = useState<NavbarProfile | null>(null);

  useEffect(() => {
    setProfile(getActiveProfile() as NavbarProfile | null);

    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/browse?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const navLinks = [
    { label: 'Home', href: '/' },
    { label: 'Movies', href: '/browse?kind=movie' },
    { label: 'Series', href: '/browse?kind=series' },
    { label: 'Anime', href: '/browse?kind=anime' },
  ];

  return (
    <nav
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300 px-4 sm:px-12 py-3 sm:py-4 flex items-center justify-between',
        scrolled
          ? 'bg-black/90 backdrop-blur shadow-md'
          : 'bg-gradient-to-b from-black/80 to-transparent',
      )}
    >
      {/* Left: Brand & Navigation Links */}
      <div className="flex items-center gap-6 sm:gap-10">
        <Link
          href="/"
          className="text-2xl sm:text-3xl font-black text-red-600 tracking-wider"
        >
          CFLIX
        </Link>
        <div className="hidden md:flex items-center gap-5 text-sm">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.label}
                href={link.href}
                className={cn(
                  'transition-colors hover:text-white',
                  isActive ? 'text-white font-semibold' : 'text-neutral-300',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Right: Search bar & Profile switcher */}
      <div className="flex items-center gap-4 sm:gap-6">
        {/* Expandable Search Input */}
        <form
          onSubmit={handleSearchSubmit}
          className="relative flex items-center"
        >
          {searchOpen ? (
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onBlur={() => !searchQuery && setSearchOpen(false)}
              placeholder="Titles, people, genres..."
              className="bg-black/80 border border-white/40 text-white text-xs sm:text-sm rounded px-3 py-1.5 pl-8 focus:outline-none focus:border-white transition-all w-48 sm:w-64"
            />
          ) : null}
          <button
            type="button"
            onClick={() => setSearchOpen(!searchOpen)}
            aria-label="Search"
            className="text-white hover:text-neutral-300 p-1"
          >
            <Search className="w-5 h-5" />
          </button>
        </form>

        {/* Profile Avatar & Quick Link */}
        <div className="flex items-center gap-2">
          <Link
            href="/profiles"
            className="flex items-center gap-2 text-white hover:opacity-80 transition-opacity"
            title={profile ? `Watching as ${profile.name}` : 'Switch profile'}
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded bg-red-700 flex items-center justify-center font-bold text-xs uppercase text-white shadow">
              {profile ? profile.name.charAt(0) : <User className="w-4 h-4" />}
            </div>
            {profile ? (
              <span className="hidden sm:inline text-xs font-medium text-neutral-200">
                {profile.name}
              </span>
            ) : null}
          </Link>

          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem('cflix_token');
              sessionStorage.removeItem('cflix_profile');
              router.push('/signin');
            }}
            title="Sign out"
            aria-label="Sign out"
            className="text-neutral-400 hover:text-white p-1 ml-1"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </nav>
  );
}
