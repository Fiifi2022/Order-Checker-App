/** Presentation only: legacy saved audits keep their decision and evidence. */
export function generalProductFindingText(value:string|undefined):string {
  return (value||'')
    .replace(/Product identity unresolved\s*[—–-]\s*confirm the repository mapping\.?/gi,'Product could not be matched. Check the product name.')
    .replace(/Not verified\s*[—–-]\s*resolve product identity\.?/gi,'Quantity comparison paused until the product is matched.');
}
