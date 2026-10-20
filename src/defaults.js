const tier = (id, name, description, model, effort, ...tasks) => ({ id, name, description, model, effort, examples: tasks.map(task => ({ task })) });

// Each template defines its own boundaries: fewer levels cover broader tasks.
// Keep IDs stable (including the two-level "simple" ID) for saved fallback references.
const routes = {
  2: [['simple', 'gpt-6.1-sol', 'medium'], ['complex', 'gpt-6-astra', 'high']],
  3: [['simple', 'gpt-6-luna', 'medium'], ['regular', 'gpt-6.1-sol', 'medium'], ['complex', 'gpt-6-astra', 'high']],
  5: [['simple', 'gpt-6-luna', 'medium'], ['light', 'gpt-6.1-sol', 'low'], ['regular', 'gpt-6.1-sol', 'medium'], ['advanced', 'gpt-6-astra', 'medium'], ['complex', 'gpt-6-astra', 'high']],
};

const copy = {
  'zh-CN': {
    2: [
      ['常规', '目标和范围明确，可直接处理、进行少量判断，或按常规方法分步骤完成。不需要深入处理相互影响的因素、矛盾证据或关键未知。',
        '从这份通知中提取活动时间、地点和报名截止日期。',
        '根据这些活动信息，写一封简洁的邀请邮件。',
        '根据给定的预算、人数和课程清单，安排一次培训的日程与费用。',
        '为现有列表增加分页，处理加载失败并验证。'],
      ['复杂', '需要深入分析多个相互影响的因素、权衡冲突约束，或在关键不确定性下界定问题、比较方案并检验假设。专业领域或步骤多本身不代表复杂。',
        '结合销售、价格和渠道数据，分析业绩下滑的可能原因，区分已有证据和待验证假设。',
        '根据相互矛盾的市场资料，评估是否进入新市场，比较不同情景并说明还需验证什么。',
        '设计支持多端并发编辑和故障恢复的同步方案，比较冲突处理策略及其代价。'],
    ],
    3: [
      ['简单', '目标明确、范围较小，可按给定规则直接处理，或只需少量组织和判断；结果容易核对，不需要多步骤综合分析。',
        '把这段活动提醒改得更礼貌，保留原有时间和地点。',
        '把这份会议记录整理为待办，列出负责人和截止日期；未提到的标为待确认。',
        '把按钮文案从“确定”改为“保存”。'],
      ['常规', '目标与主要约束明确，需要多个步骤，综合若干信息完成分析、计划或实现。有清楚的处理路径，不涉及关键未知或复杂的因素相互影响。',
        '依据给定的价格、交期和质量评分，按指定权重比较三家供应商并推荐一家。',
        '根据培训目标、人数、预算和可用时段，制定培训安排并核对费用。',
        '为现有列表增加分页，处理加载失败并验证。'],
      ['复杂', '需要分析多个相互影响的因素、比较存在明显取舍的方案，或处理开放目标、矛盾证据与关键未知，并检验重要假设。',
        '结合销售、价格和渠道变化分析业绩下滑，提出能区分不同原因的验证办法。',
        '在预算削减、交付日期不变且多个团队相互依赖的情况下，比较项目调整方案及风险。',
        '设计支持多端并发编辑和故障恢复的同步方案，分析冲突、一致性和性能之间的取舍。'],
    ],
    5: [
      ['简单', '目标和规则明确，可直接完成字段提取、格式转换、基础解释或短句与局部修改，不需要重组多项信息或组织完整内容。材料长或涉及专业术语本身不提高级别。',
        '从这份通知中提取活动时间、地点和报名截止日期。',
        '把这句提醒改得更礼貌，不改变原意。',
        '把按钮文案从“确定”改为“保存”。'],
      ['轻量', '需要将多项信息重新组织为一份简短清单、通知、邮件，或完成有少量判断的小任务。比直接提取或改一句话多一层组织，但不涉及分阶段计划、多维度比较或多步骤计算核对。',
        '把会议记录整理为待办，列出负责人和截止日期；缺失的信息标为待确认。',
        '根据给定的活动信息，写一封面向新客户的简短邀请邮件。',
        '按现有表单规范增加一个必填输入项，并补上空值提示。'],
      ['常规', '目标和主要约束明确，需要分步骤计算并核对、按多个指标比较，或制定分阶段计划、完成常规实现。有明确处理路径，因素之间的复杂关联和关键未知较少。',
        '依据给定的价格、交期和质量评分，按指定权重比较三家供应商并推荐一家。',
        '根据培训目标、人数、预算和可用时段，制定培训安排并核对费用。',
        '为现有列表增加分页，处理加载失败并验证。'],
      ['进阶', '目标已确定，但多个因素相互影响或约束存在冲突，需要解释差异、诊断原因、比较方案并权衡代价；问题范围和主要判断依据基本清楚。',
        '结合销售、价格和渠道数据，分析业绩下滑的可能原因，区分相关性与因果解释。',
        '在预算削减、交付日期不变且团队相互依赖的情况下，比较项目调整方案并说明取舍。',
        '定位多个模块交互导致的偶发重复提交，比较修复方案及对现有行为的影响。'],
      ['复杂', '目标开放或存在关键不确定性，需要界定问题、综合大量关联信息、处理矛盾证据、比较多条路径并检验重要假设。无法仅依靠已有判断依据完成取舍。',
        '根据相互矛盾的市场资料，评估是否进入新市场，建立不同情景并设计验证关键假设的办法。',
        '在需求预测分歧和供应中断风险下，设计供应链调整方案，检验成本与服务水平在不同情景中的表现。',
        '设计支持多端并发编辑与故障恢复的同步方案，在负载和故障模式尚不确定时明确假设、比较策略并设计验证。'],
    ],
  },
  en: {
    2: [
      ['Regular', 'The goal and scope are clear. Complete the task directly, with limited judgment, or through routine steps. No deep analysis of interacting factors, conflicting evidence, or critical unknowns is needed.',
        'Extract the event time, location, and registration deadline from this notice.',
        'Write a concise invitation email using these event details.',
        'Use the given budget, participant count, and course list to plan a training schedule and its costs.',
        'Add pagination to an existing list, handle loading failures, and verify the behavior.'],
      ['Complex', 'Requires in-depth analysis of interacting factors, trade-offs between conflicting constraints, or framing a problem, comparing options, and testing assumptions under critical uncertainty. A specialist domain or many steps alone do not make a task complex.',
        'Use sales, pricing, and channel data to analyze possible reasons for declining performance, separating evidence from assumptions that need testing.',
        'Assess whether to enter a new market using conflicting reports; compare scenarios and identify what still needs validation.',
        'Design synchronization with concurrent editing across devices and recovery from failures; compare conflict-resolution strategies and their costs.'],
    ],
    3: [
      ['Simple', 'The goal is clear and the scope is small. Follow supplied rules directly or use limited organization and judgment. The result is easy to check and needs no multi-step synthesis.',
        'Make this event reminder more polite while preserving the time and location.',
        'Turn these meeting notes into action items with owners and deadlines; mark missing details as unconfirmed.',
        'Change the button label from “OK” to “Save”.'],
      ['Regular', 'The goal and main constraints are clear. Combine several pieces of information in multiple steps to produce an analysis, plan, or implementation. There is a clear approach without critical unknowns or complex interactions.',
        'Compare three suppliers using the provided price, delivery, and quality scores and specified weights; recommend one.',
        'Plan a training session from its goals, participant count, budget, and available time slots; check the costs.',
        'Add pagination to an existing list, handle loading failures, and verify the behavior.'],
      ['Complex', 'Analyze interacting factors and meaningful trade-offs, or handle open-ended goals, conflicting evidence, and critical unknowns while testing important assumptions.',
        'Analyze declining performance using sales, pricing, and channel changes; propose checks that distinguish competing explanations.',
        'Compare project adjustments and risks when the budget is cut, the deadline is fixed, and several teams depend on one another.',
        'Design synchronization with concurrent editing across devices and recovery from failures; analyze trade-offs in conflict handling, consistency, and performance.'],
    ],
    5: [
      ['Simple', 'The goal and rules are explicit. Extract fields, convert formats, give basic explanations, or edit a sentence or local detail directly, without reorganizing multiple details or composing a complete piece. Long material or specialist terminology alone does not raise the level.',
        'Extract the event time, location, and registration deadline from this notice.',
        'Make this reminder sentence more polite without changing its meaning.',
        'Change the button label from “OK” to “Save”.'],
      ['Light', 'Reorganize multiple details into one short checklist, notice, or email, or complete a small task requiring limited judgment. This involves more organization than direct extraction or editing a sentence, but no phased planning, multi-criteria comparisons, or multi-step calculations and checks.',
        'Turn meeting notes into action items with owners and deadlines; mark missing details as unconfirmed.',
        'Write a short invitation email for new customers using the supplied event details.',
        'Add a required input and an empty-value message following the existing form conventions.'],
      ['Regular', 'The goal and main constraints are clear. Perform and check multi-step calculations, compare several criteria, build a phased plan, or complete a routine implementation. The approach is established, with few complex interactions or critical unknowns.',
        'Compare three suppliers using the provided price, delivery, and quality scores and specified weights; recommend one.',
        'Plan a training session from its goals, participant count, budget, and available time slots; check the costs.',
        'Add pagination to an existing list, handle loading failures, and verify the behavior.'],
      ['Advanced', 'The goal is established, but factors interact or constraints conflict. Explain differences, diagnose causes, compare alternatives, and weigh trade-offs. The problem scope and main decision criteria are largely known.',
        'Use sales, pricing, and channel data to analyze possible reasons for declining performance, distinguishing correlation from causal explanations.',
        'Compare project adjustments when the budget is cut, the deadline is fixed, and teams depend on each other; explain the trade-offs.',
        'Diagnose intermittent duplicate submissions caused by interactions between modules; compare fixes and their effects on existing behavior.'],
      ['Complex', 'Open-ended goals or critical uncertainty require framing the problem, synthesizing interrelated information, resolving conflicting evidence, comparing multiple paths, and testing key assumptions. Existing decision criteria alone are insufficient.',
        'Assess entry into a new market using conflicting reports; develop scenarios and ways to test the key assumptions.',
        'Design supply-chain changes under conflicting demand forecasts and disruption risks; test costs and service levels across scenarios.',
        'Design synchronization with concurrent editing across devices and recovery from failures when workloads and failure modes are uncertain; state assumptions, compare strategies, and design validation.'],
    ],
  },
};

export function defaults(count = 3, language = 'zh-CN') {
  const selected = Object.hasOwn(routes, count) ? count : 3;
  const text = copy[language === 'en' ? 'en' : 'zh-CN'][selected];
  const tiers = routes[selected].map(([id, model, effort], i) => {
    const [name, description, ...tasks] = text[i];
    return tier(id, name, description, model, effort, ...tasks);
  });
  return { version: 1, classifier: { model: 'gpt-6-luna', effort: 'low' }, timeoutMs: 20000, fallbackTierId: selected === 2 ? 'simple' : 'regular', tiers };
}
