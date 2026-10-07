// Example content is only attached when the user explicitly loads this template.
export const statusLabel = { mastered: '已掌握', learning: '学习中', todo: '未开始', draft: '待采纳' };
export const seedNodes = [
  { id: 'llm', position: { x: 0, y: 60 }, data: { description: '大语言模型是一类从大量文本中学习语言规律的模型。输入文本会被切分成 token，模型根据已有上下文估计下一个 token 的概率，再逐步生成回答。训练使它能够处理解释、改写、总结和代码等任务，但这种生成过程不等于从事实数据库中查出一个确定答案。例如，模型可以模仿文档的写法生成说明，也可能编造看似合理的细节。学习时应区分语言表达能力与事实可靠性，并对关键结论核对来源。', title: '大语言模型', subtitle: '理解模型在做什么', kind: '基础', icon: 'brain', status: 'mastered', minutes: 15, summary: '语言模型根据上下文预测后续 token。理解预测机制，有助于认识它的能力和局限。' } },
  { id: 'vector', position: { x: 0, y: 350 }, data: { description: '向量用一组有序数值表示一个对象的特征。把文本、图像或用户行为映射到同一个向量空间后，就能通过距离或相似度比较它们。余弦相似度衡量两个非零向量的方向是否接近，点积还会受到向量长度的影响。例如，在语义搜索中，可以比较问题向量与文档向量，找出可能相关的内容。不同模型的向量通常不能直接混用；相似度较高只说明表示接近，并不证明内容相同或事实正确。', title: '向量与相似度', subtitle: '如何衡量两个概念的距离', kind: '基础', icon: 'vector', status: 'mastered', minutes: 20, summary: '把对象表示为向量之后，可以用余弦相似度等方法比较它们的接近程度。' } },
  { id: 'prompt', position: { x: 295, y: 0 }, data: { description: '提示词工程是通过组织输入，让模型更清楚地理解任务、背景和输出要求的方法。常见做法是明确目标、给出必要资料、标出限制，并用少量例子说明期望的格式。例如，把“总结文章”改成“面向初学者，用三点总结以下文章，并注明文章未回答的问题”，能让结果更容易检查。提示词不能保证模型绝不犯错，也不能替代可靠数据与结果验证；改进时应使用具有代表性的输入比较效果。', title: '提示词工程', subtitle: '清楚地表达任务与约束', kind: '方法', icon: 'text', status: 'mastered', minutes: 20, summary: '明确任务、上下文、示例和输出格式，帮助模型生成更符合预期的结果。' } },
  { id: 'embedding', position: { x: 295, y: 270 }, data: { description: 'Embedding 是把文本等对象编码为数值向量的表示方法。模型把与任务相关的特征压缩到固定维度的空间中，使含义相近的内容在这个空间中通常更接近。例如，“如何修改登录密码”与“重置账号密码的方法”措辞不同，却可能获得较高的向量相似度。实际检索时，问题和文档应使用兼容的编码方式，并结合文本切分、元数据过滤或重排序提高结果质量。向量表示会丢失部分信息，不能单独用来证明逻辑蕴含或事实准确性。', title: 'Embedding', subtitle: '把语义变成可计算的向量', kind: '概念', icon: 'cube', status: 'mastered', minutes: 20, summary: 'Embedding 将文本映射到向量空间。可以通过向量之间的相似度寻找语义相关的文本。' } },
  { id: 'context', position: { x: 295, y: 535 }, data: { description: '上下文窗口是模型在一次推理中能够处理的 token 容量，通常需要共同容纳输入与生成输出，具体限制取决于接口。输入可能包括系统要求、历史消息、用户问题和检索资料。例如，把一份很长的文档与完整聊天记录同时传入时，可能需要截断、摘要或分段处理。窗口更大意味着能容纳更多信息，但不代表模型一定能准确定位或利用全部细节。组织资料时应保留与问题最相关的内容，并为回答预留容量。', title: '上下文窗口', subtitle: '模型一次能处理多少信息', kind: '概念', icon: 'stack', status: 'learning', minutes: 10, summary: '上下文窗口限制单次请求可处理的信息量。窗口内有信息，并不保证模型能准确使用每一处细节。' } },
  { id: 'rag', position: { x: 610, y: 160 }, data: { description: '检索增强生成把外部信息检索与语言模型生成连接起来。系统通常先整理文档、切分片段并建立检索索引；收到问题后检索相关片段，再把片段与问题一起交给模型回答。例如，企业知识库助手可以先查到某项流程的最新文档，再根据文档解释步骤。这样可以更新外部资料而不必每次重新训练模型，但检索遗漏、过期资料或模型误读都可能导致错误。评估时应分别检查检索是否找对内容、回答是否忠于依据，以及引用能否追溯。', title: 'RAG 检索增强生成', subtitle: '让模型带着资料回答', kind: '核心方法', icon: 'tree', status: 'learning', minutes: 25, summary: '先从外部知识库检索相关内容，再将这些内容交给语言模型生成回答。', question: 'RAG 与把所有文档直接放进 prompt，有什么区别？' } },
  { id: 'agent', position: { x: 610, y: 465 }, data: { description: 'Agent 是围绕目标组织模型、工具与状态的一种应用方式。它可以根据当前信息选择动作，调用搜索、计算或业务接口，再观察结果并决定下一步。例如，资料整理助手可能先搜索文件，再提取要点，最后输出带来源的总结。工具调用只提供动作能力，不保证任务已经正确完成；系统还需要明确工具权限、失败处理、停止条件与结果检查。对于外部写入或影响较大的操作，应设置相应的授权边界。', title: 'Agent 与工具调用', subtitle: '从回答问题到完成任务', kind: '应用', icon: 'flow', status: 'todo', minutes: 30, summary: 'Agent 围绕目标选择动作、调用工具并观察结果。工具返回的数据可以成为下一轮决策的上下文。' } }
].map(n => ({ ...n, type: 'knowledge' }));

