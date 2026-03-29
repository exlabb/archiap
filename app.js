/*
  ==========================================================================
  CONFIGURATION PRINCIPALE
  ==========================================================================

  1) Modifier le centre et le zoom par défaut : DEFAULT_VIEW
  2) Modifier la couche de tuiles (fond de carte) : TILE_LAYER_CONFIG
  3) Modifier / ajouter / renommer les catégories : CATEGORY_CONFIG
  4) Modifier le comportement global du widget : MAP_BEHAVIOR

  Les données des lieux sont stockées séparément dans locations.json
  pour éviter de toucher à la logique applicative.
*/

const DEFAULT_VIEW = {
  center: [35.6764, 139.6993],
  zoom: 12,
};

const TILE_LAYER_CONFIG = {
  // Fond OpenStreetMap simple et sans clé API.
  // Remplacez l'URL ci-dessous si vous préférez un autre fournisseur.
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  options: {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  },
};

const CATEGORY_CONFIG = [
  { value: 'architecture', label: 'Architecture' },
  { value: 'interiors', label: 'Intérieurs' },
  { value: 'museum', label: 'Musée' },
  { value: 'hotel', label: 'Hôtel' },
  { value: 'cafe', label: 'Café' },
  { value: 'shop', label: 'Boutique' },
  { value: 'landmark', label: 'Repère' },
];

const MAP_BEHAVIOR = {
  fitBoundsPadding: [36, 36],
  maxFitZoom: 16,
  openPopupZoom: 16,
  showOnlyViewportResultsInList: true,
  fallbackDataUrl: './locations.json',
};

const appState = {
  map: null,
  clusterGroup: null,
  allLocations: [],
  filteredLocations: [],
  visibleLocations: [],
  markersById: new Map(),
  activeCategories: new Set(CATEGORY_CONFIG.map((item) => item.value)),
  searchTerm: '',
};

const rootElement = document.querySelector('[data-map-widget]');

const elements = {
  map: document.getElementById('map'),
  categoryFilters: document.getElementById('categoryFilters'),
  resultsList: document.getElementById('resultsList'),
  resultsCount: document.getElementById('resultsCount'),
  emptyState: document.getElementById('emptyState'),
  searchInput: document.getElementById('searchInput'),
  fitBoundsButton: document.getElementById('fitBoundsButton'),
  resetFiltersButton: document.getElementById('resetFiltersButton'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function getCategoryLabel(categoryValue) {
  const match = CATEGORY_CONFIG.find((item) => item.value === categoryValue);
  return match ? match.label : categoryValue;
}

function sortLocations(locations) {
  return [...locations].sort((a, b) => {
    if (Boolean(a.featured) !== Boolean(b.featured)) {
      return a.featured ? -1 : 1;
    }
    return a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' });
  });
}

function locationSearchBlob(location) {
  return normalizeText([
    location.title,
    location.architect,
    location.cityOrArea,
    location.shortDescription,
    ...(Array.isArray(location.tags) ? location.tags : []),
  ].filter(Boolean).join(' '));
}

function matchesSearch(location, searchTerm) {
  if (!searchTerm) return true;
  return locationSearchBlob(location).includes(searchTerm);
}

function matchesCategory(location) {
  return appState.activeCategories.has(location.category);
}

function createPopupHtml(location) {
  const imageHtml = location.imageUrl
    ? `<img class="popup-card__image" src="${escapeHtml(location.imageUrl)}" alt="${escapeHtml(location.title)}" loading="lazy" />`
    : '';

  const architectMeta = location.architect ? `Architecte : ${escapeHtml(location.architect)}` : '';
  const yearMeta = location.year ? `Année : ${escapeHtml(location.year)}` : '';
  const metaParts = [architectMeta, yearMeta, location.cityOrArea ? `Quartier : ${escapeHtml(location.cityOrArea)}` : '']
    .filter(Boolean)
    .join(' · ');

  const externalLink = location.websiteUrl
    ? `<a class="popup-card__link" href="${escapeHtml(location.websiteUrl)}" target="_blank" rel="noopener noreferrer">Voir le site</a>`
    : '';

  const featuredBadge = location.featured
    ? '<span class="badge badge--featured">Sélection</span>'
    : '';

  return `
    <article class="popup-card">
      ${imageHtml}
      <div class="popup-card__body">
        <div class="popup-card__topline">
          <span class="badge">${escapeHtml(getCategoryLabel(location.category))}</span>
          ${featuredBadge}
        </div>
        <h3 class="popup-card__title">${escapeHtml(location.title)}</h3>
        ${metaParts ? `<p class="popup-card__meta">${metaParts}</p>` : ''}
        <p class="popup-card__excerpt">${escapeHtml(location.shortDescription || '')}</p>
        ${externalLink ? `<div class="popup-card__footer">${externalLink}</div>` : ''}
      </div>
    </article>
  `;
}

function createMarker(location) {
  const marker = L.marker([location.latitude, location.longitude], {
    title: location.title,
    alt: location.title,
    riseOnHover: true,
    keyboard: true,
  });

  marker.bindPopup(createPopupHtml(location), {
    maxWidth: 320,
    closeButton: true,
    autoPanPaddingTopLeft: [24, 24],
    autoPanPaddingBottomRight: [24, 24],
  });

  marker.locationId = location.id;
  return marker;
}

function buildCategoryFilters() {
  const fragment = document.createDocumentFragment();

  const allButton = document.createElement('button');
  allButton.type = 'button';
  allButton.className = 'filter-pill is-active';
  allButton.dataset.filter = 'all';
  allButton.setAttribute('aria-pressed', 'true');
  allButton.textContent = 'Toutes';
  fragment.appendChild(allButton);

  CATEGORY_CONFIG.forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-pill is-active';
    button.dataset.filter = category.value;
    button.setAttribute('aria-pressed', 'true');
    button.textContent = category.label;
    fragment.appendChild(button);
  });

  elements.categoryFilters.innerHTML = '';
  elements.categoryFilters.appendChild(fragment);

  elements.categoryFilters.addEventListener('click', (event) => {
    const button = event.target.closest('.filter-pill');
    if (!button) return;

    const filterValue = button.dataset.filter;

    if (filterValue === 'all') {
      const shouldEnableAll = appState.activeCategories.size !== CATEGORY_CONFIG.length;
      appState.activeCategories = new Set(
        shouldEnableAll ? CATEGORY_CONFIG.map((item) => item.value) : []
      );
    } else {
      if (appState.activeCategories.has(filterValue)) {
        appState.activeCategories.delete(filterValue);
      } else {
        appState.activeCategories.add(filterValue);
      }
    }

    syncFilterButtonStates();
    applyFilters({ fitBounds: true });
  });
}

