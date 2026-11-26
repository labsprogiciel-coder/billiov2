import './SampleInvoice.css';

/**
 * An example invoice for the public pages, with what Billio puts on every
 * invoice highlighted. The companies are made up. `compact` leaves the client
 * block out (sign-in page).
 */
export default function SampleInvoice({ compact = false }: { compact?: boolean }) {
  return (
    <div className="si" role="img" aria-label="Exemple de facture : l’IFU du vendeur, le numéro FAC-2026-0042 et la TVA à 18 % sont mis en évidence.">
      <div className="si-top" aria-hidden="true">
        <div>
          <div className="si-seller">Sahel Conseil SARL</div>
          <div className="si-meta">Secteur 15, Ouagadougou<br /><span className="si-hl">IFU 00012345 A</span>{!compact && <> · RCCM BF OUA 2024 B 1234</>}</div>
        </div>
        <div className="si-doc">
          <div className="si-doc-title">FACTURE</div>
          <div className="si-doc-num"><span className="si-hl">FAC-2026-0042</span></div>
          <div className="si-meta">12 novembre 2026</div>
        </div>
      </div>
      {!compact && (
        <div className="si-client" aria-hidden="true">
          <b>Faso Bâtiment SA</b><br />Avenue Kwame Nkrumah, Ouagadougou · IFU 00067890 B
        </div>
      )}
      <div className="si-lines" aria-hidden="true">
        <div className="si-row si-row--head"><span>Désignation</span><span>Montant HT</span></div>
        <div className="si-row"><span>Audit comptable, exercice 2025</span><span className="si-num">450 000</span></div>
        <div className="si-row"><span>Formation de l’équipe, 2 jours</span><span className="si-num">150 000</span></div>
      </div>
      <div className="si-totals" aria-hidden="true">
        <div className="si-total"><span>Total HT</span><span className="si-num">600 000</span></div>
        <div className="si-total"><span><span className="si-hl">TVA 18 %</span></span><span className="si-num">108 000</span></div>
        <div className="si-total si-total--ttc"><span>Total TTC</span><span className="si-num">708 000 F CFA</span></div>
      </div>
    </div>
  );
}
