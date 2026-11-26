// Local only. Credentials are read at runtime and never included in output or URLs printed to logs.
const results = {};
async function probe(name, key, url, headers = {}) {
  if (!key) return results[name] = { status: 'not-run', reason: 'Required environment variable is missing' };
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    const body = await response.json();
    results[name] = { status: response.ok && !body.error && !['REQUEST_DENIED', 'INVALID_REQUEST'].includes(body.status) ? 'accessible' : 'failed', httpStatus: response.status };
    if (name === 'apinex' && response.ok) results[name].models = (body.data || []).map(m => ({ id: m.id, owned_by: m.owned_by }));
    if (name === 'geocoding') results[name].apiStatus = body.status;
  } catch { results[name] = { status: 'failed', reason: 'Network request or response decoding failed' }; }
}
const mapsKey = process.env.GOOGLE_MAPS_KEY, apinexKey = process.env.APINEX_API_KEY;
await Promise.all([
  probe('apinex', apinexKey, 'https://api.apinex.bond/v1/models', { Authorization: `Bearer ${apinexKey}` }),
  probe('geocoding', mapsKey, 'https://maps.googleapis.com/maps/api/geocode/json?address=Jacksonville%20City%20Hall%20Florida&key=' + encodeURIComponent(mapsKey || '')),
  probe('solar', mapsKey, 'https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=30.3322&location.longitude=-81.6557&requiredQuality=HIGH&key=' + encodeURIComponent(mapsKey || ''))
]);
console.log(JSON.stringify(results, null, 2));
