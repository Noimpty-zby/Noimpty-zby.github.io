'use strict'

// These are local teaching models; sending their code to the learning lab is a
// separate, explicit action and never runs code from the article automatically.
const topics = {
  array: ['数组为什么要挪？', '把插入和删除拆成一次次赋值，观察物理槽位、逻辑长度和移动次数。'],
  git: ['HEAD 到底跟着谁？', '亲手创建分支、切换和提交，看引用怎样在同一张提交图上移动。'],
  barycentric: ['一个像素怎样得到颜色？', '移动采样点，用重心坐标判断三角形覆盖，再把三个顶点颜色混合起来。']
}

hexo.extend.tag.register('learning_experiment', args => {
  if (args.length !== 1 || !Object.hasOwn(topics, args[0])) throw new Error('learning_experiment: 请选择 array、git 或 barycentric')
  const [title, description] = topics[args[0]]
  return `<section class="learning-experiment" data-experiment="${args[0]}" aria-label="${title}">` +
    `<p class="learning-experiment__eyebrow">动手实验 · 本地教学模型</p><h2>${title}</h2><p>${description}</p>` +
    '<div data-experiment-mount><p>启用 JavaScript 后，可以在这里逐步操作实验。</p></div></section>'
})
