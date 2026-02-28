import { useMemo, useState } from "react";

type WizardPayload = {
  mt5Folder: string;
  fredApiKey: string;
  topPairsText: string;
};

type Props = {
  onSubmit: (payload: { mt5_folder: string; fred_api_key: string; top_pairs: string[] }) => Promise<void>;
};

const WIZARD_STEPS = [
  { id: 1, label: "MT5 Folder" },
  { id: 2, label: "FRED Key" },
  { id: 3, label: "Top Pairs" },
] as const;

export function WizardPage({ onSubmit }: Props) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<WizardPayload>({
    mt5Folder: "",
    fredApiKey: "",
    topPairsText: "EURUSD,USDJPY,GBPUSD,AUDUSD,USDCAD",
  });

  const topPairs = useMemo(
    () =>
      state.topPairsText
        .split(",")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    [state.topPairsText],
  );

  const canContinue = step === 1 ? state.mt5Folder.trim().length > 0 : true;

  async function finish() {
    setSaving(true);
    try {
      await onSubmit({
        mt5_folder: state.mt5Folder.trim(),
        fred_api_key: state.fredApiKey.trim(),
        top_pairs: topPairs,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="wizard wizard-page-shell">
      <div className="wizard-deck">
        <header className="wizard-header-row">
          <div>
            <h1>First Launch Setup</h1>
            <p className="muted wizard-card-help">Configure data source, macro key, and starter symbols.</p>
          </div>
          <span className="wizard-step-chip active" aria-label={`Step ${step} of 3`}>
            Step {step} of 3
          </span>
        </header>

        <div className="wizard-stepper" role="tablist" aria-label="Wizard steps">
          {WIZARD_STEPS.map((item) => {
            const stateClass = step === item.id ? "active" : step > item.id ? "done" : "pending";
            return (
              <span key={item.id} className={`wizard-step-chip ${stateClass}`}>
                {item.id}. {item.label}
              </span>
            );
          })}
        </div>

        {step === 1 && (
          <div className="panel wizard-card">
            <h2 className="wizard-card-title">1) MT5 Data Folder</h2>
            <p className="muted wizard-card-help">Point to your MT5 common files location for ingest and auto-fetch flows.</p>
            <div className="wizard-input-grid">
              <input className="control-field" value={state.mt5Folder}
                onChange={(e) => setState((s) => ({ ...s, mt5Folder: e.target.value }))}
                placeholder="C:\\Users\\...\\MetaQuotes\\...\\data"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="panel wizard-card">
            <h2 className="wizard-card-title">2) FRED API Key (Optional)</h2>
            <p className="muted wizard-card-help">Leave blank to keep macro modules disabled while all other modules remain operational.</p>
            <div className="wizard-input-grid">
              <input className="control-field" value={state.fredApiKey}
                onChange={(e) => setState((s) => ({ ...s, fredApiKey: e.target.value }))}
                placeholder="Leave blank to disable macro modules"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="panel wizard-card">
            <h2 className="wizard-card-title">3) Confirm Top Pairs</h2>
            <p className="muted wizard-card-help">Comma-separated pairs. You can edit this later in the app.</p>
            <div className="wizard-input-grid">
              <textarea className="control-field" value={state.topPairsText}
                onChange={(e) => setState((s) => ({ ...s, topPairsText: e.target.value }))}
                rows={5}
              />
            </div>
          </div>
        )}

        <div className="row wizard-actions">
          <button
            type="button"
            className="btn btn-secondary ui-interactive ui-hover-lift wizard-btn wizard-btn-secondary"
            disabled={step <= 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            Back
          </button>
          {step < 3 ? (
            <button
              type="button"
              className="btn btn-primary ui-interactive ui-hover-lift wizard-btn wizard-btn-primary"
              disabled={!canContinue}
              onClick={() => setStep((s) => Math.min(3, s + 1))}
            >
              Next
            </button>
          ) : (
            <button type="button" className="btn btn-primary ui-interactive ui-hover-lift wizard-btn wizard-btn-primary" disabled={saving} onClick={finish}>
              {saving ? "Saving..." : "Finish Setup"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
