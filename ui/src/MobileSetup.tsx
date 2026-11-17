import { useState } from "react";
import { Icon } from "./App";
import { inMobileApp, mobileHost, mobileLink, testFlightLink, type MobileStatus } from "./mobile";

const PHONE = "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM11 18h2";

export function MobileSetupButton({ mobile, open }: { mobile: MobileStatus; open(): void }) {
  if (mobile.configured || inMobileApp()) return null;
  return <button className="btn-icon mobile-setup-button" aria-label="Set up iPhone app" title="Set up iPhone app" onClick={open}><Icon d={PHONE} size={16} /></button>;
}

export function MobileSetup({ mobile }: { mobile: MobileStatus }) {
  const [host, setHost] = useState(() => mobileHost(location.origin) ?? "");
  const invite = testFlightLink(mobile.testFlightUrl);
  const link = mobileLink(host);
  return (
    <section className="host-card mobile-setup" aria-label="iPhone app">
      <div className="row"><Icon d={PHONE} size={18} /><h2>Switchyard for iPhone</h2><span className="spacer" /><span className="muted small">{mobile.configured ? "Connected" : "TestFlight beta"}</span></div>
      <p>Your sessions, editor, voice mode and workspace, together on your phone.</p>
      <ol className="login-steps">
        <li>{invite ? <a className="btn btn-primary login-open" href={invite} target="_blank" rel="noreferrer">Install with TestFlight</a> : <><strong>Install with TestFlight.</strong> <span className="muted">The beta invitation will appear here when the first build is available.</span></>}</li>
        <li>Connect your iPhone to the same private network as this host, such as Tailscale.</li>
        <li><label htmlFor="mobile-host">Enter your host’s HTTPS address in the iPhone app.</label>
          <input id="mobile-host" className="field" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://your-host.ts.net" value={host} onChange={(e) => setHost(e.target.value)} />
          {host && !link && <p className="warn small">Use an HTTPS origin reachable from your phone, without a path or login. Localhost points to the phone itself.</p>}
          {link && <a className="btn login-open" href={link}>Open in Switchyard on this iPhone</a>}
        </li>
      </ol>
      <p className="muted small">{mobile.configured ? "An iPhone has connected to this host. You can set up another one here anytime." : "The phone icon stays in new sessions until the app connects successfully."}</p>
      {!link && <p className="muted small">Use your existing private HTTPS host. Desktop SSH tunnels are local to the desktop; the phone needs an address it can reach.</p>}
    </section>
  );
}
