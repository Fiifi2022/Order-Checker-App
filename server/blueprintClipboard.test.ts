import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {blueprintClipboardText,blueprintPasteRowTargets,blueprintPasteQuantity} from '../src/utils/blueprintClipboard';
import {parseClipboardTsv} from '../src/utils/blueprintPaste';
const clipboard=(values:Record<string,string>)=>({getData:(type:string)=>values[type] || ''});

test('Excel plain TSV is preferred and preserves empty columns, quoted cell line breaks and CRLF rows',()=>{
 const {document}=parseHTML('<html><body></body></html>');
 const plain='Clinic A\t\t10\r\n"Clinic B\nAnnex"\tEast\t20\r\n';
 const result=blueprintClipboardText(clipboard({'text/plain':plain,'text/html':'<table><tr><td>Wrong</td></tr></table>'}),document as any);
 assert.equal(result,plain);assert.deepEqual(parseClipboardTsv(result),[['Clinic A','','10'],['Clinic B\nAnnex','East','20']]);
});

test('HTML-only Excel tables preserve empty cells, merged headings and in-cell breaks without inserting HTML',()=>{
 const {document}=parseHTML('<html><body><div id="existing"></div></body></html>');
 const result=blueprintClipboardText(clipboard({'text/html':'<table><tr><th colspan="2">Facility</th><th>Allocation</th></tr><tr><td>Clinic A<br>Annex</td><td>&nbsp;</td><td>1,000</td></tr></table>'}),document as any);
 assert.deepEqual(parseClipboardTsv(result),[['Facility','','Allocation'],['Clinic A\nAnnex','','1,000']]);
 assert.equal(document.querySelectorAll('table').length,0);assert.ok(document.getElementById('existing'));
 assert.equal(blueprintClipboardText(clipboard({'text/html':'<p>No table</p>'}),document as any),'');
});

test('paste targets follow visible sorted rows and append instead of overwriting hidden records',()=>{
 assert.deepEqual(blueprintPasteRowTargets(['b','a'],'b',4),['b','a',null,null]);
 assert.throws(()=>blueprintPasteRowTargets(['b'],'hidden',1),/visible Blueprint cell/);
});

test('Excel numeric formats retain their values and invalid text never silently becomes blank',()=>{
 for(const [value,expected] of [['1,000',1000],['1\u00a0000',1000],['(12)',-12],['2.5',2.5],['', ''],['—','']] as const)assert.equal(blueprintPasteQuantity(value),expected);
 for(const value of ['unknown','=10+20','10%','Infinity'])assert.throws(()=>blueprintPasteQuantity(value),/not a valid quantity/);
});
