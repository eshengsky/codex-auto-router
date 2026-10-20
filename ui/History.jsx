import { useLanguage } from './i18n';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { routeText } from './controls';
import { reasons } from './api';
export function History({history, onRefresh, onError}) {
 const {language,t}=useLanguage();
 return <section><h2>{t('最近分类记录')}</h2><p className="muted">{t('显示最近的聊天分类结果和耗时，最多 100 条，不保存任务正文。刷新可查看其他聊天的结果。')}</p><Button color="secondary" variant="outline" onClick={()=>onRefresh().catch(e=>onError(e.message))}>{t('刷新记录')}</Button>
    {history.length?<div className="history">{history.map(d=><div className="history-row" key={d.id}><div><strong>{d.tierName} · {routeText(d)}</strong><p className="muted">{t(reasons[d.reason]??d.reason)} · {t('配置 {revision}',{revision:d.revision?.slice(0,6)})}</p></div><span className="muted">{new Date(d.at).toLocaleTimeString(language)} · {(d.durationMs/1000).toFixed(1)} {t('秒')}</span></div>)}</div>:<p className="empty">{t('还没有分类记录。')}</p>}
  </section>;
}
