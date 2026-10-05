import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { Dialog, Notification, showDialog } from '@jupyterlab/apputils';
import { IMainMenu } from '@jupyterlab/mainmenu';
import {
  Contents,
  IDefaultDrive,
  ServiceManagerPlugin
} from '@jupyterlab/services';
import { Widget } from '@lumino/widgets';

import { RemoteDrive } from './drive';
import { migrateLocalFiles } from './migration';
import { seedServedFiles } from './seed';
import { Session } from './session';

const LOGOUT_COMMAND = 'cstj-remote-drive:logout';

/**
 * Partagée par les deux plugins (même bundle).
 */
const session = Session.fromPageConfig();

/**
 * Remplace le drive IndexedDB de JupyterLite (désactivé dans
 * jupyter-lite.json) par le drive distant. L'activation attend la connexion
 * de l'étudiant : JupyterLite ne démarre qu'une fois authentifié.
 */
const drivePlugin: ServiceManagerPlugin<Contents.IDrive> = {
  id: 'cstj-remote-drive:drive',
  description: 'Drive par défaut qui enregistre les fichiers sur le serveur du cours.',
  autoStart: true,
  provides: IDefaultDrive,
  activate: async (_: null): Promise<Contents.IDrive> => {
    await session.ensureLoggedIn();
    return new RemoteDrive(session);
  }
};

/**
 * Interface : nom de l'étudiant et déconnexion, puis, une fois l'application
 * prête, copie des fichiers fournis et import des anciens fichiers locaux.
 */
const uiPlugin: JupyterFrontEndPlugin<void> = {
  id: 'cstj-remote-drive:ui',
  description: "Affiche l'étudiant connecté et importe ses fichiers locaux.",
  autoStart: true,
  optional: [IMainMenu],
  activate: (app: JupyterFrontEnd, mainMenu: IMainMenu | null) => {
    app.commands.addCommand(LOGOUT_COMMAND, {
      label: () => `Se déconnecter (${session.user?.username ?? ''})`,
      caption: 'Fermer la session sur cet ordinateur',
      execute: () => logout()
    });

    mainMenu?.fileMenu.addGroup([{ command: LOGOUT_COMMAND }], 1000);

    try {
      app.shell.add(createUserWidget(app), 'top', { rank: 1000 });
    } catch {
      // Certaines interfaces n'ont pas de zone « top » : le menu Fichier suffit.
    }

    void app.restored.then(() => synchronize(app));
  }
};

async function synchronize(app: JupyterFrontEnd): Promise<void> {
  let changed = false;

  try {
    changed = (await seedServedFiles(session)) > 0;
  } catch (error) {
    console.warn('cstj-remote-drive : copie des fichiers fournis impossible', error);
  }

  try {
    changed = (await migrateLocalFiles(session)) || changed;
  } catch (error) {
    console.error('cstj-remote-drive : import des fichiers locaux impossible', error);
    Notification.error(
      "L'import des fichiers de cet ordinateur a échoué. Il sera proposé de nouveau à la prochaine ouverture."
    );
  }

  if (changed && app.commands.hasCommand('filebrowser:refresh')) {
    await app.commands.execute('filebrowser:refresh');
  }
}

async function logout(): Promise<void> {
  const result = await showDialog({
    title: 'Se déconnecter ?',
    body:
      'Les modifications non enregistrées seront perdues. ' +
      'Enregistrez vos fichiers avant de vous déconnecter.',
    buttons: [
      Dialog.cancelButton({ label: 'Annuler' }),
      Dialog.warnButton({ label: 'Se déconnecter' })
    ]
  });

  if (result.button.accept) {
    await session.logout();
    window.location.reload();
  }
}

function createUserWidget(app: JupyterFrontEnd): Widget {
  const node = document.createElement('div');
  node.className = 'cstj-remote-drive-user';

  const name = document.createElement('span');
  name.className = 'cstj-remote-drive-user-name';
  name.textContent = session.user?.name || session.user?.username || '';
  name.title = `Connecté en tant que ${session.user?.username ?? ''}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'jp-Button jp-mod-minimal cstj-remote-drive-logout';
  button.textContent = 'Se déconnecter';
  button.addEventListener('click', () => void app.commands.execute(LOGOUT_COMMAND));

  node.append(name, button);

  const widget = new Widget({ node });
  widget.id = 'cstj-remote-drive-user';

  return widget;
}

const plugins = [drivePlugin, uiPlugin];

export default plugins;
