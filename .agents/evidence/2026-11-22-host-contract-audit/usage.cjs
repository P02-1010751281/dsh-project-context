// node usage.cjs /tmp/PINNED_TREE /tmp/PINNED_TREE/rc5.json
const [root,cfg]=process.argv.slice(2),ts=require(root+'/node_modules/typescript');
const c=ts.getParsedCommandLineOfConfigFile(cfg,{}, {...ts.sys,onUnRecoverableConfigFileDiagnostic:e=>{throw e}}), p=ts.createProgram(c.fileNames,c.options),tc=p.getTypeChecker(),cf=p.getSourceFile(root+'/src/host/contract.ts');
if(ts.getPreEmitDiagnostics(p).length) throw Error('program not clean');
const walk=(n,f)=>{f(n);ts.forEachChild(n,ch=>walk(ch,f))},rows=new Map(),name=n=>n?.getText(cf),line=n=>n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line+1;
walk(cf,n=>{if(ts.isPropertySignature(n)||ts.isMethodSignature(n)||ts.isIndexSignatureDeclaration(n)){let path=[name(n.name)||'[key]'];for(let a=n.parent;a&&a!==cf;a=a.parent){if(a.name)path.unshift(name(a.name))} rows.set(n,{path:path.join('.'),loc:new Map()})}});
const project=sf=>sf.fileName.slice(root.length+1); const loose=[];
for(const sf of p.getSourceFiles()){if(!sf.fileName.startsWith(root+'/src/')||sf===cf)continue;walk(sf,n=>{let props=[],kind='read',recv,key;
if(ts.isPropertyAccessExpression(n)||ts.isElementAccessExpression(n)){recv=tc.getTypeAtLocation(n.expression);key=n.name?.text||n.argumentExpression?.text;let s=tc.getSymbolAtLocation(n.name||n.argumentExpression);if(s)props.push(s);if(recv.flags & ts.TypeFlags.Any)loose.push(project(sf)+':'+line(n)+' '+n.getText());if(ts.isBinaryExpression(n.parent)&&n.parent.left===n&&n.parent.operatorToken.kind===ts.SyntaxKind.EqualsToken)kind='write';}
else if(ts.isBindingElement(n)&&ts.isObjectBindingPattern(n.parent)){recv=tc.getTypeAtLocation(n.parent);key=(n.propertyName||n.name).text;}
else if(ts.isPropertyAssignment(n)||ts.isShorthandPropertyAssignment(n)){recv=tc.getContextualType(n.parent);key=n.name.text;kind='write';}else return;
function add(t){if(!t||typeof key!=='string')return;const s=t.getProperty(key);if(s)props.push(s);if(t.isUnionOrIntersection())t.types.forEach(add)} add(recv);
for(const d of props.flatMap(s=>s.declarations||[])){let row=rows.get(d);if(row){const bucket=(project(sf).includes('/host/')?'adapter':'core')+'-'+kind;let ex=row.loc.get(bucket)||new Set();ex.add(project(sf)+':'+line(n));row.loc.set(bucket,ex)}}});}
for(const [n,r] of rows)console.log(line(n),r.path,...Array.from(r.loc,([k,v])=>k+'='+[...v].slice(0,4).join(',')));console.log('ANY RECEIVERS:',loose.join('\n'));
