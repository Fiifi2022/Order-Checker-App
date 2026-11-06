import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
// Include every General suite, the real verify route and shared dependency
// controls. New General regressions enter this gate without editing a list.
const shared=new Set(['companionVaccine.test.ts','universalOrderExtraction.test.ts','productCatalog.test.ts','productResearch.test.ts','catalogAliasLearning.test.ts','catalogAliasAssistant.test.ts','syringeIdentity.test.ts']);
const files=readdirSync(new URL('../server/',import.meta.url)).filter(name=>/^general.*\.test\.ts$/.test(name)||shared.has(name)).sort().map(name=>'server/'+name);
if(!files.some(name=>name.endsWith('/generalPipelineRegression.test.ts')))throw Error('Required General Auditor pipeline regressions are missing.');
console.log(`Running ${files.length} General Auditor and shared dependency regression suites.`);
const result=spawnSync(process.execPath,['--import','tsx','--test','--test-concurrency=4',...process.argv.slice(2),...files],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
