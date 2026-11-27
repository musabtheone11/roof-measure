import {createHash} from 'node:crypto';

export function propertySplit(propertyGroup, salt) {
  if (typeof propertyGroup !== 'string' || !propertyGroup.trim() || typeof salt !== 'string' || !salt.trim())
    throw new Error('Canonical property identity and frozen dataset salt are required');
  const n = createHash('sha256').update(`${salt}\0${propertyGroup.trim().normalize('NFKC').toLowerCase()}`).digest().readUInt32BE(0) / 2 ** 32;
  return n < .7 ? 'development' : n < .85 ? 'validation' : 'holdout';
}
export function buildReferenceManifest(records, {salt, datasetRevision}) {
  if (!Array.isArray(records) || !datasetRevision) throw new Error('Versioned reference records are required');
  const hashes = new Map(), groups = new Map();
  return {schemaVersion: 1, datasetRevision, records: records.map(r => {
    if (!r || !/^[a-f0-9]{64}$/.test(r.hash) || typeof r.propertyGroup !== 'string' || !r.propertyGroup.trim())
      throw new Error('Unresolved property identity must be quarantined');
    const group = r.propertyGroup.trim().normalize('NFKC').toLowerCase();
    if (hashes.has(r.hash) && hashes.get(r.hash) !== group) throw new Error('Duplicate content crosses property groups; reconcile before splitting');
    hashes.set(r.hash, group);
    const split = propertySplit(group, salt);
    if (r.split && r.split !== split) throw new Error('Existing split conflicts; dataset revision must be rebuilt');
    groups.set(group, split);
    const verified = r.referenceTier === 'independently-verified';
    if (verified && (!r.truthEvidenceHash || !/^[a-f0-9]{64}$/.test(r.truthEvidenceHash) || !r.reviewer ||
        !r.sourceDate || !r.scope || !r.units || !r.rights)) throw new Error('Verified reference requires independent truth, reviewer, date, scope, units and rights');
    return {hash: r.hash, propertyGroup: group, split, referenceTier: verified ? r.referenceTier : 'source-claim',
      truthEvidenceHash: r.truthEvidenceHash || null, reviewer: r.reviewer || null, sourceDate: r.sourceDate || null,
      scope: r.scope || null, units: r.units || null, rights: r.rights || null};
  })};
}
export function resolveAgentArtifacts(manifest, role, hashes, readArtifact, {isolatedVerification = false} = {}) {
  if (!Array.isArray(hashes) || hashes.length > 50) throw new Error('Artifact limit');
  const resolved = [];
  for (const hash of hashes) {
    const record = manifest.records.find(r => r.hash === hash);
    if (!record) throw new Error('Artifact absent from versioned dataset');
    if (record.split === 'holdout' && (role !== 'verification' || !isolatedVerification))
      throw new Error('Holdout access requires isolated verification worker');
    if (['engineering', 'critique'].includes(role) && record.split !== 'development') throw new Error('Author/critic inputs are development-only');
    resolved.push({hash, bytes: readArtifact(hash)});
  }
  return resolved;
}
