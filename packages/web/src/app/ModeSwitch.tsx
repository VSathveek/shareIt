export type Mode = 'send' | 'receive';

interface Props {
  mode: Mode;
  onChange: (mode: Mode) => void;
}

export function ModeSwitch({ mode, onChange }: Props) {
  return (
    <div className="mode-switch" role="tablist" aria-label="Transfer mode">
      {(['send', 'receive'] as const).map((m) => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          className={`mode-switch__tab${mode === m ? ' is-active' : ''}`}
          onClick={() => onChange(m)}
        >
          {m === 'send' ? 'Send' : 'Receive'}
        </button>
      ))}
    </div>
  );
}
