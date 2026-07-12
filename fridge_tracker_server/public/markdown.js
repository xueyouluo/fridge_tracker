"use strict";

(function exposeMarkdown(root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("markdown-it"));
    return;
  }
  root.XianZhiMarkdown = factory(root.markdownit);
})(typeof window !== "undefined" ? window : globalThis, (MarkdownIt) => {
  if (!MarkdownIt) throw new Error("markdown-it is required");

  const markdown = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: false,
    typographer: false
  });

  markdown.disable("image");
  markdown.validateLink = (url) => /^https?:\/\//i.test(url);
  markdown.renderer.rules.table_open = () => '<div class="markdown-table-wrap"><table>\n';
  markdown.renderer.rules.table_close = () => "</table></div>\n";
  markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noreferrer noopener");
    return renderer.renderToken(tokens, index, options);
  };

  return {
    escapeHtml: (value) => markdown.utils.escapeHtml(String(value ?? "")),
    renderMarkdown: (value) => markdown.render(String(value ?? ""))
  };
});