function syncFilterButtonStates() {
  const isAllActive = appState.activeCategories.size === CATEGORY_CONFIG.length;

  elements.categoryFilters.querySelectorAll('.filter-pill').forEach((button) => {
    const filterValue = button.dataset.filter;
    const isActive = filterValue === 'all'
      ? isAllActive
      : appState.activeCategories.has(filterValue);

    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function buildMap() {
  appState.map = L.map(elements.map, {
    zoomControl: true,
    scrollWheelZoom: true,
    preferCanvas: true,
  }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

  L.tileLayer(TILE_LAYER_CONFIG.url, TILE_LAYER_CONFIG.options).addTo(appState.map);

  appState.clusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    removeOutsideVisibleBounds: true,
    chunkedLoading: true,
    maxClusterRadius: 50,
  });

  appState.clusterGroup.addTo(appState.map);

  appState.map.on('moveend zoomend', () => {
    renderVisibleResultsList();
    updateResultsCount();
  });

  appState.map.whenReady(() => {
    appState.map.invalidateSize();
  });

  if (window.ResizeObserver) {
    const resizeObserver = new ResizeObserver(() => {
      appState.map.invalidateSize();
    });
    resizeObserver.observe(elements.map);
  } else {
    window.addEventListener('resize', () => appState.map.invalidateSize());
  }
}

async function loadLocations() {
  const dataUrl = rootElement?.dataset.locationsUrl || MAP_BEHAVIOR.fallbackDataUrl;
  const response = await fetch(dataUrl, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Impossible de charger les données (${response.status}).`);
  }

  const payload = await response.json();
  const rawLocations = Array.isArray(payload) ? payload : payload.locations;

  if (!Array.isArray(rawLocations)) {
    throw new Error('Le fichier locations.json doit contenir un tableau ou un objet avec une clé "locations".');
  }

  return rawLocations
    .filter((location) => Number.isFinite(location.latitude) && Number.isFinite(location.longitude))
    .map((location) => ({
      ...location,
      tags: Array.isArray(location.tags) ? location.tags : [],
    }));
}

function rebuildMarkers() {
  appState.clusterGroup.clearLayers();
  appState.markersById.clear();

  appState.filteredLocations.forEach((location) => {
    const marker = createMarker(location);
    appState.markersById.set(location.id, marker);
    appState.clusterGroup.addLayer(marker);
  });
}

function getFilteredLocations() {
  const normalizedSearch = normalizeText(appState.searchTerm);

  return sortLocations(
    appState.allLocations.filter((location) => {
      return matchesCategory(location) && matchesSearch(location, normalizedSearch);
    })
  );
}

function getLocationsInViewport() {
  if (!appState.map || !MAP_BEHAVIOR.showOnlyViewportResultsInList) {
    return appState.filteredLocations;
  }

  const bounds = appState.map.getBounds();

  return appState.filteredLocations.filter((location) => {
    return bounds.contains([location.latitude, location.longitude]);
  });
}

function renderVisibleResultsList() {
  appState.visibleLocations = getLocationsInViewport();
  elements.resultsList.innerHTML = '';

  if (appState.visibleLocations.length === 0) {
    const hasAnyFilteredResults = appState.filteredLocations.length > 0;
    elements.emptyState.classList.remove('hidden');
    elements.emptyState.innerHTML = hasAnyFilteredResults
      ? '<strong>Aucun lieu dans le cadrage actuel</strong><span>Déplacez la carte ou cliquez sur “Ajuster la vue”.</span>'
      : '<strong>Aucun résultat</strong><span>Essayez une autre recherche ou activez d\'autres catégories.</span>';
    return;
  }

  elements.emptyState.classList.add('hidden');

  const fragment = document.createDocumentFragment();

  appState.visibleLocations.forEach((location) => {
    const item = document.createElement('li');
    item.className = 'result-card';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-card__button';
    button.dataset.locationId = location.id;
    button.setAttribute('aria-label', `Ouvrir ${location.title}`);

    const imageUrl = location.imageUrl || `https://picsum.photos/seed/${encodeURIComponent(location.id)}/320/240`;
    const metaParts = [
      getCategoryLabel(location.category),
      location.cityOrArea,
      location.architect,
    ].filter(Boolean);

    button.innerHTML = `
      <img class="result-card__image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(location.title)}" loading="lazy" />
      <div class="result-card__body">
        <div class="result-card__topline">
          <span class="badge">${escapeHtml(getCategoryLabel(location.category))}</span>
          ${location.featured ? '<span class="badge badge--featured">Sélection</span>' : ''}
        </div>
        <h3 class="result-card__title">${escapeHtml(location.title)}</h3>
        ${metaParts.length ? `<p class="result-card__meta">${escapeHtml(metaParts.join(' · '))}</p>` : ''}
        <p class="result-card__excerpt">${escapeHtml(location.shortDescription || '')}</p>
      </div>
    `;

    button.addEventListener('click', () => focusLocation(location.id));
    item.appendChild(button);
    fragment.appendChild(item);
  });

  elements.resultsList.appendChild(fragment);
}

function updateResultsCount() {
  const total = appState.filteredLocations.length;
  const visible = appState.visibleLocations.length;

  if (MAP_BEHAVIOR.showOnlyViewportResultsInList) {
    elements.resultsCount.textContent = `${visible} visible${visible > 1 ? 's' : ''} · ${total} résultat${total > 1 ? 's' : ''}`;
    return;
  }

  elements.resultsCount.textContent = `${total} résultat${total > 1 ? 's' : ''}`;
}

function fitMapToFilteredResults() {
  if (!appState.filteredLocations.length || !appState.map) return;

  const bounds = L.latLngBounds(
    appState.filteredLocations.map((location) => [location.latitude, location.longitude])
  );

  appState.map.fitBounds(bounds, {
    padding: MAP_BEHAVIOR.fitBoundsPadding,
    maxZoom: MAP_BEHAVIOR.maxFitZoom,
  });
}

function focusLocation(locationId) {
  const location = appState.filteredLocations.find((item) => item.id === locationId);
  const marker = appState.markersById.get(locationId);

  if (!location || !marker) return;

  appState.map.setView([location.latitude, location.longitude], Math.max(appState.map.getZoom(), MAP_BEHAVIOR.openPopupZoom), {
    animate: true,
  });

  window.setTimeout(() => marker.openPopup(), 220);
}

function applyFilters({ fitBounds = false } = {}) {
  appState.filteredLocations = getFilteredLocations();
  rebuildMarkers();

  if (fitBounds && appState.filteredLocations.length) {
    fitMapToFilteredResults();
  }

  renderVisibleResultsList();
  updateResultsCount();
}

function resetFilters() {
  appState.activeCategories = new Set(CATEGORY_CONFIG.map((item) => item.value));
  appState.searchTerm = '';
  elements.searchInput.value = '';
  syncFilterButtonStates();
  applyFilters({ fitBounds: true });
}

function bindUiEvents() {
  elements.searchInput.addEventListener('input', (event) => {
    appState.searchTerm = event.target.value || '';
    applyFilters({ fitBounds: true });
  });

  elements.fitBoundsButton.addEventListener('click', () => {
    fitMapToFilteredResults();
  });

  elements.resetFiltersButton.addEventListener('click', resetFilters);
}

function renderError(message) {
  elements.resultsCount.textContent = 'Erreur';
  elements.emptyState.classList.remove('hidden');
  elements.emptyState.innerHTML = `<strong>Chargement impossible</strong><span>${escapeHtml(message)}</span>`;
}

async function init() {
  try {
    buildCategoryFilters();
    buildMap();
    bindUiEvents();

    appState.allLocations = await loadLocations();
    applyFilters({ fitBounds: true });

    if (!appState.filteredLocations.length) {
      appState.map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
    }
  } catch (error) {
    console.error(error);
    renderError(error.message || 'Une erreur inconnue est survenue.');
  }
}

if (rootElement && elements.map) {
  init();
} else {
  console.warn('Map widget non initialisé : conteneur introuvable.');
}
