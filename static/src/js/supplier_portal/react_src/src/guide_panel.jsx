/* global React, Icon, Btn, Imgph */

// Contextual right-side guidance panel — changes based on current route
const GUIDE_CONTENT = {
  overview: {
    label: 'Guía',
    title: 'Tu llenado en 4 etapas',
    sub: 'Te recomendamos seguir este orden. Si necesitas saltar a otra sección, también puedes.',
    steps: [
      { num: 1, title: 'Datos generales', body: 'Una sola vez al inicio. Identificación de la Proforma y puerto destino.' },
      { num: 2, title: 'Embarques', body: 'Crea uno o varios. Cada uno con logística, B/L, invoices, contenedores y packing.' },
      { num: 3, title: 'Documentos', body: 'Sube certificados de calidad y otros papeles generales.' },
      { num: 4, title: 'Revisar y enviar', body: 'Última verificación y notificación a SOM GROUP.' },
    ],
  },
  globals: {
    label: 'Guía',
    title: 'Datos de la Proforma',
    sub: 'Esta sección define identidad y ruta. Si no sabes algo, pregunta a tu agente o déjalo vacío y vuelve después.',
    steps: [
      { num: 1, title: 'Número de Proforma', body: 'Es el ID que tu sistema usa. Suele comenzar con "PI-".' },
      { num: 2, title: 'Notas', body: 'Observaciones generales, si aplican.' },
    ],
    illustration: 'mapa de ruta',
  },
  shipments: {
    label: 'Guía',
    title: 'Embarques',
    sub: 'Un embarque = un viaje. Puedes dividir la PO en varios embarques si la producción sale en fechas distintas.',
    steps: [
      { num: 1, title: 'Agrega un embarque', body: 'Hazlo en cuanto tengas la naviera o vuelo asignado.' },
      { num: 2, title: 'Llena las 5 secciones', body: 'Logística, B/L, invoices, contenedores y packing list.' },
      { num: 3, title: 'Sube documentos', body: 'Certificado de origen, fitosanitario, etc.' },
    ],
  },
  shipment: {
    label: 'Guía del embarque',
    title: 'Captura por pestañas',
    sub: 'Sigue las pestañas de izquierda a derecha. El packing list es lo más detallado — déjalo para el final.',
    steps: [
      { num: 1, title: 'Logística + B/L', body: 'Naviera, fecha de salida (ETD) y el documento B/L.' },
      { num: 2, title: 'Invoices', body: 'Factura(s) comercial(es). Puede ser una global o varias parciales.' },
      { num: 3, title: 'Contenedores', body: 'Los números físicos pintados en cada contenedor.' },
      { num: 4, title: 'Packing list', body: 'Asistente paso a paso. Captura placa por placa.' },
      { num: 5, title: 'Documentos', body: 'CO, fitosanitario, inspección.' },
    ],
  },
  documents: {
    label: 'Guía',
    title: 'Documentos generales',
    sub: 'Documentos que aplican a toda la Proforma. Acepta PDF, JPG, PNG hasta 10 MB.',
    steps: [
      { num: 1, title: 'Proforma firmada', body: 'La que enviaste a SOM GROUP con firma.' },
      { num: 2, title: 'Certificados de calidad', body: 'Pruebas técnicas: mineralogía, densidad, absorción.' },
      { num: 3, title: 'Fotos del producto', body: 'Catálogo o muestras a granel.' },
    ],
  },
  review: {
    label: 'Antes de enviar',
    title: 'Verifica todo',
    sub: 'Una vez marcada como completa, SOM GROUP recibe una notificación. Si después necesitas editar, pídeselo a tu contacto.',
    steps: [
      { num: 1, title: 'Resumen general', body: 'Datos clave que se enviarán.' },
      { num: 2, title: 'Checklist por sección', body: 'Si algo está en ámbar, vuelve a esa sección.' },
      { num: 3, title: 'Marcar como completa', body: 'Solo se habilita cuando todo está en verde.' },
    ],
  },
};

const GuidePanel = ({ route, onClose }) => {
  const key = route.section === 'shipment' ? 'shipment' : route.section;
  const content = GUIDE_CONTENT[key] || GUIDE_CONTENT.overview;

  return (
    <aside className="guide">
      <div className="guide-head">
        <span className="label">{content.label}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Ocultar guía">
          <Icon name="x" size={14}/>
        </button>
      </div>

      <div>
        <h3>{content.title}</h3>
        <p className="sub">{content.sub}</p>
      </div>

      <div className="guide-illustration">
        <img
          src="/stock_lot_packing_import/static/src/img/ilusttraci%C3%B3n.png"
          alt={content.illustration || 'ilustración guía'}
          style={{width: '100%', height: '100%', objectFit: 'contain'}}
        />
      </div>

      <div className="guide-steps">
        {content.steps.map((s, i) => (
          <div key={s.num} className={`guide-step ${i === 0 ? 'active' : ''}`}>
            <span className="num">{s.num}</span>
            <div className="body">
              <strong>{s.title}</strong>
              {s.body}
            </div>
          </div>
        ))}
      </div>

      <div style={{marginTop: 'auto'}}/>
    </aside>
  );
};

window.GuidePanel = GuidePanel;
