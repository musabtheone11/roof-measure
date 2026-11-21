// Which office issues building permits for a parcel, and how far back its online records reach.
// Incorporated cities issue their own permits; their limits come from the Census TIGERweb "Incorporated Places" layer.
export const CITY_GEOIDS = {
  1227400: 'Green Cove Springs', 1252125: 'Orange Park', 1255875: 'Penney Farms',           // Clay
  1262500: 'St. Augustine', 1262525: 'St. Augustine Beach',                               // St. Johns
  1235050: 'Jacksonville Beach', 1202400: 'Atlantic Beach', 1248100: 'Neptune Beach', 1203250: 'Baldwin',   // Duval
};
export const CITY_PORTAL = {
  'Green Cove Springs': 'https://greencovesprings.com/180/Building-Division',
  'Orange Park': 'https://www.townoforangepark.com/171/Building-Division',
  'Penney Farms': 'https://www.townofpenneyfarms.org',
  'St. Augustine': 'https://www.citystaug.com/284/Building-Division',
  'St. Augustine Beach': 'https://www.cityofsab.org/departments/building___zoning/index.php',
  'Jacksonville Beach': 'https://www.jacksonvillebeach.org/207/Building-Inspection',
  'Atlantic Beach': 'https://www.coab.us/162/Building',
  'Neptune Beach': 'https://www.ci.neptune-beach.fl.us/building',
  Baldwin: 'https://www.townofbaldwin.com',
};
const TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query';

export async function loadCityLimits({ fetchFn = fetch } = {}) {
  const ids = Object.keys(CITY_GEOIDS).map((g) => `'${g}'`).join(',');
  const q = new URLSearchParams({ where: `GEOID IN (${ids})`, outFields: 'NAME,GEOID', returnGeometry: 'true', outSR: '4326', f: 'json' });
  const r = await fetchFn(TIGER + '?' + q); if (!r.ok) throw new Error('city limits HTTP ' + r.status);
  const j = await r.json(); if (j.error) throw new Error('city limits: ' + j.error.message);
  return (j.features || []).map((f) => ({ name: f.attributes.NAME, geoid: f.attributes.GEOID, rings: f.geometry.rings }));
}

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// polygon with holes: even-odd across all rings
const inPolygon = (pt, rings) => rings.reduce((n, r) => n + (pointInRing(pt, r) ? 1 : 0), 0) % 2 === 1;

export function jurisdictionOf(row, coNo, cities = []) {
  const pt = [row.centroid.lng, row.centroid.lat];
  const city = cities.find((c) => inPolygon(pt, c.rings));
  if (city) { const name = CITY_GEOIDS[city.geoid] || city.name; return { name, adapter: null, coverage: 'none', coverageFrom: null, portal: CITY_PORTAL[name] || '' }; }
  if (coNo === 26) return { name: 'City of Jacksonville', adapter: 'coj', coverage: 'full_history', coverageFrom: 1985, portal: 'https://jaxepics.coj.net/Search/SearchResults' };
  if (coNo === 20) return { name: 'Clay County', adapter: 'clay', coverage: 'since_2023', coverageFrom: 2023, portal: 'https://claycountyfl-energovpub.tylerhost.net/apps/selfservice' };
  if (coNo === 65) return { name: 'St. Johns County', adapter: 'stjohns', coverage: 'full_history', coverageFrom: 1970, portal: 'https://webapp.sjcfl.us/WATSWebX/Permit/SearchPermit.aspx' };
  return { name: `County ${coNo}`, adapter: null, coverage: 'none', coverageFrom: null, portal: '' };
}
