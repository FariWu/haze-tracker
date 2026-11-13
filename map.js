/* Simplified map of Singapore split into the five NEA regions.
 * Coordinates are approximate [longitude, latitude] pairs, drawn for recognisability, not survey accuracy.
 */
'use strict';

const MAP_LON0 = 103.58;
const MAP_LON1 = 104.07;
const MAP_LAT0 = 1.195;
const MAP_LAT1 = 1.48;
const MAP_K = 1600; // pixels per degree
const MAP_W = Math.round((MAP_LON1 - MAP_LON0) * MAP_K);
const MAP_H = Math.round((MAP_LAT1 - MAP_LAT0) * MAP_K);

// Main island, clockwise from the western tip.
const MAP_ISLAND = [
  [103.618, 1.300], [103.622, 1.322], [103.640, 1.340], [103.655, 1.362], [103.672, 1.385],
  [103.690, 1.420], [103.705, 1.432], [103.735, 1.435], [103.760, 1.447], [103.775, 1.449],
  [103.800, 1.462], [103.830, 1.470], [103.850, 1.452], [103.875, 1.447], [103.895, 1.428],
  [103.915, 1.412], [103.935, 1.400], [103.955, 1.385], [103.980, 1.388], [104.005, 1.390],
  [104.030, 1.367], [104.040, 1.348], [104.025, 1.325], [103.995, 1.315], [103.960, 1.303],
  [103.930, 1.295], [103.900, 1.287], [103.875, 1.282], [103.860, 1.268], [103.835, 1.262],
  [103.810, 1.262], [103.780, 1.268], [103.755, 1.272], [103.730, 1.285], [103.700, 1.290],
  [103.670, 1.282], [103.640, 1.275], [103.620, 1.285],
];

// Smaller islands.
const MAP_ISLETS = [
  [[103.815, 1.255], [103.835, 1.250], [103.857, 1.248], [103.850, 1.238], [103.820, 1.241]], // Sentosa
  [[103.945, 1.425], [103.990, 1.422], [104.000, 1.410], [103.960, 1.405]], // Pulau Ubin
  [[103.668, 1.262], [103.705, 1.265], [103.708, 1.248], [103.672, 1.243]], // Jurong Island
];

// Region areas (they tile the map without overlapping). All are clipped to land.
const MAP_REGION_AREAS = {
  central: [[103.74, 1.37], [103.775, 1.355], [103.90, 1.355], [103.90, 1.30], [103.85, 1.305],
    [103.78, 1.30], [103.765, 1.272], [103.745, 1.335]],
  west: [[103.55, 1.37], [103.74, 1.37], [103.745, 1.335], [103.765, 1.272], [103.775, 1.15], [103.55, 1.15]],
  north: [[103.55, 1.55], [103.55, 1.37], [103.74, 1.37], [103.775, 1.355], [103.90, 1.355], [103.90, 1.55]],
  east: [[103.90, 1.55], [103.90, 1.15], [104.10, 1.15], [104.10, 1.55]],
  south: [[103.765, 1.272], [103.78, 1.30], [103.85, 1.305], [103.90, 1.30], [103.90, 1.15], [103.775, 1.15]],
};

const MAP_LABEL_POS = {
  west: [103.682, 1.327],
  north: [103.815, 1.412],
  east: [103.975, 1.352],
  central: [103.832, 1.335],
  south: [103.835, 1.283],
};

function mapXY(p) {
  return [(p[0] - MAP_LON0) * MAP_K, (MAP_LAT1 - p[1]) * MAP_K];
}

function mapPath(pts) {
  return 'M' + pts.map((p) => mapXY(p).map((n) => n.toFixed(1)).join(' ')).join('L') + 'Z';
}

function mapSvgMarkup() {
  const land = [MAP_ISLAND].concat(MAP_ISLETS).map(mapPath);
  const order = ['central', 'west', 'north', 'east', 'south'];
  const regions = order
    .map((r) =>
      '<path class="map-region" data-region="' + r + '" tabindex="0" role="button" d="' +
      mapPath(MAP_REGION_AREAS[r]) + '"></path>')
    .join('');
  const labels = Object.keys(MAP_LABEL_POS)
    .map((r) => {
      const [x, y] = mapXY(MAP_LABEL_POS[r]);
      return (
        '<g class="map-label" data-label="' + r + '" transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')">' +
        '<text class="map-name" y="-6" text-anchor="middle">' + r.charAt(0).toUpperCase() + r.slice(1) + '</text>' +
        '<text class="map-val" y="26" text-anchor="middle">–</text></g>'
      );
    })
    .join('');
  return (
    '<svg viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" xmlns="http://www.w3.org/2000/svg" ' +
    'role="group" aria-label="Map of Singapore by region">' +
    '<defs><clipPath id="map-land">' + land.map((d) => '<path d="' + d + '"/>').join('') + '</clipPath></defs>' +
    '<rect class="map-sea" width="' + MAP_W + '" height="' + MAP_H + '" rx="18"></rect>' +
    '<g clip-path="url(#map-land)">' + regions + '</g>' +
    land.map((d) => '<path class="map-outline" d="' + d + '"></path>').join('') +
    labels +
    '</svg>'
  );
}
