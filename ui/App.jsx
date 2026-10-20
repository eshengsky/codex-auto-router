import { useEffect, useRef, useState } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Switch } from '@openai/apps-sdk-ui/components/Switch';
import { Input } from '@openai/apps-sdk-ui/components/Input';
import { SegmentedControl } from '@openai/apps-sdk-ui/components/SegmentedControl';
import { Field, Choice, RouteFields, routeText } from './controls';
import { Tiers } from './Tiers';
import { History } from './History';
import { api } from './api';
import { activeConfig, toDocument, templateNames } from '../src/config-browser.js';
import { LanguageContext, useLanguage } from './i18n';
import { languageFor, translate } from '../src/i18n.js';
import { defaults } from '../src/defaults.js';
import { SaveQueue } from './save-queue.js';
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export function App() {
  const [language,setLanguage]=useState(()=>languageFor(navigator.languages?.join(',')??navigator.language));
  useEffect(()=>{document.documentElement.lang=language;document.title=translate(language,'Codex 自动选模');},[language]);
  return <LanguageContext value={language}><Settings setLanguage={setLanguage}/></LanguageContext>;
}
function Settings({setLanguage}) {
  const {language,t,errorText}=useLanguage();
  const [languageSaving,setLanguageSaving]=useState(false);
  const [labelsSaving,setLabelsSaving]=useState(false);
  const localizedTemplates=Object.fromEntries(Object.entries(templateNames).map(([key,name])=>[key,t(name)]));
  async function changeLanguage(next) {
    setLanguageSaving(true);
    try {const saved=await api('preferences',{language:next},'PUT');setLanguage(saved.language);setState(old=>({...old,preferences:saved}));setError('');}
    catch(e){setError(e.message);}finally{setLanguageSaving(false);}
  }
  async function changeLabels(showModelLabels) {
    setLabelsSaving(true);
    try {const saved=await api('preferences',{showModelLabels},'PUT');setState(old=>({...old,preferences:saved}));setError('');}
    catch(e){setError(`${t('保存失败')}${language==='zh-CN'?'：':': '}${errorText(e.message)}`);}finally{setLabelsSaving(false);}
  }
  const [state,setState] = useState(null), [draft,setDraftState] = useState(null);
  const [count,setCount] = useState('3'), [tab,setTab] = useState('config');
  const [error,setError] = useState(''), [message,setMessage] = useState(''), [busy,setBusy] = useState(false), [saveErrors,setSaveErrors] = useState([]);
  const [confirmReset,setConfirmReset] = useState(false), [imported,setImported] = useState(null);
  const file = useRef(null), draftRef=useRef(null), savedRef=useRef(null), queue=useRef(null);
  const dirty = state && draft && !same(state.document,draft);
  const config = draft ? activeConfig(draft,count) : null;
  const saveError = saveErrors[0]?.message;
  function setDraft(update) {
    const next=typeof update==='function'?update(draftRef.current):update;
    draftRef.current=next;setDraftState(next);
  }
  function accepted(s,body) {
    savedRef.current=s;setState(old=>({...old,...s}));
    if(body.config){setDraft(s.document);setCount(s.document.activeTemplate);setImported(null);return;}
    // Late responses may acknowledge earlier keystrokes. Merge only the submitted
    // section when it still matches; never overwrite newer edits in any template.
    setDraft(d=>body.scope==='classifier'
      ? same(d.classifier,body.classifier)&&d.timeoutMs===body.timeoutMs?{...d,classifier:s.document.classifier,timeoutMs:s.document.timeoutMs}:d
      : {...d,activeTemplate:s.document.activeTemplate,templates:{...d.templates,[body.count]:same(d.templates[body.count],body.template)?s.document.templates[body.count]:d.templates[body.count]}});
  }
  function load(s) {
    if(s.preferences)setLanguage(s.preferences.language);
    savedRef.current=s;setState(s);setDraft(s.document);setCount(s.document.activeTemplate);setSaveErrors([]);
    queue.current=new SaveQueue({revision:s.revision,send:body=>api('config',body,'PUT'),onSaved:accepted,onStatus:setBusy,onError:setSaveErrors});
  }
  async function refresh() {
    const s = await api('state');
    // Refreshing records must not replace unsaved configuration or its conflict revision.
    setState(old => old ? {...old,models:s.models,history:s.history} : s);
    return s;
  }
  useEffect(() => {
    let mounted = true;
    api('state').then(s => { if (mounted) load(s); }).catch(e => mounted && setError(e.message));
    const id = crypto.randomUUID(), beat = () => api('lease',{id}).catch(()=>{});
    beat(); const timer = setInterval(beat,30000);
    return () => { mounted=false; clearInterval(timer); void api('lease',{id,release:true}).catch(()=>{}); };
  },[]);
  useEffect(() => {
    const warn = e => { if (dirty) { e.preventDefault(); e.returnValue=''; } };
    window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn);
  },[dirty]);

  function save(scope, activate=false, selected=count) {
    const d=draftRef.current, saved=savedRef.current.document;
    const body=scope==='classifier'?{scope,classifier:d.classifier,timeoutMs:d.timeoutMs}:{scope,count:selected,template:d.templates[selected],activate};
    const unchanged=scope==='classifier'?same(d.classifier,saved.classifier)&&d.timeoutMs===saved.timeoutMs:same(d.templates[selected],saved.templates[selected])&&(!activate||saved.activeTemplate===selected);
    // A pending write can differ from both the saved state and the newest edit
    // (e.g. type, blur, then undo), so still queue that undo while saving.
    if(unchanged&&!queue.current.running&&!queue.current.failed.size)return;
    void queue.current.enqueue(scope==='classifier'?'classifier':selected,body);
  }
  function updateTemplate(next, immediate=false) {
    setDraft(d=>({...d,templates:{...d.templates,[count]:next}}));setMessage('');
    if(immediate)save('template');
  }
  function updateClassifier(classifier) {setDraft(d=>({...d,classifier}));save('classifier');}
  function selectTemplate(n) {setCount(n);setConfirmReset(false);setMessage('');save('template',true,n);}
  function restoreTemplate() {
    const d=defaults(Number(count),language);
    updateTemplate({tiers:d.tiers,fallbackTierId:d.fallbackTierId},true);
    setConfirmReset(false);
  }
  function retryFailed() {
    for(const failure of saveErrors){
      if(failure.body.config)void queue.current.enqueue(failure.key,failure.body);
      else save(failure.body.scope,failure.body.activate,failure.body.count);
    }
  }
  async function importFile(e) {
    try {
      const f=e.target.files[0]; if(!f)return;
      if(f.size>256000)throw new Error('配置文件过大');
      const raw=JSON.parse(await f.text());
      const document=toDocument(raw,state.models,language);
      // A legacy import contains one template; retain the other independently saved templates.
      setImported(raw.version===1&&!raw.routingTemplates?{...draft,classifier:document.classifier,timeoutMs:document.timeoutMs,activeTemplate:document.activeTemplate,
        templates:{...draft.templates,[document.activeTemplate]:document.templates[document.activeTemplate]}}:document);
      setError('');
    }catch(e){setError(e instanceof SyntaxError?'配置文件不是有效的 JSON':e.message);}finally{e.target.value='';}
  }
  function applyImport() {void queue.current.enqueue('import',{config:imported});}
  function exportFile() {
    try {
      const exported=toDocument(draft,state.models,language);
      const url=URL.createObjectURL(new Blob([JSON.stringify(exported,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='smart-selection-config.json';a.click();URL.revokeObjectURL(url);
    }catch(e){setError(e.message);}
  }
  return <main>
    <header><div><h1>{t('Codex 自动选模')}</h1><p className="muted">{t('根据任务复杂度，自动选择模型和推理强度。')}</p></div>
      <div className="header-settings"><div className="language-select"><Choice label={t('语言')} value={language} options={[{value:'zh-CN',label:'简体中文'},{value:'en',label:'English'}]} disabled={languageSaving||labelsSaving||!state} onChange={changeLanguage}/></div></div>
    </header>
    <nav aria-label={t('配置页面')}><button aria-current={tab==='config'?'page':undefined} onClick={()=>setTab('config')}>{t('配置')}</button><button aria-current={tab==='history'?'page':undefined} onClick={()=>setTab('history')}>{t('最近分类记录')}</button></nav>
    {(error||saveError) && <div className="notice error" role="alert">{saveError && <strong>{t('保存失败')}{language==='zh-CN'?'：':': '}</strong>}{errorText(error||saveError)}
      {saveError&&<Button color="secondary" variant="ghost" disabled={busy} onClick={retryFailed}>{t('重试保存')}</Button>}
      <Button color="secondary" variant="ghost" disabled={busy} onClick={async()=>{try{load(await api('state'));setError('');setMessage('已重新加载。');}catch(e){setError(e.message);}}}>{t('丢弃修改并重新加载')}</Button></div>}
    {message && <p className="notice" role="status">{t(message)}</p>}
    {!config ? <p className="empty">{t(error?'无法连接本地服务。':'正在加载配置…')}</p> : tab==='config' ? <>
      <section className="classifier-section">
        <div className="section-heading"><div className="field"><h2>{t('分类模型')}</h2><small>{t('判断任务复杂度，并选择对应的执行模型。')}</small></div></div>
        <div className="classifier-fields"><RouteFields prefix={t('分类')} models={state.models} route={draft.classifier} onChange={updateClassifier}/>
          <Field label={t('超时时间')}><Input aria-label={t('超时时间')} size="lg" type="number" min={3} max={60} endAdornment={t('秒')} value={draft.timeoutMs/1000} onBlur={()=>save('classifier')} onChange={e=>setDraft(d=>({...d,timeoutMs:Number(e.target.value)*1000}))}/></Field>
        </div>
      </section>
      <section className="routing-section">
        <div className="section-heading"><div className="field"><h2>{t('路由配置')}</h2><small aria-live="polite">{t('当前使用{template}路由，后续消息将按以下配置选择模型。', {template:language==='zh-CN'?templateNames[state.document.activeTemplate]:{'2':'Two','3':'Three','5':'Five'}[state.document.activeTemplate]})}</small></div></div>
        <div className="template-toolbar"><SegmentedControl aria-label={t('路由模板')} value={count} size="lg" onChange={selectTemplate}>
          {['2','3','5'].map(n=><SegmentedControl.Option value={n} key={n}>{localizedTemplates[n]}{!same(state.document.templates[n],draft.templates[n])?' ·':''}</SegmentedControl.Option>)}
        </SegmentedControl><Button color="secondary" variant="ghost" size="md" disabled={!!busy} onClick={()=>setConfirmReset(true)}>{t('恢复默认')}</Button></div>
        {confirmReset && <div className="reset-confirm" role="alert"><span>{t('恢复{template}的默认值？仅替换当前模板。',{template:localizedTemplates[count]})}</span><div className="actions"><Button color="secondary" variant="outline" size="sm" onClick={()=>setConfirmReset(false)}>{t('取消')}</Button><Button color="primary" size="sm" onClick={restoreTemplate}>{t('确认恢复')}</Button></div></div>}
        <Tiers tiers={config.tiers} models={state.models} onBlur={()=>save('template')} onChange={(tiers,immediate)=>updateTemplate({...draftRef.current.templates[count],tiers},immediate)}/>
        <div className="fallback-row"><Field label={t('兜底级别')} hint={t('无法判断、分类失败或超时时使用。')}><Choice label={t('兜底级别')} value={config.fallbackTierId} options={config.tiers.map(t=>({value:t.id,label:`${t.name} · ${routeText(t)}`}))} onChange={fallbackTierId=>updateTemplate({...draft.templates[count],fallbackTierId},true)}/></Field></div>
        <div className="field reply-model-setting">
          <div className="reply-model-heading"><label htmlFor="show-model-labels">{t('显示回复模型')}</label><Switch id="show-model-labels" aria-describedby="show-model-labels-help" checked={state.preferences?.showModelLabels!==false} disabled={labelsSaving||languageSaving} onCheckedChange={changeLabels}/></div>
          <small id="show-model-labels-help">{t('在回复顶部显示实际使用的模型和推理强度。')}</small>
        </div>
      </section>
      <footer><span className="muted">{t('修改自动保存，下次发送生效。')}</span><div className="actions"><Button color="secondary" variant="ghost" size="md" disabled={!!busy} onClick={()=>file.current.click()}>{t('导入配置')}</Button><Button color="secondary" variant="ghost" size="md" onClick={exportFile}>{t('导出配置')}</Button><input type="file" accept="application/json,.json" hidden ref={file} onChange={importFile}/></div></footer>
      {imported && <div className="notice" role="alert">{t('导入后将保存分类模型和三套模板，后续聊天使用{template}。当前页面未保存的编辑将被替换。',{template:localizedTemplates[imported.activeTemplate]})}<div className="actions"><Button color="secondary" variant="outline" disabled={!!busy} onClick={()=>setImported(null)}>{t('取消')}</Button><Button color="primary" disabled={!!busy} onClick={applyImport}>{t('导入并应用')}</Button></div></div>}
    </> : <History history={state.history} onRefresh={refresh} onError={setError}/>}</main>;
}
