/** Website General Auditor input projection. Recognize complete FS templates
 * across copied/PDF line wraps before interpreting product lines. Only exact
 * administrative phrases are removed; neighbouring order amendments survive.
 * Original messages remain on the audit record, unchanged.
 */
const month='(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const timestamp=`${month}\\s+\\d{1,2},?\\s+\\d{4}\\s+\\d{1,2}:\\d{2}\\s+(?:AM|PM)`;
const deliveryWindow=new RegExp(`\\bExpected\\s+delivery\\s*:\\s*between\\s+${timestamp}\\s+and\\s+${timestamp}[.!]?`,'gi');
export function projectFourFieldFulfillment(text:string):string {
  return text
    // Identity words must be retained, including a wrapped person/facility name.
    .replace(/\bThank\s+you\s+[^!?]+?\s+from\s+[^!?]+?\s+for\s+ordering\s+with\s+Zipline[.!]?/gi,
      clause=>clause.replace(/\s+/g,' '))
    .replace(/\b(?:We\s+have|We've)\s+received\s+your\s+(?:Emergency\s+)?order\b(?:\s*\(\s*ID\s*:\s*[a-z0-9-]+\s*\)\]?)?[.!]?/gi,'')
    .replace(/\bWe\s+(?:will(?:\s+now)?|can)\s+prepare\s+the\s+following\s+items(?:\s+we\s+have\s+in\s+stock)?\s+for\s+delivery\s*:/gi,
      clause=>clause.replace(/\s+/g,' ').replace(/^we will prepare/i,'We will now prepare')+'\n')
    // Stock headings affect the actual product availability and must stay.
    .replace(/\b(?:We\s+are\s+)?(?:currently\s+)?(?:partially\s+)?out\s+of\s+stock\s+for\s+(?:the\s+)?following\s+(?:items|products)\s*[:.]/gi,
      clause=>clause.replace(/\s+/g,' ')+'\n')
    .replace(/\bLet\s+us\s+know\s+if\s+(?:any\s+changes\s+are\s+required(?:\s+or\s+if\s+you\s+have\s+(?:any\s+)?questions)?|you\s+have\s+any\s+questions)(?:\s+or\s+(?:contact|call)\s+[+\d][\d \t().-]{5,}\d\s+(?:if\s+any|if\s+you\s+have|for\s+any)\s+questions)?[.!]?/gi,'')
    .replace(deliveryWindow,'')
    .replace(/\bUse\s+this\s+link\s+to\s+track\s+your\s+order\s*:\s*https?:\/\/[^\s]+/gi,'')
    .replace(/\bYou\s+will\s+receive\s+your\s+flight\s+notifications\s+via\s+SMS[.!]?/gi,'')
    .replace(/\bPlease\s+reach\s+out\s+to\s+the\s+nearest\s+stock\s+for\s+(?:these\s+items|the\s+rest\s+of\s+the\s+order)[.!]?/gi,'')
    .replace(/\bOnce\s+re[- ]?stocked,?\s+we\s+will\s+notify\s+you\s+and\s+be\s+able\s+to\s+deliver\s+(?:the\s+rest|them)(?:,?\s+if\s+still\s+needed)?[.!]?/gi,'');
}
