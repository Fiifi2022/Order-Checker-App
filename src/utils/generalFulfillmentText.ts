const count = '\\d+(?:\\.\\d+)?';
const bracketCount = `\\[\\s*${count}(?:\\s*\\/\\s*${count})?\\s*\\]`;
// A dash before a status is an annotation on the current product, not a new item.
const stockAnnotation = '(?:(?:currently|partially)\\s+)?(?:out\\s+of\\s+stock|unavailable|oos|order[ -]limit)\\b';
const nextProduct = `[-–—•][ \\t]+(?!${stockAnnotation})[^\\n\\[\\]]+${bracketCount}`;
const boundary = new RegExp(`(${bracketCount})[ \\t]+(?=(?:${nextProduct}|Expected\\s+delivery\\s*:|Let\\s+us\\s+know\\b|You\\s+will\\s+receive\\b|Please\\s+reach\\s+out\\b))`, 'gi');

/** Split only inline FS template boundaries. Existing line numbers, clinical
 * punctuation, counts, stock annotations and unknown instructions stay intact. */
export function projectGeneralFulfillmentSections(text:string):string {
 return text.split(/\r?\n/).map(line=>line
  .replace(/(\bwe\s+(?:will\s+now|can)\s+prepare\s+the\s+following\s+items(?:\s+we\s+have\s+in\s+stock)?\s+for\s+delivery\s*:)[ \t]*(?=\S)/gi,'$1\n')
  .replace(/(^|[ \t]+)((?:we\s+are\s+)?(?:currently\s+)?(?:partially\s+)?out\s+of\s+stock\s+for\s+(?:the\s+)?following\s+(?:items|products)\s*:)[ \t]*(?=\S)/gi,
   (_whole,prefix:string,heading:string,offset:number)=>(offset>0 || prefix.trim() ? '\n' : '')+heading+'\n')
  .replace(boundary,'$1\n')
 ).join('\n');
}
