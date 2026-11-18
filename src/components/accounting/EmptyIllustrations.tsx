/** Custom SVG illustrations for accounting empty states. */

/** Open journal with blank ruled pages + pen — Journals table */
export function JournalsEmptyIllustration({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden="true">
      {/* left page */}
      <rect x="6" y="14" width="36" height="52" rx="3" fill="#EEF2FF" stroke="#818CF8" strokeWidth="1.5"/>
      {/* right page */}
      <rect x="54" y="14" width="36" height="52" rx="3" fill="#EEF2FF" stroke="#818CF8" strokeWidth="1.5"/>
      {/* spine shadow */}
      <rect x="40" y="14" width="16" height="52" rx="2" fill="#C7D2FE" stroke="#818CF8" strokeWidth="1.5"/>
      {/* ring holes */}
      {[22, 32, 42, 54].map(y => (
        <circle key={y} cx="48" cy={y} r="2.5" fill="white" stroke="#818CF8" strokeWidth="1"/>
      ))}
      {/* left page — dashed empty lines */}
      {[26, 34, 42, 50].map(y => (
        <line key={y} x1="14" y1={y} x2="34" y2={y} stroke="#C7D2FE" strokeWidth="1.5" strokeDasharray="4 3" strokeLinecap="round"/>
      ))}
      {/* right page — dashed empty lines */}
      {[26, 34, 42, 50].map(y => (
        <line key={y} x1="62" y1={y} x2="82" y2={y} stroke="#C7D2FE" strokeWidth="1.5" strokeDasharray="4 3" strokeLinecap="round"/>
      ))}
      {/* pen body */}
      <rect x="58" y="68" width="6" height="22" rx="2" transform="rotate(-40 58 68)" fill="#FDE68A" stroke="#F59E0B" strokeWidth="1.5"/>
      {/* pen tip */}
      <path d="M70 79 L73 84 L67 82 Z" fill="#F59E0B"/>
      {/* pen clip */}
      <line x1="60" y1="69" x2="65" y2="62" stroke="#F59E0B" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}

/** Stacked account cards with magnifying glass — Chart of accounts search empty */
export function ChartOfAccountsEmptyIllustration({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden="true">
      {/* card stack back */}
      <rect x="14" y="22" width="52" height="40" rx="4" fill="#E0E7FF" stroke="#818CF8" strokeWidth="1.5" strokeDasharray="5 3"/>
      {/* card stack middle */}
      <rect x="10" y="18" width="52" height="40" rx="4" fill="#EEF2FF" stroke="#818CF8" strokeWidth="1.5"/>
      {/* card front */}
      <rect x="6" y="14" width="52" height="40" rx="4" fill="white" stroke="#6366F1" strokeWidth="1.5"/>
      {/* front card content lines */}
      <rect x="14" y="22" width="8" height="8" rx="1.5" fill="#E0E7FF" stroke="#818CF8" strokeWidth="1"/>
      <line x1="26" y1="24" x2="48" y2="24" stroke="#C7D2FE" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="26" y1="28" x2="42" y2="28" stroke="#E0E7FF" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="14" y1="36" x2="48" y2="36" stroke="#E0E7FF" strokeWidth="1.5" strokeDasharray="3 2" strokeLinecap="round"/>
      <line x1="14" y1="42" x2="38" y2="42" stroke="#E0E7FF" strokeWidth="1.5" strokeDasharray="3 2" strokeLinecap="round"/>
      <line x1="14" y1="48" x2="44" y2="48" stroke="#E0E7FF" strokeWidth="1.5" strokeDasharray="3 2" strokeLinecap="round"/>
      {/* magnifying glass circle */}
      <circle cx="66" cy="62" r="18" fill="white" stroke="#6366F1" strokeWidth="2"/>
      <circle cx="66" cy="62" r="12" fill="#EEF2FF" stroke="#818CF8" strokeWidth="1.5"/>
      {/* question mark inside lens */}
      <path d="M62.5 58.5 C62.5 56 64 55 66 55 C68 55 69.5 56.5 69.5 58.5 C69.5 60.5 67.5 61 66 62.5" stroke="#6366F1" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="66" cy="66" r="1.2" fill="#6366F1"/>
      {/* handle */}
      <line x1="77" y1="73" x2="84" y2="80" stroke="#6366F1" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}

/** Building facade with empty shelves — Fixed assets table */
export function FixedAssetsEmptyIllustration({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden="true">
      {/* ground */}
      <line x1="8" y1="84" x2="88" y2="84" stroke="#C7D2FE" strokeWidth="1.5" strokeLinecap="round"/>
      {/* building body */}
      <rect x="16" y="32" width="64" height="52" rx="2" fill="#EEF2FF" stroke="#818CF8" strokeWidth="1.5"/>
      {/* roof triangle */}
      <path d="M10 34 L48 10 L86 34" fill="#E0E7FF" stroke="#818CF8" strokeWidth="1.5" strokeLinejoin="round"/>
      {/* roof ridge */}
      <line x1="48" y1="10" x2="48" y2="14" stroke="#818CF8" strokeWidth="1.5" strokeLinecap="round"/>
      {/* door */}
      <rect x="40" y="64" width="16" height="20" rx="2" fill="white" stroke="#6366F1" strokeWidth="1.5"/>
      <circle cx="54" cy="74" r="1.5" fill="#6366F1"/>
      {/* left window */}
      <rect x="22" y="44" width="16" height="12" rx="1.5" fill="white" stroke="#818CF8" strokeWidth="1.5"/>
      <line x1="30" y1="44" x2="30" y2="56" stroke="#C7D2FE" strokeWidth="1"/>
      <line x1="22" y1="50" x2="38" y2="50" stroke="#C7D2FE" strokeWidth="1"/>
      {/* right window */}
      <rect x="58" y="44" width="16" height="12" rx="1.5" fill="white" stroke="#818CF8" strokeWidth="1.5"/>
      <line x1="66" y1="44" x2="66" y2="56" stroke="#C7D2FE" strokeWidth="1"/>
      <line x1="58" y1="50" x2="74" y2="50" stroke="#C7D2FE" strokeWidth="1"/>
      {/* plus badge */}
      <circle cx="72" cy="28" r="12" fill="white" stroke="#6366F1" strokeWidth="1.5"/>
      <line x1="72" y1="22" x2="72" y2="34" stroke="#6366F1" strokeWidth="2" strokeLinecap="round"/>
      <line x1="66" y1="28" x2="78" y2="28" stroke="#6366F1" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

/** T-account with empty debit/credit columns — account ledger drawers */
export function AccountMovementsEmptyIllustration({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" fill="none" aria-hidden="true">
      {/* T horizontal bar */}
      <line x1="6" y1="20" x2="66" y2="20" stroke="#818CF8" strokeWidth="2" strokeLinecap="round"/>
      {/* T vertical bar */}
      <line x1="36" y1="20" x2="36" y2="66" stroke="#818CF8" strokeWidth="2" strokeLinecap="round"/>
      {/* D label */}
      <text x="14" y="16" fontSize="8" fontWeight="700" fill="#6366F1" fontFamily="system-ui, sans-serif" letterSpacing="0.5">DÉBIT</text>
      {/* C label */}
      <text x="42" y="16" fontSize="8" fontWeight="700" fill="#6366F1" fontFamily="system-ui, sans-serif" letterSpacing="0.5">CRÉDIT</text>
      {/* empty dash rows - left */}
      {[30, 40, 50, 60].map(y => (
        <line key={y} x1="10" y1={y} x2="28" y2={y} stroke="#E0E7FF" strokeWidth="1.5" strokeDasharray="3 2" strokeLinecap="round"/>
      ))}
      {/* empty dash rows - right */}
      {[30, 40, 50, 60].map(y => (
        <line key={y} x1="44" y1={y} x2="62" y2={y} stroke="#E0E7FF" strokeWidth="1.5" strokeDasharray="3 2" strokeLinecap="round"/>
      ))}
    </svg>
  );
}
