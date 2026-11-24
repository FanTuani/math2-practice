import markdownit from 'markdown-it';
import katex from 'katex';

const md = markdownit({html: false, breaks: true, linkify: false});
const mathPattern = /\$\$([\s\S]+?)\$\$|(?<!\\)\$((?:\\.|[^$])+?)(?<!\\)\$/g;
const originalImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, index, options, env, self) => {
  const image = tokens[index];
  const url = image.attrGet('src') || '';
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url)) return md.utils.escapeHtml(image.content);
  image.attrSet('loading', 'lazy');
  return originalImage(tokens, index, options, env, self);
};
window.renderPracticeMarkdown = function renderPracticeMarkdown(source) {
  const equations = [];
  // Protect TeX row breaks, underscores and alignment characters from Markdown.
  const text = String(source || '').replace(/[\uE000\uE001]/g, '').replace(mathPattern, (match, display, inline) => {
    const index = equations.length;
    equations.push(katex.renderToString(display ?? inline, {
      displayMode: display !== undefined, throwOnError: false, trust: false,
      strict: 'ignore', maxExpand: 1500, output: 'htmlAndMathml'
    }));
    return '\uE000' + index + '\uE001';
  });
  return md.render(text).replace(/\uE000(\d+)\uE001/g, (_, index) => equations[Number(index)]);
};
