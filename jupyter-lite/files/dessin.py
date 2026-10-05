import matplotlib.pyplot as plt
import matplotlib.patches as patches

canvas = None
largeur = 100
hauteur = 100

couleur = "black"
couleur_bordure = "black"
largeur_bordure = 1
zorder_actuel = 1

def nouveau(largeur_pixels = 100, hauteur_pixels = 100, afficher_axes = True):
    global canvas
    global largeur
    global hauteur
    global couleur
    global couleur_bordure
    global largeur_bordure
    global zorder_actuel
    
    # Reset
    couleur = "black"
    couleur_bordure = "black"
    largeur_bordure = 1
    zorder_actuel = 1

    fig, ax = plt.subplots(figsize=(largeur_pixels / 72, hauteur_pixels / 72))
    canvas = ax

    ax.set_xlim(0, largeur_pixels)
    ax.set_ylim(0, hauteur_pixels)
    ax.set_aspect('equal')
    ax.axis(afficher_axes)

    largeur = largeur_pixels
    hauteur = hauteur_pixels

def rectangle(x, y, largeur, hauteur, plein = True, rotation=0, zorder=None):
    global zorder_actuel
    if zorder == None:
        zorder_actuel += 1
        zorder = zorder_actuel

    if plein:
        forme = patches.Rectangle((x, y), largeur, hauteur, color=couleur, fill=True, linewidth=0, angle=-rotation, zorder=zorder)
    else:
        forme = patches.Rectangle((x, y), largeur, hauteur, edgecolor=couleur_bordure, fill=False, linewidth=largeur_bordure, angle=-rotation, zorder=zorder)

    canvas.add_patch(forme)
    pass

def cercle(x, y, radius, plein = True, zorder=None):
    global zorder_actuel
    if zorder == None:
        zorder_actuel += 1
        zorder = zorder_actuel

    if plein:
        forme = patches.Circle((x, y), radius, color=couleur, fill=True, linewidth=0, zorder=zorder)
    else:
        forme = patches.Circle((x, y), radius, edgecolor=couleur_bordure, fill=False, linewidth=largeur_bordure, zorder=zorder)

    canvas.add_patch(forme)

def ellipse(x, y, largeur, hauteur, plein = True, rotation=0, zorder=None):
    global zorder_actuel
    if zorder == None:
        zorder_actuel += 1
        zorder = zorder_actuel

    if plein:
        forme = patches.Ellipse((x, y), largeur, hauteur, color=couleur, fill=True, linewidth=0, angle=-rotation, zorder=zorder)
    else:
        forme = patches.Ellipse((x, y), largeur, hauteur, edgecolor=couleur_bordure, fill=False, linewidth=largeur_bordure, angle=-rotation, zorder=zorder)

    canvas.add_patch(forme)


def ligne(x1, y1, x2, y2, zorder=None):
    global zorder_actuel
    if zorder == None:
        zorder_actuel += 1
        zorder = zorder_actuel

    plt.plot([x1, x2], [y1, y2], linestyle='-', color=couleur_bordure, linewidth=largeur_bordure, zorder=zorder)

def polygon(points, plein = True, zorder=None):
    global zorder_actuel
    if zorder == None:
        zorder_actuel += 1
        zorder = zorder_actuel

    if plein:
        forme = patches.Polygon(points, closed=True, facecolor=couleur, linewidth=0, zorder=zorder)
    else:
        forme = patches.Polygon(points, closed=True, facecolor=[0,0,0,0], edgecolor=couleur_bordure, linewidth=largeur_bordure, zorder=zorder)

    canvas.add_patch(forme)

def afficher():
    plt.show()