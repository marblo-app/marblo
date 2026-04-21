'use client';

import { useState } from 'react';
import Image from 'next/image';

export default function HeroScreenshot() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Mockup */}
      <div
        className="mt-16 mx-auto max-w-5xl cursor-pointer group"
        style={{ perspective: '1200px' }}
        onClick={() => setIsOpen(true)}
      >
        <div
          className="rounded-xl shadow-2xl shadow-indigo-500/10 border border-zinc-800 overflow-hidden transition-transform duration-300 group-hover:scale-[1.01]"
          style={{ transform: 'rotateX(2deg)', transformOrigin: 'bottom center' }}
        >
          {/* Mac-style title bar */}
          <div className="flex items-center gap-2 px-4 py-3 bg-zinc-800 border-b border-zinc-700">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <span className="ml-auto mr-auto text-sm text-zinc-400 font-medium">Marblo v3</span>
          </div>
          {/* Screenshot */}
          <div className="relative w-full bg-zinc-900">
            <Image
              src="/images/hero-screenshot.png"
              alt="Marblo v3 App Screenshot"
              width={2560}
              height={1440}
              className="w-full h-auto"
              priority
            />
          </div>
        </div>
        <p className="text-center text-zinc-600 text-xs mt-3">클릭하여 크게 보기</p>
      </div>

      {/* Lightbox */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setIsOpen(false)}
        >
          <div className="relative max-w-[95vw] max-h-[95vh]">
            <Image
              src="/images/hero-screenshot.png"
              alt="Marblo v3 App Screenshot"
              width={2560}
              height={1440}
              className="w-full h-auto rounded-lg"
              quality={95}
            />
            <button
              className="absolute -top-3 -right-3 w-8 h-8 bg-zinc-800 border border-zinc-700 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition"
              onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
