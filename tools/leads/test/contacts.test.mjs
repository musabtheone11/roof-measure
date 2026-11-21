import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { loadContactSources, matchPhone, normPhone } from '../lib/contacts.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leads-contacts-'));
const write = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };
const crm = write('crm.csv', [
  'ParcelID,Street,Zip,Last,Phone,DNC',
  'P1,10 OAK DR,32068,DOE,904-555-0123,',
  'P2,20 ELM ST,32068,ROE,(904) 555-0200,',
  'P2,20 ELM ST,32068,ROE,904.555.0201,',
  ',30 PINE RD,32068,SMITH,9045550300,',
  ',40 BAY LN,32068,JONES,904 555 0400,Y',
  ',50 ASH CT,32068,BROWN,555-0500,',
].join('\n'));
const idx = loadContactSources([{ file: crm, name: 'Company CRM', columns: { parcel_id: 'ParcelID', address: 'Street', zip: 'Zip', last_name: 'Last', phone: 'Phone', opt_out: 'DNC' } }]);
const row = (o) => ({ parcel_id: 'PX', property_address: '99 NONE ST', zip: '32068', owner_of_record: 'DOE JOHN', ...o });

test('normPhone', () => {
  assert.equal(normPhone('904-555-0123'), '(904) 555-0123'); assert.equal(normPhone('1 904 555 0123'), '(904) 555-0123');
  assert.equal(normPhone('555-0500'), ''); assert.equal(normPhone(''), '');
});
test('exact parcel match', () => {
  const m = matchPhone(row({ parcel_id: 'P1' }), idx);
  assert.deepEqual([m.phone, m.phone_source, m.match_confidence], ['(904) 555-0123', 'Company CRM', 'exact_parcel']);
});
test('two different numbers on one parcel are ambiguous', () => {
  const m = matchPhone(row({ parcel_id: 'P2', owner_of_record: 'ROE ANN' }), idx);
  assert.equal(m.phone, ''); assert.ok(m.notes.includes('ambiguous_phone'));
});
test('address plus owner last name', () => {
  const m = matchPhone(row({ property_address: '30 PINE ROAD', owner_of_record: 'SMITH MARY & JOE' }), idx);
  assert.deepEqual([m.phone, m.match_confidence], ['(904) 555-0300', 'address_name']);
});
test('address only leaves phone blank', () => {
  const m = matchPhone(row({ property_address: '30 PINE RD', owner_of_record: 'NEWOWNER LLC' }), idx);
  assert.equal(m.phone, ''); assert.equal(m.match_confidence, 'address_only');
});
test('opt-out sets do_not_contact and keeps phone', () => {
  const m = matchPhone(row({ property_address: '40 BAY LN', owner_of_record: 'JONES PAT' }), idx);
  assert.equal(m.outreach_status, 'do_not_contact'); assert.equal(m.phone, '(904) 555-0400');
});
test('invalid number dropped', () => {
  const m = matchPhone(row({ property_address: '50 ASH CT', owner_of_record: 'BROWN AL' }), idx);
  assert.equal(m.phone, ''); assert.ok(m.notes.includes('invalid_phone'));
});
test('no sources gives blanks', () => {
  const m = matchPhone(row({ parcel_id: 'P1' }), loadContactSources([]));
  assert.deepEqual([m.phone, m.phone_source, m.match_confidence, m.outreach_status], ['', '', '', '']);
});
