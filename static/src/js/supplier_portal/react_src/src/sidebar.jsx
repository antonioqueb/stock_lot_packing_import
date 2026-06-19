/* global React, Icon, StatusDot, ProgressRing, computeStatus, SECTIONS */

const Sidebar = ({ proforma, route, setRoute, status, mobileOpen }) => {
  const sectionMap = {
    overview:  { title: status.overall >= 100 ? 'Todo listo' : 'En proceso', desc: `${status.overall}% completado` },
  };

  const getStatus = (id) => {
    if (id === 'overview') return null;
    if (id === 'globals') return status.globals_status;
    if (id === 'shipments') return status.ship_overall;
    if (id === 'review') return status.overall >= 100 ? 'todo' : 'todo';
    return 'todo';
  };

  return (
    <aside className={`sidebar ${mobileOpen ? 'is-mobile-open' : ''}`}>
      <div className="progress-card">
        <ProgressRing pct={status.overall} size={52} stroke={5}/>
        <div className="progress-info">
          <span className="label">Progreso global</span>
          <span className="value">{status.overall}% completado</span>
          <span className="meta">{proforma.globals.proforma_number || 'PI sin número'}</span>
        </div>
      </div>

      <nav>
        <div className="nav-section-title">Llenado de la Proforma</div>
        <div className="nav-list">
          {SECTIONS.map(sec => {
            const st = getStatus(sec.id);
            const active = route.section === sec.id;
            return (
              <React.Fragment key={sec.id}>
                <button
                  className={`nav-item ${active ? 'active' : ''}`}
                  onClick={() => setRoute({ section: sec.id })}
                >
                  {st ? <StatusDot status={st}/> : <Icon name={sec.icon} size={16}/>}
                  <span>{sec.label}</span>
                  {sec.id === 'shipments' && (
                    <span className="count">{status.ship_done}/{proforma.shipments.length}</span>
                  )}
                </button>

                {/* expand shipments under the parent when active */}
                {sec.id === 'shipments' && (active || route.section === 'shipment') && (
                  <div className="nav-list" style={{ marginLeft: 0, marginBottom: 4 }}>
                    {proforma.shipments.map((s, idx) => {
                      const sst = status.shipments_status[idx];
                      const isActive = route.section === 'shipment' && route.shipmentId === s.id;
                      return (
                        <button
                          key={s.id}
                          className={`nav-item nav-child ${isActive ? 'active' : ''}`}
                          onClick={() => setRoute({ section: 'shipment', shipmentId: s.id })}
                        >
                          <StatusDot status={sst.status}/>
                          <span>Embarque #{s.number}</span>
                          <span className="count">{sst.pct}%</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </nav>

      <div style={{marginTop: 'auto'}}/>
    </aside>
  );
};

window.Sidebar = Sidebar;
