import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist/latin-700.css';
import './style.css';
import lightWorkspace from './assets/workspace-light.webp';
import darkWorkspace from './assets/workspace-dark.webp';
import branchImage from './assets/branch.webp';
import pathImage from './assets/path.webp';

// Native CSS, Thinkraph's existing brand. Variance 6 / motion 3 / density 3.
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const hero = document.querySelector('.hero-visual');
const heroImage = document.querySelector('#hero-image');
const heroSource = hero.querySelector('source');
const themeToggle = document.querySelector('#theme-toggle');
const effectiveTheme = () => document.documentElement.dataset.theme || (systemTheme.matches ? 'dark' : 'light');
function updateTheme() {
  const dark = effectiveTheme() === 'dark';
  // Manual preference takes priority over the picture element's system media.
  heroSource.media = '(min-width: 0px)';
  heroSource.srcset = dark ? darkWorkspace : lightWorkspace;
  heroImage.src = dark ? darkWorkspace : lightWorkspace;
  heroImage.width = dark ? 1440 : 1680;
  heroImage.height = dark ? 900 : 1050;
  themeToggle.textContent = dark ? '浅色模式' : '深色模式';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#15241c' : '#f5f8f4';
}
themeToggle.addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('thinkraph-site-theme', next); } catch {}
  updateTheme();
});
systemTheme.addEventListener('change', updateTheme);
updateTheme();

const scenes = {
  node: { image: lightWorkspace, title: '问题有位置，上下文跟着走。', description: '点击一个知识点，查看它的前置知识、对话、笔记和资料。下次回来，继续已有的探索。', detail: '对话按节点保存，切换主题也能回到原来的问题。', alt: 'RAG 节点及其学习对话，前置概念在画布上可见。' },
  branch: { image: branchImage, title: '想深入，就展开一个分支。', description: 'Agent 提出后续知识点，以草稿展示在图上。查看建议，再决定哪些值得继续学习。', detail: '预览后采纳，已有笔记和对话继续保留。', alt: '分支预览：文档切分策略与检索质量评估以虚线草稿展示，右侧可以选择采纳。' },
  path: { image: pathImage, title: '下一步学什么，看得见依据。', description: '学习路径按前置知识组织。结合掌握状态找到下一步，也可以自由进入感兴趣的节点。', detail: '掌握状态由你判断，学习路径提供方向。', alt: '学习路径按前置概念排列，并推荐前置知识已满足的上下文窗口节点。' },
};
const tabs = [...document.querySelectorAll('[role="tab"]')];
function chooseScene(tab) {
  for (const item of tabs) {
    item.setAttribute('aria-selected', String(item === tab));
    item.tabIndex = item === tab ? 0 : -1;
  }
  const scene = scenes[tab.dataset.scene];
  const image = document.querySelector('#scene-image');
  image.src = scene.image;
  image.alt = scene.alt;
  document.querySelector('#scene-title').textContent = scene.title;
  document.querySelector('#scene-description').textContent = scene.description;
  document.querySelector('#scene-detail').textContent = scene.detail;
  document.querySelector('#product-panel').setAttribute('aria-labelledby', tab.id);
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => chooseScene(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].focus();
    chooseScene(tabs[next]);
  });
});

let copyReset;
document.querySelector('#copy-setup').addEventListener('click', async () => {
  const button = document.querySelector('#copy-setup');
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(document.querySelector('#setup-command').textContent);
    button.textContent = '已复制';
    status.textContent = '命令已复制，可粘贴到终端运行。';
  } catch {
    status.textContent = '浏览器未允许复制，请选中上方命令手动复制。';
  }
  clearTimeout(copyReset);
  copyReset = setTimeout(() => { button.textContent = '复制命令'; }, 2500);
});
