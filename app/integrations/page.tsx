import Link from "next/link";
import { Activity, ArrowLeft, CheckCircle2, CircleDashed, KeyRound, RadioTower, ShieldCheck } from "lucide-react";
import { integrationSnapshot, type IntegrationState } from "../../src/lib/integration-catalog";
import "./integrations.css";

export const dynamic = "force-dynamic";

const stateLabels: Record<IntegrationState, string> = {
  live: "Live",
  partial: "Partial",
  ready: "Ready",
  "needs-key": "Needs key",
  conditional: "Conditional",
  "native-only": "Native-only",
  planned: "Planned",
};

const categoryOrder = [
  "Maps & venue intelligence",
  "Platform",
  "Events & calendars",
  "Environment & mobility",
  "Community signals",
  "Growth & sharing",
  "AI & agents",
  "Operations",
] as const;

export default function IntegrationsPage() {
  const integrations = integrationSnapshot();
  const live = integrations.filter(item => item.state === "live").length;
  const building = integrations.filter(item => ["partial", "ready"].includes(item.state)).length;
  const blocked = integrations.filter(item => item.state === "needs-key").length;

  return (
    <main className="integration-page">
      <header className="integration-hero">
        <div className="integration-nav">
          <Link href="/" className="integration-back"><ArrowLeft /> Back to Buzz</Link>
          <Link href="/health" className="integration-health-link"><Activity /> View live provider health</Link>
        </div>
        <div className="integration-kicker"><RadioTower /> BUZZ SYSTEMS</div>
        <h1>Integration control center</h1>
        <p>One source of truth for every map, event, mobility, community, growth, AI, and operations integration in LIT757 / Buzz.</p>
        <div className="integration-summary">
          <div><strong>{integrations.length}</strong><span>Total integrations</span></div>
          <div><strong>{live}</strong><span>Live</span></div>
          <div><strong>{building}</strong><span>Partial or ready</span></div>
          <div><strong>{blocked}</strong><span>Waiting on keys</span></div>
        </div>
        <div className="integration-truth"><ShieldCheck /><span>Discovery and forecast-context sources never mark a venue Live without direct or verified evidence.</span></div>
      </header>

      <div className="integration-groups">
        {categoryOrder.map(category => {
          const items = integrations.filter(item => item.category === category);
          return (
            <section key={category} className="integration-group">
              <header><div><small>INTEGRATION GROUP</small><h2>{category}</h2></div><span>{items.length}</span></header>
              <div className="integration-grid">
                {items.map(item => (
                  <article key={item.id} className={`integration-card state-${item.state}`}>
                    <div className="integration-card-top">
                      <span className="integration-state">
                        {item.state === "live" ? <CheckCircle2 /> : item.state === "needs-key" ? <KeyRound /> : <CircleDashed />}
                        {stateLabels[item.state]}
                      </span>
                      <span className="integration-role">{item.role.replace("-", " ")}</span>
                    </div>
                    <h3>{item.name}</h3>
                    <p>{item.detail}</p>
                    {item.env?.length ? (
                      <footer>
                        <span className={item.configured ? "configured" : "not-configured"}>{item.configured ? "Configured" : "Configuration pending"}</span>
                        <code>{item.env.join(" · ")}</code>
                      </footer>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
