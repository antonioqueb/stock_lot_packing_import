/* global React, Icon, Btn, Imgph */

const ONBOARD_STEPS = [
  {
    title: '¡Bienvenido al portal!',
    text: 'Aquí vas a registrar los datos del embarque para SOM GROUP. Te guiaremos paso a paso. No tienes que terminar de una sola vez.',
    art: <img
      src="/stock_lot_packing_import/static/src/img/ilusttraci%C3%B3n.png"
      alt="Bienvenido al portal SOM GROUP"
      style={{maxWidth: 320, maxHeight: 220, width: '100%', height: 'auto', objectFit: 'contain'}}
    />,
  },
  {
    title: 'Tu progreso siempre visible',
    text: 'En el lado izquierdo verás el avance de cada sección con marcas visuales: verde = listo, ámbar = en progreso, gris = pendiente.',
    art: <div style={{display: 'flex', flexDirection: 'column', gap: 8, width: 280}}>
      {['Datos generales','Embarque #1','Embarque #2','Documentos'].map((l,i) => (
        <div key={l} style={{display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8}}>
          <span style={{width: 16, height: 16, borderRadius: 8, background: i < 2 ? 'var(--ok)' : i === 2 ? 'var(--warn)' : 'var(--border-strong)', display: 'grid', placeItems: 'center', color: 'white', fontSize: 9}}>
            {i < 2 ? '✓' : i === 2 ? '–' : ''}
          </span>
          <span style={{fontSize: 12}}>{l}</span>
        </div>
      ))}
    </div>,
  },
  {
    title: 'Ayuda contextual en cada campo',
    text: 'Verás un ícono "?" junto a campos que pueden ser confusos. Pásale el cursor para ver una explicación con ejemplo.',
    art: <div style={{display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: 'var(--ink)', color: 'white', borderRadius: 8, fontSize: 12, maxWidth: 320, lineHeight: 1.5}}>
      <span><strong>Incoterm:</strong> define quién paga el transporte y seguro. <br/><span style={{fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.7}}>Ej: CIF = tú pagas hasta el puerto destino</span></span>
    </div>,
  },
  {
    title: 'El packing list es asistido',
    text: 'En lugar de escribir cientos de líneas, te preguntaremos cuántos bloques cargas y cuántas placas tiene cada uno. Generamos las filas por ti.',
    art: <div style={{display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11}}>
      {['1. Productos','2. Bloques + fotos','3. Revisión','4. Llenar placas'].map((l,i) => (
        <div key={l} style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <span style={{width: 22, height: 22, borderRadius: 50, background: i === 0 ? 'var(--accent)' : 'var(--surface)', color: i === 0 ? 'white' : 'var(--ink-3)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, border: i === 0 ? '0' : '1px solid var(--border-strong)'}}>{i+1}</span>
          <span style={{fontWeight: i === 0 ? 600 : 400}}>{l}</span>
        </div>
      ))}
    </div>,
  },
  {
    title: '¿Listo para empezar?',
    text: 'Comencemos por los datos generales. Si te trabas, busca el panel de "Guía del paso actual" a la derecha — siempre te dirá qué hacer.',
    art: <Btn variant="accent" size="lg" icon="play">Iniciar llenado</Btn>,
  },
];

const Onboarding = ({ onClose }) => {
  const [step, setStep] = React.useState(0);
  const s = ONBOARD_STEPS[step];

  return (
    <div className="onboard-scrim" onClick={(e) => e.target === e.currentTarget && null}>
      <div className="onboard-card">
        <div className="ob-art">{s.art}</div>
        <div className="ob-body">
          <div className="ob-step">Paso {step + 1} de {ONBOARD_STEPS.length}</div>
          <h2>{s.title}</h2>
          <p className="ob-text">{s.text}</p>
        </div>
        <div className="ob-foot">
          <div className="ob-dots">
            {ONBOARD_STEPS.map((_, i) => <span key={i} className={`d ${i === step ? 'active' : ''}`}/>)}
          </div>
          <div style={{display: 'flex', gap: 8}}>
            {step > 0 && <Btn variant="ghost" onClick={() => setStep(step - 1)}>Atrás</Btn>}
            <Btn variant="ghost" onClick={onClose}>Saltar</Btn>
            {step < ONBOARD_STEPS.length - 1
              ? <Btn variant="primary" iconRight="arrow_right" onClick={() => setStep(step + 1)}>Siguiente</Btn>
              : <Btn variant="accent" icon="check" onClick={onClose}>Empezar</Btn>}
          </div>
        </div>
      </div>
    </div>
  );
};

window.Onboarding = Onboarding;
