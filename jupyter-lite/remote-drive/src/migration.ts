import { Dialog, Notification, showDialog } from '@jupyterlab/apputils';
import { PageConfig, PathExt } from '@jupyterlab/coreutils';
import { Contents, ServerConnection } from '@jupyterlab/services';
import { Widget } from '@lumino/widgets';

import { toSaveBody } from './drive';
import { Session } from './session';

/**
 * Import des fichiers que l'ancien stockage de JupyterLite (IndexedDB du
 * navigateur) contient encore sur cet ordinateur.
 *
 * Chaque fichier est créé sur le serveur seulement s'il n'y existe pas. S'il
 * existe avec un contenu différent (ex. un autre ordinateur l'a déjà
 * importé), l'étudiant choisit : garder la version en ligne, la remplacer, ou
 * garder les deux. Une copie locale est effacée une fois traitée, pour ne pas
 * être importée de nouveau (ni dans le compte d'un autre étudiant).
 */

const IGNORE_KEY_PREFIX = 'cstj-remote-drive:ignore-local:';

const BUTTONS = {
  import: 'Importer',
  later: 'Plus tard',
  never: 'Ne plus demander'
};

const RESOLUTIONS = {
  server: 'Garder la version en ligne',
  local: 'Remplacer par celle de cet ordinateur',
  both: 'Garder les deux'
};

type Resolution = keyof typeof RESOLUTIONS;

interface ILocalEntry {
  path: string;
  model: Contents.IModel;
}

interface IReport {
  imported: string[];
  identical: number;
  kept: string[];
  replaced: string[];
  duplicated: string[];
  skipped: string[];
  errors: string[];
}

/**
 * @returns vrai si des fichiers ont été ajoutés ou modifiés sur le serveur.
 */
export async function migrateLocalFiles(session: Session): Promise<boolean> {
  const username = session.user?.username;
  if (!username || readFlag(IGNORE_KEY_PREFIX + username)) {
    return false;
  }

  const database = await openLocalDatabase(storageName());
  if (!database) {
    return false;
  }

  try {
    const entries = await readEntries(database);
    const files = entries.filter(entry => entry.model?.type !== 'directory');

    if (!files.length) {
      return false;
    }

    const choice = await askToImport(files, username);

    if (choice === 'never') {
      writeFlag(IGNORE_KEY_PREFIX + username);
    }

    if (choice !== 'import') {
      return false;
    }

    const report = await importEntries(session, database, entries, files);
    await showReport(report);

    return (
      report.imported.length + report.replaced.length + report.duplicated.length > 0
    );
  } finally {
    database.close();
  }
}

async function importEntries(
  session: Session,
  database: IDBDatabase,
  entries: ILocalEntry[],
  files: ILocalEntry[]
): Promise<IReport> {
  const report: IReport = {
    imported: [],
    identical: 0,
    kept: [],
    replaced: [],
    duplicated: [],
    skipped: [],
    errors: []
  };

  // Dossiers d'abord (y compris les parents implicites), du moins profond au plus profond.
  const directories = new Set<string>();
  for (const entry of entries) {
    if (entry.model?.type === 'directory') {
      directories.add(entry.path);
    }
    for (let parent = PathExt.dirname(entry.path); parent; parent = PathExt.dirname(parent)) {
      directories.add(parent);
    }
  }

  const failedDirectories = new Set<string>();
  for (const directory of [...directories].sort((a, b) => depth(a) - depth(b))) {
    try {
      await session.request('PUT', 'files', { body: { path: directory, type: 'directory' } });
    } catch (error) {
      failedDirectories.add(directory);
      report.errors.push(`${directory}/ : ${message(error)}`);
    }
  }

  let applyToAll: Resolution | null = null;

  for (const { path, model } of files) {
    if ([...failedDirectories].some(directory => path.startsWith(directory + '/'))) {
      report.skipped.push(path);
      continue;
    }

    const body: Record<string, unknown> & { path: string } = { path, ...toSaveBody(model) };

    try {
      await session.request('PUT', 'files', { body: { ...body, expected_hash: null } });
      report.imported.push(path);
      await deleteLocal(database, path);
      continue;
    } catch (error) {
      if (!isConflict(error)) {
        report.errors.push(`${path} : ${message(error)}`);
        continue;
      }
    }

    try {
      const remote = await session.json<Contents.IModel>('GET', 'files', {
        query: { path, ...(body.type === 'file' ? { format: body.format as string } : {}) }
      }).catch(() => null);

      if (remote && sameContent(remote, body)) {
        report.identical++;
        await deleteLocal(database, path);
        continue;
      }

      let resolution: Resolution | null = applyToAll;
      if (!resolution) {
        const answer = await askConflict(path, model, remote);
        resolution = answer.resolution;
        if (answer.applyToAll && resolution) {
          applyToAll = resolution;
        }
      }

      switch (resolution) {
        case 'server':
          report.kept.push(path);
          break;
        case 'local':
          await session.request('PUT', 'files', { body });
          report.replaced.push(path);
          break;
        case 'both':
          report.duplicated.push(await saveUnderFreeName(session, body));
          break;
        default:
          // Fenêtre fermée sans choisir : on garde la copie locale pour plus tard.
          report.skipped.push(path);
          continue;
      }

      await deleteLocal(database, path);
    } catch (error) {
      report.errors.push(`${path} : ${message(error)}`);
    }
  }

  // Les dossiers locaux ne servent plus quand tout a été traité.
  if (!report.errors.length && !report.skipped.length) {
    for (const directory of directories) {
      await deleteLocal(database, directory);
    }
  }

  return report;
}

