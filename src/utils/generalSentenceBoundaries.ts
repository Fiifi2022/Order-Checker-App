// Periods in names, titles and clinical abbreviations are not sentence endings.
// Only punctuation handling is shared here; no identities are inferred.
const abbreviation = '(?:st|dr|mr|mrs|ms|prof|rev|sr|jr|mt|inj|tab|cap|susp|soln)';
export const GENERAL_SENTENCE_BREAK_SOURCE = `(?<!\\b${abbreviation}\\.)(?<!\\b[a-z]\\.)(?<=[.!?])\\s+(?=[a-z])`;
export const GENERAL_SENTENCE_BREAK = new RegExp(GENERAL_SENTENCE_BREAK_SOURCE, 'gi');
export const GENERAL_IDENTITY_PERIOD_SOURCE = `(?<!\\b${abbreviation})(?<!\\b[a-z])\\.(?=\\s|$)`;
