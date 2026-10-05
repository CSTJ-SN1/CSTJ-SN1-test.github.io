from math import cos, sin, radians
import matplotlib.pyplot as plt

# ====================================
# === Exemple d'utilisation:
# 
# import sys
# 
# # Ajoute le dossier du projet aux imports possibles
# sys.path.insert(0, "")
# 
# import tortue
# 
# tortue.nouveauDessin(100, 100, False)
# 
# tortue.afficherTortue()
# 
# tortue.leverCrayon()
# tortue.avancer(50)
# tortue.tourner(-90)
# tortue.avancer(50)
# tortue.tourner(90)
# 
# tortue.changerCouleurCrayon("black")
# tortue.changerTailleCrayon(2)
# tortue.appuyerCrayon()
# 
# for i in range(8):
#     tortue.avancer(10)
#     tortue.tourner(45)
#     tortue.dessiner(300, 300)
#
# ====================================
infos = None

def verifierTortue():
    if infos == None:
        print("Erreur: Il faut appeler la fonction nouveauDessin() avant d'utiliser la tortue.")
        raise

def nouveauDessin(largeur = 100, hauteur = 100, afficher_axes = True):
    global infos

    infos = {
        "x": 0,
        "y": 0,
        "angle": 0,
        "lignes": [], # Array of dict
        "points": [],
        "visible": False,
        "couleur_corps": "#2B9E48",
        "couleur_tete": "#1EE038",
        "page": {
            "largeur": largeur,
            "hauteur": hauteur,
            "afficher_axes": afficher_axes,
        },
        "crayon": {
            "actif": True,
            "taille": 1,
            "couleur": None,
        }
    }

    appuyerCrayon()

def avancer(distance):
    verifierTortue()

    infos["x"] += cos(radians(infos["angle"])) * distance
    infos["y"] += sin(radians(infos["angle"])) * distance

    if infos["crayon"]["actif"]:
        ligne_actuelle = infos["lignes"][-1]
        ligne_actuelle["list_x"].append(infos["x"])
        ligne_actuelle["list_y"].append(infos["y"])
    
def dessiner(largeur_pixels = 300, hauteur_pixels = 300):
    verifierTortue()

    scale_ratio = largeur_pixels / infos["page"]["largeur"]

    dpi = 72

    fig, ax = plt.subplots(figsize=(largeur_pixels / dpi, hauteur_pixels / dpi))

    ax.set_xlim(0, infos["page"]["largeur"])
    ax.set_ylim(0, infos["page"]["hauteur"])
    ax.set_aspect('equal')

    ax.axis(infos["page"]["afficher_axes"])

    for ligne in infos["lignes"]:
        ax.plot(ligne["list_x"], ligne["list_y"], linewidth=ligne["taille"] * scale_ratio, color=ligne["couleur"], solid_capstyle='round')

    for point in infos["points"]:
        plt.plot(point["x"], point["y"], marker='o', markersize=point["largeur"] * scale_ratio, color=point["couleur"])

    if (infos["visible"]):
        body_size = min(10, infos["page"]["largeur"] * 0.04)
        head_size = body_size * 0.5
        
        head_position_x = infos["x"] + cos(radians(infos["angle"])) * (body_size - (head_size * 0.7))
        head_position_y = infos["y"] + sin(radians(infos["angle"])) * (body_size - (head_size * 0.7))

        ax.plot(infos["x"], infos["y"], marker='o', markersize=body_size * scale_ratio, color=infos["couleur_corps"])
        ax.plot(head_position_x, head_position_y, marker='o', markersize=head_size * scale_ratio, color=infos["couleur_tete"])
    
    plt.show()


def changerTailleCrayon(taille):
    verifierTortue()
    infos["crayon"]["taille"] = taille

def changerCouleurCrayon(couleur):
    verifierTortue()
    infos["crayon"]["couleur"] = couleur

def appuyerCrayon():
    verifierTortue()
    infos["crayon"]["actif"] = True
    infos["lignes"].append({
        "list_x": [infos["x"]],
        "list_y": [infos["y"]],
        "taille": infos["crayon"]["taille"],
        "couleur": infos["crayon"]["couleur"],
    })

def leverCrayon():
    verifierTortue()
    infos["crayon"]["actif"] = False

def deplacerTortue(x, y):
    verifierTortue()
    infos["x"] = x
    infos["y"] = y

def tourner(degrees):
    verifierTortue()
    infos["angle"] += -degrees

def tournerAZero():
    verifierTortue()
    infos["angle"] = 0

def afficherTortue():
    verifierTortue()
    infos["visible"] = True

def cacherTortue():
    verifierTortue()
    infos["visible"] = False

def point(x, y, largeur = 2, couleur = "black"):
    verifierTortue()
    infos["points"].append({
        "x": x,
        "y": y,
        "largeur": largeur,
        "couleur": couleur,
    })