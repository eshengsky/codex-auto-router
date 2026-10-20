// Chinese keys also serve as the Chinese catalogue. Keep user-authored content
// out of this dictionary: changing UI language must never translate saved data.
export const english = {
 '显示回复模型':'Show reply model','在回复顶部显示实际使用的模型和推理强度。':'Show the actual model and reasoning effort above each reply.','无效的显示设置':'Invalid display settings',
 '未记录':'Not recorded', '配置文件不是有效的 JSON':'The settings file is not valid JSON',
 'Codex 自动选模':'Codex Auto Model Selection', '根据任务复杂度，自动选择模型和推理强度。':'Automatically selects a model and reasoning effort based on task complexity.',
 '根据任务复杂度选择模型，可在本地配置页面自定义':'Choose a model by task complexity. Customize in local settings.',
 '发送时自动选择模型和强度，以回复标签为准':'Select model and effort when sending; see the reply label.',
 '语言':'Language','保存失败':'Save failed',
 '配置页面':'Settings navigation','配置':'Settings','最近分类记录':'Recent classifications',
 '重试保存':'Retry save','丢弃修改并重新加载':'Discard changes and reload','已重新加载。':'Reloaded.',
 '无法连接本地服务。':'Cannot connect to the local service.','正在加载配置…':'Loading settings…',
 '分类模型':'Classifier','分类':'Classifier','超时时间':'Timeout','秒':'s','路由配置':'Routing',
 '判断任务复杂度，并选择对应的执行模型。':'Classifies task complexity to select an execution model.',
 '当前使用{template}路由，后续消息将按以下配置选择模型。':'{template}-level routing is active. Future messages will use the configuration below.',
 '路由模板':'Routing template','二级':'2 levels','三级':'3 levels','五级':'5 levels',
 '恢复默认':'Restore defaults','恢复{template}的默认值？仅替换当前模板。':'Restore defaults for {template}? Only this template will be replaced.',
 '取消':'Cancel','确认恢复':'Restore','兜底级别':'Fallback level','无法判断、分类失败或超时时使用。':'Used when classification is uncertain, fails, or times out.',
 '修改自动保存，下次发送生效。':'Changes save automatically and apply to your next message.',
 '导入配置':'Import settings','导出配置':'Export settings','导入并应用':'Import and apply',
 '导入后将保存分类模型和三套模板，后续聊天使用{template}。当前页面未保存的编辑将被替换。':'Import the classifier and all three templates, using {template} for future messages. Unsaved edits will be replaced.',
 '模型':'Model','推理强度':'Reasoning effort','{name}（不可用）':'{name} (unavailable)',
 '{prefix}模型':'{prefix} model','{prefix}推理强度':'{prefix} reasoning effort',
 '任务级别配置，可横向滚动':'Task levels; scroll horizontally','{name}级别':'{name} level','{name}名称':'{name} name',
 '说明':'Description','{name}分类说明':'{name} classification description','任务示例':'Task examples',
 '示例 {number}':'Example {number}','删除示例':'Delete example','删除{name}示例{number}':'Delete {name} example {number}',
 '{name}示例{number}':'{name} example {number}','输入属于此级别的任务':'Enter a task that belongs to this level','＋ 添加示例':'+ Add example',
 '显示最近的聊天分类结果和耗时，最多 100 条，不保存任务正文。刷新可查看其他聊天的结果。':'Shows up to 100 recent classifications and durations. Task text is not stored. Refresh to see results from other chats.',
 '刷新记录':'Refresh','还没有分类记录。':'No classifications yet.','配置 {revision}':'Config {revision}',
 'AI 分类':'AI classification','无法判断，使用兜底':'Uncertain; fallback used','分类超时，使用兜底':'Timed out; fallback used',
 '分类失败，使用兜底':'Classification failed; fallback used','服务不可用，使用兜底':'Service unavailable; fallback used',
 '配置文件过大':'Settings file is too large','服务请求失败':'Service request failed','无效语言':'Unsupported language',
 '配置必须包含 2、3 或 5 个级别':'Settings must contain 2, 3, or 5 levels','分类超时须为 3–60 秒':'Timeout must be between 3 and 60 seconds',
 '级别 ID 无效或重复':'Level IDs must be valid and unique','级别名称不能重复':'Level names must be unique','每个级别最多 12 条示例':'Each level supports up to 12 examples',
 '请选择有效的兜底级别':'Select a valid fallback level','无效的配置版本或启用模板':'Invalid settings version or active template',
 '配置必须包含二级、三级、五级模板':'Settings must include 2-, 3-, and 5-level templates','模板级别数量不匹配':'The number of levels does not match the template',
 '配置已在其他窗口更新，请重新加载后再保存':'Settings changed in another window. Reload before saving.',
 '无效的模板保存请求':'Invalid template save request','不允许的请求来源':'Request origin is not allowed','不允许的来源':'Origin is not allowed',
 '接口不存在':'Endpoint not found','不支持的方法':'Method not allowed','请求必须使用 application/json':'Request must use application/json',
 '请求过大':'Request is too large','无效模板':'Invalid template','无效客户端':'Invalid client','无效任务':'Invalid task',
 '分类服务忙，请稍后重试':'Classifier is busy. Try again shortly.','页面未构建，请运行 npm run build':'Page has not been built. Run npm run build.',
 '已取消':'Cancelled','分类仅接受聊天桥接请求。':'Classification only accepts chat bridge requests.',
 '级别名称':'Level name','级别说明':'Level description','示例任务':'Example task',
 '{label}不能为空且不能超过 {max} 字符':'{label} must not be empty or exceed {max} characters',
 '模型或推理强度不可用：{route}':'Model or reasoning effort is unavailable: {route}',
 '配置读取失败，未覆盖原文件：{detail}':'Could not read settings; the original file was preserved: {detail}',
};
export function languageFor(value) {
 const first=String(value??'').split(',')[0].split(';')[0].trim();
 return /^zh(?:-|$)/i.test(first)?'zh-CN':'en';
}
export function translate(language,key,values={}) {
 const text=language==='zh-CN'?key:(english[key]??key);
 return text.replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??`{${name}}`));
}
export function errorText(language,message) {
 if(language==='zh-CN')return message;
 if(english[message])return english[message];
 let m=message.match(/^(.*)不能为空且不能超过 (\d+) 字符$/);
 if(m)return translate(language,'{label}不能为空且不能超过 {max} 字符',{label:translate(language,m[1]),max:m[2]});
 for(const [prefix,key,field] of [['模型或推理强度不可用：','模型或推理强度不可用：{route}','route'],['配置读取失败，未覆盖原文件：','配置读取失败，未覆盖原文件：{detail}','detail']])
  if(message.startsWith(prefix))return translate(language,key,{[field]:message.slice(prefix.length)});
 return message; // Preserve unexpected native/network diagnostics verbatim.
}
