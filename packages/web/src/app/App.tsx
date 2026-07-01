import { useMemo, useState } from 'react';
import { detectCapabilities, receiveTier } from '../lib/capabilities';
import { CapabilityBanner } from './CapabilityBanner';
import { ModeSwitch, type Mode } from './ModeSwitch';
import { SendPanel } from '../features/send/SendPanel';
import { ReceivePanel } from '../features/receive/ReceivePanel';

export function App() {
  const caps = useMemo(() => detectCapabilities(), []);
  const tier = receiveTier(caps);
  const [mode, setMode] = useState<Mode>('send');

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__brand">shareIt</h1>
        <p className="app__tagline">Send files browser-to-browser. No accounts, no uploads.</p>
      </header>

      <CapabilityBanner tier={tier} />

      {tier !== 'unsupported' && (
        <section className="app__panel">
          <ModeSwitch mode={mode} onChange={setMode} />
          {mode === 'send' ? <SendPanel /> : <ReceivePanel tier={tier} />}
        </section>
      )}

      <footer className="app__footer">
        <span>End-to-end encrypted · peer-to-peer · nothing stored on our servers</span>
      </footer>
    </main>
  );
}
