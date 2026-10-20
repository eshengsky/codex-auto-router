import { useLanguage } from './i18n';
import { Input } from '@openai/apps-sdk-ui/components/Input';
import { Textarea } from '@openai/apps-sdk-ui/components/Textarea';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Trash } from '@openai/apps-sdk-ui/components/Icon';
import { Field, RouteFields } from './controls';
export function Tiers({tiers,models,onChange,onBlur}) {
  const {t:tr}=useLanguage();
  const update=(id,changes,save=false)=>onChange(tiers.map(t=>t.id===id?{...t,...changes}:t),save);
  return <div className="tiers-scroll" tabIndex={0} role="region" aria-label={tr('任务级别配置，可横向滚动')}>
    <div className="tiers-grid" style={{gridTemplateColumns:`repeat(${tiers.length}, minmax(265px, 1fr))`}}>
      {tiers.map((t,index)=>{
        const examples=t.examples;
        return <article className="tier" key={t.id} aria-label={tr('{name}级别',{name:t.name})}>
          <div className="tier-title"><span className="tier-number">{String(index+1).padStart(2,'0')}</span><Input variant="soft" size="lg" aria-label={tr('{name}名称',{name:t.name})} value={t.name} maxLength={40} onBlur={onBlur} onChange={e=>update(t.id,{name:e.target.value})}/></div>
          <div className="tier-route"><RouteFields prefix={t.name} models={models} route={t} onChange={v=>update(t.id,v,true)}/></div>
          <Field label={tr('说明')}><Textarea size="lg" aria-label={tr('{name}分类说明',{name:t.name})} rows={3} value={t.description} maxLength={2000} onBlur={onBlur} onChange={e=>update(t.id,{description:e.target.value})}/></Field>
          <div className="examples"><div className="examples-heading"><span>{tr('任务示例')} <span className="muted">Few-shot</span></span></div>
            {examples.map((e,i)=><div className="example" key={i}>
              <div className="example-heading"><span>{tr('示例 {number}',{number:i+1})}</span><Button color="secondary" variant="ghost" size="xs" uniform title={tr('删除示例')} aria-label={tr('删除{name}示例{number}',{name:t.name,number:i+1})} onClick={()=>update(t.id,{examples:examples.filter((_,j)=>i!==j)},true)}><Trash /></Button></div>
              <Textarea size="lg" rows={3} aria-label={tr('{name}示例{number}',{name:t.name,number:i+1})} value={e.task} maxLength={3000} onBlur={onBlur} placeholder={tr('输入属于此级别的任务')} onChange={v=>update(t.id,{examples:examples.map((x,j)=>j===i?{task:v.target.value}:x)})}/>
            </div>)}
            <Button color="secondary" variant="ghost" size="sm" disabled={examples.length>=12} onClick={()=>update(t.id,{examples:[...examples,{task:''}]})}>{tr('＋ 添加示例')}</Button>
          </div>
        </article>;
      })}
    </div>
  </div>;
}
