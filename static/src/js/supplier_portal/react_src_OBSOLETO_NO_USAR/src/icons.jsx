/* global React */
// Inline SVG icons — kept simple, geometric only
const Icon = ({ name, size = 16, stroke = 1.6, ...rest }) => {
  const s = size;
  const common = {
    width: s, height: s, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: stroke,
    strokeLinecap: 'round', strokeLinejoin: 'round',
    ...rest,
  };
  const P = {
    check:   <path d="M5 12.5L10 17l9-10"/>,
    x:       <path d="M6 6l12 12M18 6L6 18"/>,
    plus:    <path d="M12 5v14M5 12h14"/>,
    minus:   <path d="M5 12h14"/>,
    chevron_right: <path d="M9 6l6 6-6 6"/>,
    chevron_left:  <path d="M15 6l-6 6 6 6"/>,
    chevron_down:  <path d="M6 9l6 6 6-6"/>,
    arrow_right:   <path d="M5 12h14M13 6l6 6-6 6"/>,
    arrow_left:    <path d="M19 12H5M11 6l-6 6 6 6"/>,
    arrow_up:      <path d="M12 19V5M6 11l6-6 6 6"/>,
    cube:    <g><path d="M12 3l9 5v8l-9 5-9-5V8z"/><path d="M3 8l9 5 9-5M12 13v10"/></g>,
    ship:    <g><path d="M3 17l9 4 9-4M5 10l7-4 7 4v6l-7 3-7-3z"/><path d="M12 6V2"/></g>,
    box:     <g><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M9 6V3h6v3"/></g>,
    file:    <g><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></g>,
    doc_lines: <g><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></g>,
    invoice: <g><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></g>,
    container: <g><rect x="3" y="6" width="18" height="12" rx="1"/><path d="M7 6v12M11 6v12M15 6v12M19 6v12"/></g>,
    truck: <g><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></g>,
    globe: <g><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></g>,
    image: <g><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.7"/><path d="M21 16l-5-5-9 9"/></g>,
    camera: <g><path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></g>,
    upload: <g><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v13"/></g>,
    save: <g><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M7 3v6h8V3M7 21v-8h10v8"/></g>,
    download: <g><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></g>,
    info: <g><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></g>,
    help: <g><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 4 2c-.8.5-1.5 1-1.5 2"/><path d="M12 17h.01"/></g>,
    bell: <g><path d="M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16zM10 21a2 2 0 0 0 4 0"/></g>,
    home: <g><path d="M3 11l9-8 9 8M5 10v10h14V10"/></g>,
    list: <g><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></g>,
    grid: <g><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></g>,
    settings: <g><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></g>,
    calendar: <g><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></g>,
    pencil: <g><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></g>,
    trash: <g><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></g>,
    eye: <g><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></g>,
    alert: <g><path d="M12 2L1 21h22z"/><path d="M12 9v5M12 18h.01"/></g>,
    sparkles: <g><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7z"/></g>,
    play: <path d="M6 4l14 8-14 8z"/>,
    menu: <path d="M3 6h18M3 12h18M3 18h18"/>,
    panel_right: <g><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M14 3v18"/></g>,
    package: <g><path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/></g>,
    location: <g><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></g>,
    anchor: <g><circle cx="12" cy="5" r="2"/><path d="M12 7v15M5 16a7 7 0 0 0 14 0M3 16h4M17 16h4"/></g>,
    bookmark: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>,
    flag: <g><path d="M4 21V4M4 4h12l-2 4 2 4H4"/></g>,
    prop_one: <g><path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14" strokeOpacity="0.5"/></g>,
    prop_all: <g><path d="M12 3v7"/><path d="M7 7l5 5 5-5"/><path d="M7 14l5 5 5-5"/></g>,
    arrow_down: <path d="M12 5v14M6 13l6 6 6-6"/>,
  };
  return <svg {...common}>{P[name] || P.info}</svg>;
};

window.Icon = Icon;
