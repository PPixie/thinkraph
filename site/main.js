import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist/latin-700.css';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Moon, Sun, TreeStructure, GitBranch, Stack, Path, Target, Notebook, Exam, FileText, Export, Cpu, Copy } from '@phosphor-icons/react';
import GraphDemo from './GraphDemo.jsx';
import './style.css';
import lightWorkspace from './assets/workspace-light.webp';
import darkWorkspace from './assets/workspace-dark.webp';
import branchImage from './assets/branch.webp';
import summaryImage from './assets/summary.webp';
import pathImage from './assets/path.webp';

// Native CSS with Thinkraph's existing green identity. Design variance 7,
// motion 4, density 4. UI radii: 8px controls, 12px nodes, 16px media panels.
const iconComponents = { node: TreeStructure, branch: GitBranch, summary: Stack, path: Path, target: Target, notes: Notebook, quiz: Exam, file: FileText, export: Export, model: Cpu, copy: Copy };
for (const element of document.querySelectorAll('[data-icon]')) {
  createRoot(element).render(createElement(iconComponents[element.dataset.icon], { size: 20, weight: 'regular' }));
}
createRoot(document.querySelector('#graph-demo')).render(createElement(GraphDemo));
const themeIcon = createRoot(document.querySelector('#theme-icon'));
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const effectiveTheme = () => document.documentElement.dataset.theme || (systemTheme.matches ? 'dark' : 'light');
const themeToggle = document.querySelector('#theme-toggle');
const image = document.querySelector('#scene-image');
const scenes = {
  node: { image: lightWorkspace, darkImage: darkWorkspace, title: '问题有位置，上下文跟着走。', description: '选择一个知识点，进入它自己的学习对话。Agent 结合当前节点、前置摘要、笔记和资料回答，切换节点后也能回到原来的探索。', detail: '每个知识点保留独立的对话记录。', alt: 'Thinkraph 真实工作台：选择 RAG 节点，右侧显示节点对话与前置知识上下文。' },
  branch: { image: branchImage, title: '追问一个分支，保留学习的主线。', description: '从当前节点出发，Agent 建议后续知识点与依赖，先以草稿展示。查看建议，再决定采纳哪些内容，让图谱按你的方向生长。', detail: '未采纳的建议不会写入正式图谱。', alt: 'Thinkraph 真实工作台：RAG 分支扩展显示文档切分与检索评估的虚线草稿，并提供采纳入口。' },
  summary: { image: summaryImage, title: '把几个知识点，整理成自己的理解。', description: '圈选相关节点，按学习依赖顺序整理概念、笔记与联系。编辑汇总草稿后，用一个汇总节点替换选中节点，并重连后续知识。', detail: '保存汇总正文与来源标题，替换可一次撤销。', alt: 'Thinkraph 真实工作台：提示词工程、Embedding 与 RAG 汇总为 RAG 核心知识总结，正文保存在节点笔记中。' },
  path: { image: pathImage, title: '下一步学什么，看得见依据。', description: '学习路径将前置知识排在后续知识之前，并结合掌握状态推荐可继续学习的节点。缺了什么基础、还能向哪里延伸，都有迹可循。', detail: '路径提供方向，也允许自由进入感兴趣的节点。', alt: 'Thinkraph 真实工作台：按前置依赖排列学习路径，并推荐已有基础满足的上下文窗口节点。' },
};
const tabs = [...document.querySelectorAll('.product-tabs [role="tab"]')];
let selectedScene = 'node';
function loadSceneImage() {
  const scene = scenes[selectedScene];
  const url = effectiveTheme() === 'dark' && scene.darkImage ? scene.darkImage : scene.image;
  document.querySelector('.image-error').hidden = true;
  image.hidden = false;
  image.src = url;
  image.alt = scene.alt;
}
image.addEventListener('error', () => { image.hidden = true; document.querySelector('.image-error').hidden = false; });
document.querySelector('#retry-image').addEventListener('click', loadSceneImage);
function updateTheme() {
  const dark = effectiveTheme() === 'dark';
  themeIcon.render(createElement(dark ? Sun : Moon, { size: 19 }));
  themeToggle.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
  themeToggle.title = dark ? '浅色模式' : '深色模式';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#13221c' : '#f7f9f7';
  loadSceneImage();
}
themeToggle.addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('thinkraph-site-theme', next); } catch {}
  updateTheme();
});
systemTheme.addEventListener('change', updateTheme);
updateTheme();
function chooseScene(tab) {
  selectedScene = tab.dataset.scene;
  for (const item of tabs) {
    item.setAttribute('aria-selected', String(item === tab));
    item.tabIndex = item === tab ? 0 : -1;
  }
  const scene = scenes[selectedScene];
  loadSceneImage();
  document.querySelector('#scene-title').textContent = scene.title;
  document.querySelector('#scene-description').textContent = scene.description;
  document.querySelector('#scene-detail').textContent = scene.detail;
  document.querySelector('#product-panel').setAttribute('aria-labelledby', tab.id);
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => chooseScene(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); tabs[next].focus(); chooseScene(tabs[next]);
  });
});
const mobileQuery = window.matchMedia('(max-width: 767px)');
function updateTabOrientation() { document.querySelector('.product-tabs').setAttribute('aria-orientation', mobileQuery.matches ? 'horizontal' : 'vertical'); }
mobileQuery.addEventListener('change', updateTabOrientation);
updateTabOrientation();
let copyReset;
document.querySelector('#copy-setup').addEventListener('click', async () => {
  const label = document.querySelector('#copy-label');
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(document.querySelector('#setup-command').textContent);
    label.textContent = '已复制'; status.textContent = '命令已复制，可粘贴到终端运行。';
  } catch {
    status.textContent = '浏览器未允许复制，请选中上方命令手动复制。';
  }
  clearTimeout(copyReset);
  copyReset = setTimeout(() => { label.textContent = '复制命令'; }, 2500);
});

// Reveals show the content hierarchy once. All content remains visible without JS.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
if (!reducedMotion.matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } });
  }, { threshold: .06 });
  for (const element of document.querySelectorAll('.problem, .explore, .learning-loop, .start, .faq')) {
    element.classList.add('reveal'); observer.observe(element);
  }
  reducedMotion.addEventListener('change', event => {
    if (event.matches) { document.querySelectorAll('.reveal').forEach(element => element.classList.add('is-visible')); observer.disconnect(); }
  });
}
