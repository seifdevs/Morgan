/** A compact, illustrative view of the four connected areas in Morgan. */
export function ProductSystem() {
  return (
    <div className="product-system" aria-label="Illustrative Morgan workspace showing Financial Core, Monitor, Horizon and Morgan Intelligence">
      <div className="ps-top"><span className="ps-mark">m</span><b>Morgan</b><span className="ps-context">Business workspace</span><span className="ps-status"><i /> Your records</span></div>
      <div className="ps-body">
        <aside className="ps-rail" aria-hidden="true"><i className="selected" /><i /><i /><i /></aside>
        <div className="ps-content">
          <div className="ps-heading"><div><small>FINANCIAL OVERVIEW</small><b>A clearer view of your business</b></div><span>Illustrative workspace</span></div>
          <div className="ps-grid">
            <section className="ps-panel ps-ledger"><small>FINANCIAL CORE</small><b>Activity, kept together</b><div className="ps-table"><span>Transaction</span><span>Category</span><span>Status</span><i /><i /><i /><i /><i /><i /></div></section>
            <section className="ps-panel ps-monitor"><small>MONITOR</small><b>Items to review</b><div className="ps-alert"><i /><span><strong>Invoice timing</strong><em>Review the saved due date</em></span><span className="ps-arrow">↗</span></div></section>
            <section className="ps-panel ps-horizon"><small>HORIZON</small><b>Recorded activity → estimate</b><svg viewBox="0 0 340 74" aria-hidden="true"><path className="ps-gridline" d="M0 16H340M0 39H340M0 62H340"/><path className="ps-solid" d="M8 55C50 48 72 32 118 39s49 11 72 3"/><path className="ps-dashed" d="M190 42c38-10 51-24 79-15s42 9 63-7"/><line className="ps-today" x1="190" y1="6" x2="190" y2="69"/></svg><div className="ps-legend"><span>Recorded</span><span>Estimate</span></div></section>
            <section className="ps-panel ps-intelligence"><small>MORGAN INTELLIGENCE</small><b>Context with the numbers</b><p>“A later payment changes the timing in this estimate. Review the invoice and its due date.”</p><em>Illustrative explanation · based on supplied records</em></section>
          </div>
        </div>
      </div>
      <div className="ps-foot"><span>One connected financial workspace</span><span>Recorded data stays distinct from estimates</span></div>
    </div>
  );
}
