// Conservative literal candidates, never verified measurements or truth labels.
export function normalizeSourceClaims(extraction, sourceHash) {
  const candidates = [], issues = [];
  const amount = '(?<![\\d.,+−-])(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?(?![\\d.,])';
  for (const page of extraction.pages || []) for (const observation of page.observations || []) {
    const literal = observation.literal || '';
    if (/[-−+]\d|\d\.\d{3},\d|\d,\d{1,2}(?:\s|$)/.test(literal))
      issues.push({page: page.page, code: 'UNSUPPORTED_SIGN_OR_NUMERIC_LOCALE', literal});
    const patterns = [
      ['area', new RegExp(`(${amount})\\s*(sq\\.?\\s*ft\\.?|square feet|ft²|sqft|m²|sq\\.?\\s*m\\.?)`, 'gi')],
      ['length', new RegExp(`(${amount})\\s*(linear feet|lin\\.?\\s*ft\\.?|lf|feet|ft(?!²|\\^2)|meters)\\b`, 'gi')],
      ['squares', new RegExp(`(${amount})\\s*(squares)\\b`, 'gi')],
      ['pitch', /\b(\d+(?:\.\d+)?)\s*(?:\/|:)\s*(12)\b/g],
      ['date', /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/g],
      ['provider', /\b(Roofr|EagleView|HOVER)\b/gi],
    ];
    for (const [kind, pattern] of patterns) for (const match of literal.matchAll(pattern)) {
      candidates.push({kind, literal: match[0], value: ['date', 'provider'].includes(kind) ? match[1] : Number(match[1].replaceAll(',', '')),
        unit: match[2] || null, sourceHash, page: page.page, region: observation.transform || null,
        status: 'source-reported', verified: false});
    }
    if (/\b(?:roof area|pitch|ridge|eave|valley)\b/i.test(literal) && /\b[OIl]\d|\d[OIl]\b/.test(literal))
      issues.push({page: page.page, code: 'POSSIBLE_OCR_DIGIT_AMBIGUITY', literal});
  }
  if (!candidates.length) issues.push({code: 'NO_LITERAL_MEASUREMENTS', message: 'Scanned/image-only or unsupported report requires authorized OCR and source review'});
  return {schemaVersion: 1, sourceHash, parserVersion: 'literal-v1', candidates, issues,
    propertyGroup: null, referenceTier: 'source-claim', requiresHumanReview: true};
}
