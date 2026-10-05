const { floor, random, PI } = Math

const canvas = document.querySelector("canvas.bg")
const ctx = canvas.getContext("2d")

requestAnimationFrame(render)

const dots = []

const density = 0.3
const connect_range = 50
const global_speed = 0.2

resizeHandler()
window.addEventListener("resize", resizeHandler)

const area = canvas.width * canvas.height
const nb_dots = floor(area / 1000) * density

for (let i = 0; i < nb_dots; i++) {
    dots.push({
        x: random() * canvas.width,
        y: random() * canvas.height,
        vx: random() * 2 - 1,
        vy: random() * 2 - 1,
    })
}

function resizeHandler() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
}

function render(_delta) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    ctx.strokeStyle = "#6f3483"
    ctx.fillStyle = "#6f3483"

    for (const dot of dots) {
        dot.x += dot.vx * global_speed
        dot.y += dot.vy * global_speed

        if (dot.x < 0 || dot.x > canvas.width) {
            dot.vx *= -1
        }
        if (dot.y < 0 || dot.y > canvas.height) {
            dot.vy *= -1
        }

        ctx.beginPath()
        ctx.arc(dot.x, dot.y, 2, 0, PI * 2)
        ctx.fill()

        for (const other of dots) {
            if (distanceSq(dot, other) < connect_range ** 2) {
                ctx.beginPath()
                ctx.moveTo(dot.x, dot.y)
                ctx.lineTo(other.x, other.y)
                ctx.stroke()
            }
        }
    }

    requestAnimationFrame(render)
}

function distanceSq(pt0, pt1) {
    return ((pt1.x - pt0.x) ** 2) + ((pt1.y - pt0.y) ** 2)
}