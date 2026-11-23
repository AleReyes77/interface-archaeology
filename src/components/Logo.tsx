/**
 * The mark: three strata of uneven depth with one excavated core — the
 * product's idea of reading an interface layer by layer.
 */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="1.5" y="3" width="17" height="3" rx="1" fill="#e7e8eb" />
      <rect x="1.5" y="8.5" width="11" height="3" rx="1" fill="#a6aab3" />
      <rect x="1.5" y="14" width="6" height="3" rx="1" fill="#737884" />
      <circle cx="15.5" cy="12.5" r="2.25" fill="#63c5b0" />
    </svg>
  );
}
