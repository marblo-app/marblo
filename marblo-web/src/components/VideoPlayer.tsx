'use client';

interface VideoPlayerProps {
  youtubeId: string;
  title: string;
}

export default function VideoPlayer({ youtubeId, title }: VideoPlayerProps) {
  return (
    <div className="aspect-video w-full rounded-xl overflow-hidden bg-zinc-900">
      <iframe
        src={`https://www.youtube.com/embed/${youtubeId}?rel=0&cc_load_policy=1`}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full"
      />
    </div>
  );
}
