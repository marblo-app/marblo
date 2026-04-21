'use client';

import { useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { X } from 'lucide-react';

const featureImages: Record<string, string> = {
  multiagent: '/images/feature-multiagent.png',
  kanban: '/images/feature-kanban.png',
  flow: '/images/feature-flow.png',
  orchestrator: '/images/feature-orchestrator.png',
  mcp: '/images/feature-mcp.png',
  privacy: '/images/feature-privacy.png',
};

const gradientColors: Record<string, string> = {
  multiagent: 'from-blue-600/30 to-purple-600/30',
  kanban: 'from-green-600/30 to-teal-600/30',
  flow: 'from-orange-600/30 to-red-600/30',
  orchestrator: 'from-pink-600/30 to-rose-600/30',
  mcp: 'from-cyan-600/30 to-blue-600/30',
  privacy: 'from-emerald-600/30 to-green-600/30',
};

interface FeatureModalProps {
  featureKey: string;
  onClose: () => void;
}

export default function FeatureModal({ featureKey, onClose }: FeatureModalProps) {
  const t = useTranslations('features');

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  const imageSrc = featureImages[featureKey];
  const gradient = gradientColors[featureKey] || 'from-gray-600/30 to-gray-800/30';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-gray-900 border border-gray-700 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 rounded-lg bg-gray-800/80 hover:bg-gray-700 transition text-gray-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Screenshot area */}
        <div className={`relative w-full aspect-video rounded-t-2xl overflow-hidden bg-gradient-to-br ${gradient}`}>
          <ImageOrPlaceholder src={imageSrc} alt={t(`${featureKey}.title`)} gradient={gradient} />
        </div>

        {/* Content */}
        <div className="p-8">
          <h3 className="text-2xl font-bold mb-2">{t(`${featureKey}.title`)}</h3>
          <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400 mb-4">
            {t(`${featureKey}.highlight`)}
          </span>
          <p className="text-gray-300 leading-relaxed whitespace-pre-line">
            {t(`${featureKey}.detail`)}
          </p>
        </div>
      </div>
    </div>
  );
}

function ImageOrPlaceholder({
  src,
  alt,
  gradient,
}: {
  src: string;
  alt: string;
  gradient: string;
}) {
  return (
    <>
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
        <span className="text-gray-500 text-sm">Screenshot</span>
      </div>
      <Image
        src={src}
        alt={alt}
        fill
        className="object-cover relative z-[1]"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    </>
  );
}
