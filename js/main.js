if (window.location.href.indexOf("?debug") !== -1) {
    const hidden = document.querySelectorAll(".disabled")
    for (const tag of hidden) {
        tag.classList.remove("disabled")
    }
}