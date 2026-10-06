import React from 'react';
import './globals.css';
import { Providers } from './providers.jsx';
import { Navbar } from '../components/layout/Navbar.jsx';

export const metadata = {
  title: 'CFLIX · Stream Movies & Series',
  description: 'CFLIX streaming platform prototype and services',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#141414] text-white min-h-screen">
        <Providers>
          <Navbar />
          <main className="min-h-screen">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