export const seedEdges = [ ['llm', 'prompt'], ['vector', 'embedding'], ['llm', 'context'], ['prompt', 'rag'], ['embedding', 'rag'], ['prompt', 'agent'], ['context', 'agent'] ].map(([source, target]) => ({ id: `${source}-${target}`, source, target, type: 'default' }));
export const ragMessages = [
  { role: 'user', text: 'RAG 和把所有文档放进 prompt，有什么区别？' },
  { role: 'assistant', text: '可以把 RAG 理解成一次「开卷答题」。\n\n直接放入所有文档，像把整套书都摊在桌上。RAG 会先找到与问题相关的几页，再让模型据此作答。\n\n关键区别是多了检索这一步：它控制进入上下文的信息，减少无关内容。但答案质量仍取决于检索结果与生成过程。', source: true }
];
export const sourceMap = {
  rag: [{ title: 'Retrieval-Augmented Generation', meta: 'Lewis et al., 2020', type: '研究论文', url: 'https://arxiv.org/abs/2005.11401', note: 'RAG 的原始研究，介绍检索组件与生成模型的结合。' }],
  embedding: [{ title: 'Semantic Textual Similarity', meta: 'Sentence Transformers', type: '官方文档', url: 'https://www.sbert.net/docs/sentence_transformer/usage/semantic_textual_similarity.html', note: '使用文本向量与相似度计算，比较文本的语义接近程度。' }],
  vector: [{ title: 'Semantic Textual Similarity', meta: 'Sentence Transformers', type: '官方文档', url: 'https://www.sbert.net/docs/sentence_transformer/usage/semantic_textual_similarity.html', note: '查看余弦相似度在文本向量中的使用示例。' }]
};

export const quizMap = {
  rag: { question: '知识库有一万篇文档，用户只问其中一个问题。RAG 首先应该做什么？', answers: ['把一万篇文档全部放入上下文', '检索与问题相关的文档片段', '用这些文档重新训练整个模型'], correct: 1, explanation: '先检索相关片段，再把问题和片段交给模型。检索出错时，生成阶段也可能产生错误答案。' },
  embedding: { question: '文本 Embedding 在语义检索中主要起什么作用？', answers: ['将文本表示为可比较的向量', '保证模型回答永远正确', '把所有文字转换成图片'], correct: 0, explanation: 'Embedding 提供向量表示，便于进行相似度计算。向量相似并不等同于事实正确。' },
  context: { question: '增加上下文窗口，是否保证模型能准确利用所有信息？', answers: ['是，只要放得下就一定准确', '否，仍需要检查信息是否被正确使用', '是，可以完全避免生成错误'], correct: 1, explanation: '窗口描述容量，不保证模型准确使用其中的信息。还要考虑信息组织与实际评估。' }
};

export function getQuiz(node) {
  return quizMap[node.id] || { question: `学习「${node.data.title}」后，哪一种做法更能检查理解？`, answers: ['只重新阅读定义', '不看笔记，用自己的话解释并举一个例子', '把节点数量增加一倍'], correct: 1, explanation: '这是学习方法演示题。真实产品应结合该节点的学习目标生成并校验专属题目。' };
}
