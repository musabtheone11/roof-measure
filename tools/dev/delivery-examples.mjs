// Build public, invented report fixtures; never substitute them for real-property accuracy checks.
// node tools/dev/delivery-examples.mjs [output directory]
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const out = path.resolve(process.argv[2] || path.join(root, '.devcache/delivery/jobs'));
fs.mkdirSync(out, { recursive: true });
const base = JSON.parse(fs.readFileSync(path.join(root, 'examples/residential-study.json')));
const save = (name, job) => { job.jobName = name; job.address = name + ', illustrative geometry'; job.source.addressLine1 = name; job.source.addressLine2 = 'Illustrative geometry — not a property measurement'; job.source.notes = ['Invented geometry for report validation. No aerial imagery or independent property reference.']; fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(job, null, 2)); };
const simple = structuredClone(base);
simple.facets = simple.facets.filter(f => f.structure === 2).map((f,i) => ({...f, structure:1, name:'F'+(i+1)}));
simple.edges = simple.edges.filter(e => e.structure === 2).map(e => ({...e, structure:1}));
simple.source.buildingNames = {1:'Gable study'};
save('simple-gable', simple);
save('complex-mixed-pitch', structuredClone(base));
const obstructed = structuredClone(base);
obstructed.facets[0].status = 'unresolved';
obstructed.facets[0].pitchUnknown = true;
obstructed.facets[0].areaUnsupported = true;
obstructed.facets[0].missing = 'Illustrated tree canopy hides F1. Dated georeferenced imagery of the same roof configuration, calibrated drone data or field measurements must establish its boundary and pitch.';
obstructed.edges[0].type = 'obstruction';
obstructed.edges[0].status = 'unresolved';
obstructed.edges[0].missing = 'Visibility ends at canopy; this is not an eave.';
obstructed.facets[1].status = 'inferred';
obstructed.facets[1].note = 'Illustrative continuation estimate; not field verified.';
save('tree-obstructed-review', obstructed);
console.log('Illustrative saved jobs written to ' + out);