/**
 * Enregistre la version locale sous « nom (cet ordinateur).ext »,
 * « nom (cet ordinateur 2).ext »… sans rien écraser.
 */
async function saveUnderFreeName(
  session: Session,
  body: Record<string, unknown> & { path: string }
): Promise<string> {
  const directory = PathExt.dirname(body.path);
  const extension = PathExt.extname(body.path);
  const stem = PathExt.basename(body.path, extension);

  for (let i = 1; i < 100; i++) {
    const suffix = i === 1 ? ' (cet ordinateur)' : ` (cet ordinateur ${i})`;
    const path = PathExt.join(directory, `${stem}${suffix}${extension}`);

    try {
      await session.request('PUT', 'files', { body: { ...body, path, expected_hash: null } });
      return path;
    } catch (error) {
      if (!isConflict(error)) {
        throw error;
      }
    }
  }

  throw new Error('Impossible de trouver un nom libre.');
}

// ----------------------------------------------------------------------
// Dialogues
// ----------------------------------------------------------------------

async function askToImport(files: ILocalEntry[], username: string): Promise<keyof typeof BUTTONS | null> {
  const node = document.createElement('div');
  node.style.maxWidth = '520px';

  const intro = document.createElement('p');
  intro.textContent =
    `Cet ordinateur contient ${files.length} fichier(s) enregistré(s) avant la sauvegarde en ligne. ` +
    `Voulez-vous les importer dans votre espace (${username}) ?`;
  node.append(intro, fileList(files.map(file => file.path)));

  const warning = document.createElement('p');
  warning.textContent =
    "S'il ne s'agit pas de vos fichiers (ordinateur partagé), choisissez « Ne plus demander ». " +
    "Une fois importés, les fichiers sont retirés du stockage local de ce navigateur.";
  node.append(warning);

  const result = await showDialog({
    title: 'Fichiers trouvés sur cet ordinateur',
    body: new Widget({ node }),
    buttons: [
      Dialog.cancelButton({ label: BUTTONS.later }),
      Dialog.warnButton({ label: BUTTONS.never }),
      Dialog.okButton({ label: BUTTONS.import })
    ]
  });

  return labelToKey(BUTTONS, result.button.label);
}

async function askConflict(
  path: string,
  local: Contents.IModel,
  remote: Contents.IModel | null
): Promise<{ resolution: Resolution | null; applyToAll: boolean }> {
  const node = document.createElement('div');
  node.style.maxWidth = '520px';

  const intro = document.createElement('p');
  intro.textContent = `« ${path} » existe déjà dans votre espace en ligne, avec un contenu différent.`;
  node.append(intro);

  const dates = document.createElement('ul');
  for (const [label, value] of [
    ['Version en ligne', remote?.last_modified],
    ['Version de cet ordinateur', local.last_modified]
  ]) {
    const item = document.createElement('li');
    item.textContent = `${label} : modifiée le ${formatDate(value)}`;
    dates.append(item);
  }
  node.append(dates);

  const result = await showDialog({
    title: 'Conflit de fichiers',
    body: new Widget({ node }),
    checkbox: { label: 'Appliquer ce choix aux autres conflits', checked: false },
    buttons: [
      Dialog.cancelButton({ label: RESOLUTIONS.server }),
      Dialog.warnButton({ label: RESOLUTIONS.local }),
      Dialog.okButton({ label: RESOLUTIONS.both })
    ]
  });

  // Échap renvoie un bouton « Cancel » générique : aucune décision.
  const resolution = labelToKey(RESOLUTIONS, result.button.label);

  return { resolution, applyToAll: !!result.isChecked };
}

