import katex from "../libs/katex/katex.mjs"

export function initLatex() {
    const latex_tags = document.querySelectorAll(".latex")
    for (const latex_tag of latex_tags) {
        katex.render(latex_tag.textContent, latex_tag, {
            throwOnError: false
        });
    }
}

export function initHighlight() {
    Prism.highlightAll()
}