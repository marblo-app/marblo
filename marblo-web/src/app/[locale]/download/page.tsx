'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Monitor, Apple, TerminalIcon } from 'lucide-react';

export default function DownloadPage() {
  const t = useTranslations('download');
  const [os, setOs] = useState<'mac' | 'windows' | 'linux'>('mac');

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) setOs('windows');
    else if (ua.includes('linux')) setOs('linux');
    else setOs('mac');
  }, []);

  const downloads = [
    { id: 'mac', label: t('macos'), icon: Apple, url: '#', ext: '.dmg' },
    { id: 'windows', label: t('windows'), icon: Monitor, url: '#', ext: '.exe' },
    { id: 'linux', label: t('linux'), icon: TerminalIcon, url: '#', ext: '.AppImage' },
  ];

  return (
    <div className="py-24 px-4">
      <div className="max-w-3xl mx-auto text-center">
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="text-zinc-400 mt-3 mb-12">{t('subtitle')}</p>
        <div className="space-y-4">
          {downloads.map((dl) => (
            <a
              key={dl.id}
              href={dl.url}
              className={`flex items-center justify-between p-6 rounded-xl border transition ${
                os === dl.id
                  ? 'bg-indigo-600/10 border-indigo-500 ring-1 ring-indigo-500/50'
                  : 'bg-zinc-900 border-zinc-700/50 hover:border-zinc-600'
              }`}
            >
              <div className="flex items-center gap-4">
                <dl.icon className="w-8 h-8 text-zinc-300" />
                <span className="text-lg font-medium">{dl.label}</span>
              </div>
              <div className="flex items-center gap-3">
                {os === dl.id && (
                  <span className="bg-indigo-600 text-white text-xs px-2 py-1 rounded">{t('recommended')}</span>
                )}
                <span className="text-zinc-500 text-sm">{dl.ext}</span>
              </div>
            </a>
          ))}
        </div>
        <p className="text-zinc-500 text-sm mt-8">{t('version')}: 3.0.0-beta</p>
      </div>
    </div>
  );
}
