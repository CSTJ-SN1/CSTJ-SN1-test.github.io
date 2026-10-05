import { initLatex, initHighlight } from "../../js/utils.js"
import { capsules } from "./capsules.js"

const hash = window.location.hash.substring("#/".length)

if (hash.length === 0) {
    window.location.href = "../"
}

const hash_parts = hash.split("/")

const class_number = hash_parts[0]
const labs_html = await fetch(`../classes/${class_number}/labs.html`).then(r => r.text())
document.querySelector(".container").innerHTML = `<a href="../" class="back-home">← Accueil</a>` + labs_html

document.title = `Exercices | ${class_number} | Programmation en sciences | CSTJ | Eric Gagné`

addCapsuleButtons()
initLatex()
initHighlight()


function addCapsuleButtons() {
    const links = capsules[class_number] || []
    const exercises = document.querySelectorAll(".container > ol > li")
 
    exercises.forEach((exercise, index) => {
        const url = links[index]
        if (!url) return
 
        const button = document.createElement("a")
        button.className = "capsule"
        button.href = url
        button.target = "_blank"
        button.rel = "noopener"
        button.textContent = "▶ Capsule"
        button.title = `Voir la capsule de l'exercice ${index + 1}`
 
        const wrapper = document.createElement("div")
        wrapper.className = "capsule-wrapper"
        wrapper.appendChild(button)
        exercise.appendChild(wrapper)
    })
}