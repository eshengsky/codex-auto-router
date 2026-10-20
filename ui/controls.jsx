import { useLanguage } from './i18n';
import { useId, cloneElement } from 'react';
import { Select } from '@openai/apps-sdk-ui/components/Select';
import { modelName, effortName } from '../src/display-names.mjs';
export function Field({label, children, hint, hideLabel=false}) { const id=useId(); return <div className={`field${hideLabel?' field-unlabelled':''}`}><label className={hideLabel?'sr-only':undefined} htmlFor={id}>{label}</label>{hint && <small id={`${id}-hint`}>{hint}</small>}{cloneElement(children,{id,...(hint?{'aria-describedby':`${id}-hint`}:{})})}</div>; }
export function Choice({value, options, onChange, label, id, grouped=false, listMinWidth, disabled=false}) { return <Select disabled={disabled} id={id} value={value} options={options} onChange={o=>onChange(o.value)} name={label} size="lg" pill={false} block listMinWidth={listMinWidth} variant={grouped?"ghost":"outline"} triggerClassName={grouped?"route-select":undefined}/>; }
export function RouteFields({route, models, onChange, prefix}) {
  const {t}=useLanguage();
  const groupLabel=useId();
  const available=models.filter(m=>!m.hidden && m.supportedReasoningEfforts?.length);
  const current=available.find(m=>m.model===route.model);
  const options=available.map(m=>({value:m.model,label:modelName(m.displayName ?? m.model)}));
  if(!current)options.push({value:route.model,label:t('{name}（不可用）',{name:modelName(route.model)}),disabled:true});
  const efforts=(current?.supportedReasoningEfforts??[]).map(e=>({value:e.reasoningEffort,label:effortName(e.reasoningEffort)}));
  if(!efforts.some(e=>e.value===route.effort))efforts.push({value:route.effort,label:t('{name}（不可用）',{name:effortName(route.effort)}),disabled:true});
  // Keep popup menus readable independently of the compact trigger widths.
  return <div className="field route-field"><span id={groupLabel} className="route-label">{t('模型')}</span><div className="route-control" role="group" aria-labelledby={groupLabel}><div className="route-model"><Choice grouped listMinWidth={240} label={t('{prefix}模型',{prefix})} value={route.model} options={options} onChange={model=>{const m=available.find(x=>x.model===model);onChange({...route,model,effort:m.supportedReasoningEfforts.some(e=>e.reasoningEffort===route.effort)?route.effort:m.defaultReasoningEffort});}}/></div><div className="route-effort"><Choice grouped listMinWidth={160} label={t('{prefix}推理强度',{prefix})} value={route.effort} options={efforts} onChange={effort=>onChange({...route,effort})}/></div></div></div>;
}
export const routeText = r => `${modelName(r.model)} · ${effortName(r.effort)}`;
