// Shared Navigation / Header Helper Structure for CFLIX screens
const CFLIX_LOGO_SVG = `<svg viewBox="0 0 124 44" aria-hidden="true"><defs><path id="arc-nav" d="M4 38 Q62 10 120 38"/></defs><text><textPath href="#arc-nav" startOffset="50%" text-anchor="middle">CFLIX</textPath></text></svg>`;

window.CFlixNav = {
  logoSvg: CFLIX_LOGO_SVG,
  renderLogo(className = 'nav__logo') {
    return `<div class="${className}">${CFLIX_LOGO_SVG}</div>`;
  },
  renderLinks(links = [], activeIndex = 0) {
    return `<div class="nav__links">` + links.map((l, i) => `
      <a class="nav__link${i === activeIndex ? ' nav__link--active' : ''}" href="${l.href || '#'}">${l.label}</a>
    &#8203;`.trim()).join('') + `</div>`;
  }
};