async function showReport(report: IReport): Promise<void> {
  const lines: string[] = [];

  if (report.imported.length) {
    lines.push(`${report.imported.length} fichier(s) importé(s).`);
  }
  if (report.identical) {
    lines.push(`${report.identical} fichier(s) déjà identique(s) en ligne.`);
  }
  if (report.kept.length) {
    lines.push(`${report.kept.length} version(s) en ligne conservée(s).`);
  }
  if (report.replaced.length) {
    lines.push(`${report.replaced.length} fichier(s) remplacé(s) par la version de cet ordinateur.`);
  }
  if (report.duplicated.length) {
    lines.push(`${report.duplicated.length} copie(s) créée(s) : ${report.duplicated.join(', ')}.`);
  }
  if (report.skipped.length) {
    lines.push(`${report.skipped.length} fichier(s) laissé(s) sur cet ordinateur (la question sera reposée).`);
  }

  if (!report.errors.length) {
    Notification.success(`Import terminé. ${lines.join(' ')}`, { autoClose: 10000 });
    return;
  }

  const node = document.createElement('div');
  node.style.maxWidth = '520px';
  for (const line of lines) {
    const paragraph = document.createElement('p');
    paragraph.textContent = line;
    node.append(paragraph);
  }
  const intro = document.createElement('p');
  intro.textContent =
    "Ces fichiers n'ont pas pu être importés ; ils restent sur cet ordinateur et l'import sera proposé de nouveau :";
  node.append(intro, fileList(report.errors));

  await showDialog({
    title: 'Import incomplet',
    body: new Widget({ node }),
    buttons: [Dialog.okButton({ label: 'OK' })]
  });
}

function fileList(items: string[]): HTMLElement {
  const list = document.createElement('ul');
  list.style.maxHeight = '200px';
  list.style.overflow = 'auto';

  for (const text of items.slice(0, 50)) {
    const item = document.createElement('li');
    item.textContent = text;
    list.append(item);
  }

  if (items.length > 50) {
    const more = document.createElement('li');
    more.textContent = `… et ${items.length - 50} autre(s)`;
    list.append(more);
  }

  return list;
}

// ----------------------------------------------------------------------
// Lecture de l'ancien stockage (IndexedDB géré par localforage)
// ----------------------------------------------------------------------

/**
 * Même nom que le drive par défaut de JupyterLite 0.7
 * (@jupyterlite/services-extension:default-drive).
 */
function storageName(): string {
  return (
    PageConfig.getOption('contentsStorageName') ||
    `JupyterLite Storage - ${PageConfig.getOption('baseUrl')}`
  );
}

/**
 * Ouvre la base IndexedDB seulement si elle existe déjà (sans la créer).
 */
async function openLocalDatabase(name: string): Promise<IDBDatabase | null> {
  if (!window.indexedDB) {
    return null;
  }

  try {
    if (typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      if (!databases.some(database => database.name === name)) {
        return null;
      }
    }
  } catch {
    // indexedDB.databases() indisponible : on essaie d'ouvrir.
  }

  return new Promise(resolve => {
    let created = false;
    const request = indexedDB.open(name);

    request.onupgradeneeded = () => {
      // La base n'existait pas : on annule pour ne pas la créer.
      created = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      const database = request.result;
      if (created || !database.objectStoreNames.contains('files')) {
        database.close();
        resolve(null);
      } else {
        resolve(database);
      }
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function readEntries(database: IDBDatabase): Promise<ILocalEntry[]> {
  return new Promise((resolve, reject) => {
    const store = database.transaction('files', 'readonly').objectStore('files');
    const keysRequest = store.getAllKeys();
    const valuesRequest = store.getAll();

    valuesRequest.onsuccess = () => {
      const keys = keysRequest.result as IDBValidKey[];
      const values = valuesRequest.result as Contents.IModel[];

      resolve(
        keys
          .map((key, index) => ({ path: String(key).replace(/^\/+/, ''), model: values[index] }))
          .filter(entry => entry.path && entry.model && typeof entry.model === 'object')
      );
    };
    valuesRequest.onerror = () => reject(valuesRequest.error);
  });
}

function deleteLocal(database: IDBDatabase, path: string): Promise<void> {
  const stores = ['files', 'checkpoints'].filter(name => database.objectStoreNames.contains(name));

  return new Promise(resolve => {
    const transaction = database.transaction(stores, 'readwrite');
    for (const store of stores) {
      transaction.objectStore(store).delete(path);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

// ----------------------------------------------------------------------
// Outils
// ----------------------------------------------------------------------

function sameContent(remote: Contents.IModel, body: Record<string, unknown>): boolean {
  if (body.type === 'notebook') {
    return deepEqual(remote.content, body.content);
  }

  return remote.format === body.format && remote.content === body.content;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  return (
    keysA.length === keysB.length &&
    keysA.every(key =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    )
  );
}

function isConflict(error: unknown): boolean {
  return error instanceof ServerConnection.ResponseError && error.response.status === 409;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function depth(path: string): number {
  return path.split('/').length;
}

function formatDate(value: string | undefined): string {
  const date = value ? new Date(value) : null;
  return date && !isNaN(date.getTime()) ? date.toLocaleString('fr-CA') : 'date inconnue';
}

function labelToKey<T extends Record<string, string>>(labels: T, label: string): keyof T | null {
  const entry = Object.entries(labels).find(([, value]) => value === label);
  return entry ? (entry[0] as keyof T) : null;
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Sans stockage, la question sera reposée.
  }
}
