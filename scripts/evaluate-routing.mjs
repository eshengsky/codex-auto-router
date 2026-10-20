// Opt-in live evaluation: makes paid/subscription model calls, never runs in npm test.
// Tasks are synthetic and separate from the default few-shot examples. Expected
// labels are fixed before inference; they express our product boundaries, not
// objective ground truth. A fallback is never counted as a correct classification.
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaults } from '../src/defaults.js';
import { decide } from '../src/decision.mjs';
import { nativeCatalog, prepareNativeClassification } from '../src/native-client.mjs';
import { PreparedClassifier } from '../src/prepared-classifier.mjs';
import { proxyEnvironment } from '../src/network-environment.mjs';

const cases = [
 {id:'office-extract',language:'zh-CN',domain:'办公',level:1,task:'请把下面的联系人整理成姓名、电话两列，不补充信息：王平 13800000001；陈琳 13900000002。'},
 {id:'legal-extract',language:'en',domain:'法律文本提取',level:1,task:'Extract only the notice period and payment deadline from this contract clause. Do not assess legal validity: "Either party may terminate with 30 days written notice. Invoices are payable within 14 days of receipt."'},
 {id:'education-rewrite',language:'zh-CN',domain:'教育写作',level:2,task:'给一年级家长写一段班级群通知：周五带一片落叶来观察，不买材料，下雨可以用照片代替。语气友好，不超过120字，把需要准备的东西说清楚。'},
 {id:'hr-organize',language:'en',domain:'人事办公',level:2,task:'Turn these onboarding notes into a short welcome checklist, grouped into before arrival and first day: send bank details before Monday; bring ID on Monday; collect laptop at reception; read the handbook before arrival. Do not invent any steps.'},
 {id:'retail-comparison',language:'zh-CN',domain:'零售数据',level:3,task:'比较两款商品的本月毛利和退货后的收入：A售出400件，单价80元，成本45元，退货20件；B售出250件，单价120元，成本70元，退货5件。退货商品可再次出售，不计其他成本。列出计算过程和结果，按实际毛利选出更好的商品，不推测原因。'},
 {id:'teaching-plan',language:'en',domain:'教学规划',level:3,task:'Create a four-week beginner spreadsheet course with two 45-minute sessions per week. Cover cell references, formulas, sorting, filtering, and one final exercise. Students know basic computer use. Assign a learning goal and exercise to each session and check that the plan fits the time available.'},
 {id:'operations-diagnosis',language:'zh-CN',domain:'运营诊断',level:4,task:'客服平均响应从2分钟升至6分钟，但日均工单量只增加5%。同期新人占比从10%升至35%，排班从两班改为三班，复杂工单占比从15%升至30%。请比较这些因素如何共同影响响应时间，列出优先排查顺序和短期改善方案，说明不能从这些汇总数据得出的结论。目标是恢复原有响应水平。'},
 {id:'software-tradeoff',language:'en',domain:'软件维护',level:4,task:'Our checkout sometimes charges twice after a network timeout. The payment provider supports idempotency keys, but our retry queue generates a new key on each attempt and two workers can claim the same job. Compare fixes across the API, queue, and database, including crash recovery and backward compatibility. We must retain the current provider and public API.'},
 {id:'public-service-strategy',language:'zh-CN',domain:'公共服务规划',level:5,task:'某市希望改善社区养老服务，但尚未确定应该优先解决覆盖率、照护质量还是家庭负担。问卷说需求低，候补名单却很长，未来人口和财政预测分歧很大。请先建立问题框架，分析资料矛盾，比较集中建设、上门服务和社区合作几种路径，设计不同未来情景下的评估方法及小规模试点，以验证关键假设后再决定投入方向。'},
 {id:'research-design',language:'en',domain:'研究设计',level:5,task:'We need to understand whether a remote-work policy improves productivity. Existing studies disagree, teams choose their own work patterns, and productivity measures reward different kinds of work. Frame the research question, reconcile competing explanations, propose alternative study designs, identify confounders and measurement failures, and plan pilot tests that could falsify the main assumptions before recommending a policy.'},
 {id:'bulk-mechanical',language:'zh-CN',domain:'批量文本',level:1,task:'把下面清单中每一项的“旧版”替换为“新版”，顺序和其余内容保持不变，不总结：'+Array.from({length:120},(_,i)=>`第${i+1}项：旧版手册已归档。`).join('\n')},
 {id:'context-followup',language:'zh-CN',domain:'上下文承接',level:5,task:'可以，就按这个思路分析吧。',recentMessages:[{role:'user',text:'我们要决定未来五年是否把线下职业培训转到线上。调查、招生数据和雇主访谈彼此矛盾，哪些能力适合线上也不确定。需要界定成功指标、比较不同转型路径，并通过试点验证关键假设。'},{role:'assistant',text:'可以先梳理矛盾证据，建立几种转型情景，再设计能检验学习效果和需求假设的试点。'}]},
 {id:'missing-context',language:'en',domain:'信息不足',level:null,task:'Go ahead with that one.'},
];
const expectedFor = (level,count) => level===null ? null : count===2 ? level<=3?'simple':'complex' : count===3 ? level<=2?'simple':level===3?'regular':'complex' : ['simple','light','regular','advanced','complex'][level-1];
const output=resolve(process.argv[2]??'reports/routing-evaluation.json');
const templateOption=process.argv.find(a=>a.startsWith('--templates='));
const counts=templateOption?templateOption.split('=')[1].split(',').map(Number):[2,3,5];
if(counts.some(n=>![2,3,5].includes(n)))throw Error('Unsupported template');
const repeatOption=process.argv.find(a=>a.startsWith('--repeat='));
const repeats=repeatOption?Number(repeatOption.split('=')[1]):1;
if(!Number.isInteger(repeats)||repeats<1||repeats>3)throw Error('Repeat must be 1, 2 or 3');
const caseOption=process.argv.find(a=>a.startsWith('--case-ids='));
const selectedCases=caseOption?cases.filter(c=>caseOption.split('=')[1].split(',').includes(c.id)):cases;
if(!selectedCases.length)throw Error('No evaluation cases selected');
const directory=mkdtempSync(join(tmpdir(),'codex-routing-evaluation-'));
const options={home:process.env.CODEX_HOME??join(homedir(),'.codex'),directory};
const networkEnv=proxyEnvironment(process.env);
const pool=new PreparedClassifier({createWorker:request=>prepareNativeClassification(options,request)});
const report={startedAt:new Date().toISOString(),classifier:defaults().classifier,method:'One live call per case and template, isolated one-use sessions; expected labels fixed before inference. No production configuration or decision history is modified.',cases:selectedCases,configurations:Object.fromEntries(counts.map(n=>[n,{zh:defaults(n,'zh-CN'),en:defaults(n,'en')}])),results:[]};
const persist=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
mkdirSync(resolve(output,'..'),{recursive:true});
try {
 const models=await nativeCatalog(options);
 pool.warm({route:report.classifier,networkEnv});
 for(const count of counts) for(let iteration=1;iteration<=repeats;iteration++) for(const sample of selectedCases){
  const config=defaults(count,sample.language),expected=expectedFor(sample.level,count);
  const input={task:sample.task,truncated:false,hasAttachments:false,contextAvailable:!!sample.recentMessages,recentMessages:sample.recentMessages??[]};
  const decision=await decide({config,models,input,classify:request=>pool.classify({...request,networkEnv})});
  const passed=expected===null ? decision.reason==='uncertain' : decision.reason==='classified'&&decision.tierId===expected;
  const result={count,iteration,caseId:sample.id,language:sample.language,expected,actual:decision.tierId,reason:decision.reason,passed,durationMs:decision.durationMs};
  report.results.push(result);persist();console.log(JSON.stringify(result));
 }
 report.finishedAt=new Date().toISOString();
 report.summary=Object.fromEntries(counts.map(n=>{const rows=report.results.filter(r=>r.count===n);return[n,{passed:rows.filter(r=>r.passed).length,total:rows.length,fallbacks:rows.filter(r=>r.reason!=='classified').length}]}));
 persist();console.log(JSON.stringify(report.summary));
}finally{pool.close();setTimeout(()=>rmSync(directory,{recursive:true,force:true}),1500);}
