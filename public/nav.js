/**
 * Shared CFLIX Navigation Helper
 * Renders consistent navbar elements and handles active tab switching across screens.
 */
export function initNavigation(container = document.querySelector('nav.nav'), activeHref = '#') {
  if (!container) return;
  const links = container.querySelectorAll('.nav__link');
  links.forEach(link => {
    if (link.getAttribute('href') === activeHref) {
      link.classList.add('nav__link--active');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const currentPath = window.location.pathname;
  initNavigation(document.querySelector('nav.nav'), currentPath);
});
