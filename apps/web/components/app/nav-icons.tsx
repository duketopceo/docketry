// 16px rail icons; decorative (labels sit beside them). Glyphs come from
// the Phosphor facade — see components/app/icons.ts.
import { NAV_ICONS } from "./icons";

export function NavIcon({ name, size = 16 }: { name: string; size?: number }) {
  const Glyph = NAV_ICONS[name as keyof typeof NAV_ICONS] ?? NAV_ICONS.issues;
  return <Glyph size={size} aria-hidden className="shrink-0" />;
}
