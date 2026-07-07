import markUrl from "../assets/marblo-mark.svg";

/**
 * Full-screen brand loading state: the Marblo mark sits still in the center
 * while a ring rotates around it. Replaces the bare border spinner on the auth
 * init / projects-hydration gates so the first thing a user sees while the app
 * boots is the logo, not an anonymous grey circle.
 *
 * The mark itself already draws a static ring; the animated arc here is a
 * slightly larger, separate ring so the logo reads as the fixed anchor and the
 * motion clearly belongs to "loading", not the brand.
 */
export function BrandLoader({ label }: { label?: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-900">
      <div className="text-center">
        <div className="relative mx-auto h-20 w-20">
          {/* Soft glow behind the mark so it feels lit, not pasted on. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-blue-500/10 blur-xl"
          />
          {/* Rotating ring — an open arc (only top/right borders colored) so the
              rotation is legible. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-blue-400/90 border-r-blue-400/40"
            style={{ animationDuration: "1.1s" }}
          />
          {/* The still logo, centered inside the ring. */}
          <img
            src={markUrl}
            alt="Marblo"
            className="absolute inset-0 m-auto h-12 w-12 rounded-2xl"
            draggable={false}
          />
        </div>
        {label && <p className="mt-4 text-sm text-gray-400">{label}</p>}
      </div>
    </div>
  );
}
