/* global React, Icon */

// Tooltip with optional visual example
const HelpTip = ({ children, example, align = 'left' }) => {
  return (
    <span className={`tt-wrap ${align === 'right' ? 'right' : ''}`} tabIndex={0}>
      <span className="help-trig" aria-label="Ayuda">?</span>
      <span className="tt" role="tooltip">
        {children}
        {example && <span className="tt-example">{example}</span>}
      </span>
    </span>
  );
};

// Form field wrapper
const Field = ({
  label, required, optional, help, helpExample,
  hint, error, warn, ok, msg, msgLevel,
  children, full, className = ''
}) => {
  const level = error ? 'error' : warn ? 'warn' : ok ? 'ok' : null;
  return (
    <div className={`fld ${full ? 'fld-full' : ''} ${level ? 'is-' + level : ''} ${className}`}>
      {label && (
        <label className="fld-label">
          {label}
          {required && <span className="req" aria-label="obligatorio">*</span>}
          {optional && <span className="opt">opcional</span>}
          {help && <HelpTip example={helpExample}>{help}</HelpTip>}
        </label>
      )}
      {children}
      {error && <span className="fld-msg error"><Icon name="alert" size={13}/> {error}</span>}
      {warn && !error && <span className="fld-msg warn"><Icon name="alert" size={13}/> {warn}</span>}
      {ok && !error && !warn && <span className="fld-msg ok"><Icon name="check" size={13}/> {ok}</span>}
      {hint && !error && !warn && !ok && <span className="fld-msg hint">{hint}</span>}
    </div>
  );
};

// Fuerza mayúsculas en cualquier campo de texto: transforma el valor (para que se
// guarde en mayúsculas) y conserva la posición del cursor para no estorbar al teclear.
const forceUpper = (onChange) => (e) => {
  const el = e.target;
  const pos = el.selectionStart;
  el.value = el.value.toUpperCase();
  try { el.setSelectionRange(pos, pos); } catch (_) {}
  if (onChange) onChange(e);
};
const Input = ({ onChange, style, type, mono, className, ...p }) => {
  const isText = !type || type === 'text' || type === 'search' || type === 'tel';
  return <input
    type={type}
    className={`input ${mono ? 'mono' : ''} ${className || ''}`}
    style={isText ? Object.assign({ textTransform: 'uppercase' }, style || {}) : style}
    onChange={(isText && onChange) ? forceUpper(onChange) : onChange}
    {...p} />;
};
const Select = ({ children, className = '', ...p }) => <select className={`select ${className}`} {...p}>{children}</select>;
const Textarea = ({ onChange, style, className, ...p }) => <textarea
  className={`textarea ${className || ''}`}
  style={Object.assign({ textTransform: 'uppercase' }, style || {})}
  onChange={onChange ? forceUpper(onChange) : onChange}
  {...p} />;

const Badge = ({ tone = 'draft', children, dot }) => (
  <span className={`badge ${tone}`}>
    {dot && <span className="dot"/>}
    {children}
  </span>
);

// Big circular progress (used in hero + sidebar)
const ProgressRing = ({ pct = 0, size = 140, stroke = 10, label }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return (
    <div className={size > 80 ? 'hero-ring' : 'progress-ring'} style={size > 80 ? { width: size, height: size } : null}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={stroke} className="track"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={stroke} className="fill"
                strokeDasharray={`${c - offset} ${c}`} strokeLinecap="round"/>
      </svg>
      <div className="pct">
        {size > 80 ? (
          <React.Fragment>
            <span className="big">{pct}%</span>
            <span className="small">{label || 'completo'}</span>
          </React.Fragment>
        ) : (
          <span>{pct}%</span>
        )}
      </div>
    </div>
  );
};

const Callout = ({ tone = 'info', icon, title, children, onClose }) => (
  <div className={`callout ${tone}`}>
    <div className="ico"><Icon name={icon || (tone === 'warn' ? 'alert' : tone === 'ok' ? 'check' : tone === 'error' ? 'alert' : 'info')} size={16}/></div>
    <div className="body">
      {title && <strong>{title}</strong>}
      <p>{children}</p>
    </div>
    {onClose && <button className="close" onClick={onClose} aria-label="Cerrar"><Icon name="x" size={14}/></button>}
  </div>
);

const Empty = ({ icon = 'box', title, children, action }) => (
  <div className="empty">
    <div className="e-icon"><Icon name={icon} size={24}/></div>
    <h4>{title}</h4>
    {children && <p>{children}</p>}
    {action}
  </div>
);

const Imgph = ({ children, style }) => (
  <div className="imgph" style={style}>{children || 'imagen'}</div>
);

const StatusDot = ({ status = 'todo', label }) => {
  const map = {
    done: { icon: 'check', cls: 'done' },
    partial: { icon: 'minus', cls: 'partial' },
    todo: { icon: 'plus', cls: 'todo' },
    error: { icon: 'alert', cls: 'error' },
  };
  const it = map[status] || map.todo;
  return <span className={`status-dot ${it.cls}`} aria-label={label || status}><Icon name={it.icon} size={10}/></span>;
};

// Standalone button used a lot
const Btn = ({ variant = 'secondary', size, icon, iconRight, children, className = '', ...rest }) => (
  <button className={`btn btn-${variant} ${size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : ''} ${className}`} {...rest}>
    {icon && <Icon name={icon} size={14}/>}
    {children}
    {iconRight && <Icon name={iconRight} size={14}/>}
  </button>
);

Object.assign(window, { HelpTip, Field, Input, Select, Textarea, Badge, ProgressRing, Callout, Empty, Imgph, StatusDot, Btn });
