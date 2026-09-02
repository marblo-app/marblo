import Link from "next/link";
import { resolveHeroCta, type HeroCtaAuthState } from "./heroCtaLogic";

export interface HeroCtaViewProps {
  state: HeroCtaAuthState;
  locale: string;
  signupLabel: string;
  downloadLabel: string;
  className?: string;
}

/**
 * Presentational half of the hero CTA — a pure function of the already
 * resolved auth state, with no Firebase import in its dependency graph. Kept
 * separate from `HeroCta.tsx`'s live subscription so it can be rendered with
 * `renderToStaticMarkup` for all three states (pending/anon/authed) in tests.
 */
export default function HeroCtaView({
  state,
  locale,
  signupLabel,
  downloadLabel,
  className,
}: HeroCtaViewProps) {
  const { href, label, pending } = resolveHeroCta(state, locale, {
    signup: signupLabel,
    download: downloadLabel,
  });

  return (
    <Link
      href={href}
      aria-busy={pending}
      className={pending ? `${className ?? ""} invisible` : className}
    >
      {label}
    </Link>
  );
}
