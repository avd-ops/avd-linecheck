const hostPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const reservedSuffixes = ['localhost', 'local', 'localdomain', 'internal', 'test', 'invalid', 'example', 'example.com', 'example.net', 'example.org', 'example.edu', 'arpa', 'home.arpa', 'onion', 'lan'];
const reservedIds = new Set(['site.origin', 'target-region', 'jitter.primary', 'slow-samples', 'stalls.primary', 'download', 'loaded-latency', 'upload', 'udp', 'session-transport', 'session-host', 'wildcard-endpoints', 'dns', 'packet-loss', 'vantage']);

function endpointById(endpointMap) {
  return new Map(endpointMap.endpoints.map((endpoint) => [endpoint.id, endpoint]));
}

export function validatePack(pack, endpointMap, regions) {
  if (endpointMap.schema !== 'avd-assess-endpoints/v1') throw new TypeError('Endpoint map schema is unsupported');
  if (!pack || !/^[a-z][a-z0-9-]*$/.test(pack.id) || !Array.isArray(pack.endpointIds) || !Array.isArray(pack.hosts)) {
    throw new TypeError('Pack needs an id, endpoint list, and host list');
  }
  const allowed = new Set(endpointMap.views?.browser?.probe ?? []);
  const endpoints = endpointById(endpointMap);
  const seen = new Set();
  for (const id of pack.endpointIds) {
    if (seen.has(id) || !allowed.has(id)) throw new TypeError(`Endpoint is not in the browser probe map: ${id}`);
    seen.add(id);
    const endpoint = endpoints.get(id);
    if (!endpoint || endpoint.kind !== 'fqdn' || endpoint.protocol !== 'tcp' || endpoint.port !== 443 ||
        !endpoint.probeFrom?.includes('browser') || !hostPattern.test(endpoint.host)) {
      throw new TypeError(`Endpoint cannot be probed by the browser: ${id}`);
    }
  }
  const hostIds = new Set();
  for (const host of pack.hosts) {
    if (!host || !/^[a-z][a-z0-9-]*$/.test(host.id) || reservedIds.has(host.id) || seen.has(host.id) || hostIds.has(host.id) ||
        !hostPattern.test(host.host) || host.port !== 443 || typeof host.required !== 'boolean' || typeof host.purpose !== 'string' || !host.purpose ||
        reservedSuffixes.some((suffix) => host.host === suffix || host.host.endsWith(`.${suffix}`)) ||
        (host.claim !== null && host.claim !== undefined && !/^ref:[a-z0-9-]+#[a-z0-9-]+$/.test(host.claim))) {
      throw new TypeError(`Pack host is not a public HTTPS target: ${host?.id ?? 'unknown'}`);
    }
    hostIds.add(host.id);
  }
  if (pack.regionalProbe && regions !== undefined && (!Array.isArray(regions) || regions.length === 0 ||
      regions.some((region) => !/^[a-z0-9]+$/.test(region.id) || !region.name || !region.geo))) {
    throw new TypeError('Regional probes need named public regions');
  }
  if (!Array.isArray(pack.thresholds)) throw new TypeError('Pack thresholds must be a list');
  if (pack.thresholds.length && !pack.thresholds[pack.thresholds.length - 1].otherwise) throw new TypeError('Thresholds need an otherwise band');
  for (const band of pack.thresholds) {
    if (!band.claim || !['pass', 'warn', 'fail'].includes(band.state ?? band.otherwise)) {
      throw new TypeError('Every threshold needs a state and claim');
    }
  }
  return true;
}

export function regionalHost(regionMap, region) {
  if (regionMap.hostTemplate !== '{region}.api.cognitive.microsoft.com' || !/^[a-z0-9]+$/.test(region.id)) {
    throw new TypeError('Regional host is not in the pinned public map');
  }
  return regionMap.hostTemplate.replace('{region}', region.id);
}

export function connectOrigins(packs, endpointMap, regionMap) {
  const endpoints = endpointById(endpointMap);
  const origins = new Set();
  for (const pack of packs) {
    validatePack(pack, endpointMap, regionMap.regions);
    for (const id of pack.endpointIds) origins.add(`https://${endpoints.get(id).host}`);
    for (const host of pack.hosts) origins.add(`https://${host.host}`);
    if (pack.regionalProbe) {
      for (const region of regionMap.regions) origins.add(`https://${regionalHost(regionMap, region)}`);
    }
  }
  return [...origins].sort();
}

export function probeTargets(pack, endpointMap) {
  validatePack(pack, endpointMap);
  const endpoints = endpointById(endpointMap);
  const mapped = pack.endpointIds.map((id) => {
    const endpoint = endpoints.get(id);
    return {
      id,
      host: endpoint.host,
      purpose: endpoint.purpose,
      required: endpoint.verdict === 'required',
      claim: endpoint.source.claim
    };
  });
  return [...mapped, ...pack.hosts.map((host) => ({ id: host.id, ...host }))];
}

export function selectRegions(regions, geographies, targetId = '') {
  const selectedGeographies = new Set(geographies);
  const selectedIds = new Set(regions.filter((region) => selectedGeographies.has(region.geo)).map((region) => region.id));
  if (regions.some((region) => region.id === targetId)) selectedIds.add(targetId);
  return regions.filter((region) => selectedIds.has(region.id));
}
