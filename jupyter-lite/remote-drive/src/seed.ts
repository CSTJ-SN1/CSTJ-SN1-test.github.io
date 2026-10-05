import { PageConfig, URLExt } from '@jupyterlab/coreutils';
import { Contents, ServerConnection } from '@jupyterlab/services';

import { Session } from './session';

/**
 * Copie dans l'espace de l'étudiant les fichiers fournis avec le site
 * (dossier jupyter-lite/files/, ex. tortue.py et dessin.py) qui n'y sont pas
 * encore. Un fichier déjà présent n'est jamais écrasé, même s'il a été
 * modifié.
 *
 * @returns le nombre de fichiers ajoutés.
 */
export async function seedServedFiles(session: Session): Promise<number> {
  return seedDirectory(session, '');
}

async function seedDirectory(session: Session, path: string): Promise<number> {
  const served = await servedListing(path);
  if (!served.length) {
    return 0;
  }

  const remote = await session.json<Contents.IModel>('GET', 'files', { query: { path } });
  const existing = new Map(
    (remote.content as Contents.IModel[]).map(child => [child.name, child.type])
  );

  let added = 0;

  for (const item of served) {
    if (item.type === 'directory') {
      if (!existing.has(item.name)) {
        await session.request('PUT', 'files', { body: { path: item.path, type: 'directory' } });
      }
      if (!existing.has(item.name) || existing.get(item.name) === 'directory') {
        added += await seedDirectory(session, item.path);
      }
      continue;
    }

    if (existing.has(item.name)) {
      continue;
    }

    try {
      await session.request('PUT', 'files', {
        body: { path: item.path, ...(await servedFileBody(item)), expected_hash: null }
      });
      added++;
    } catch (error) {
      // 409 : créé entre-temps (autre onglet) ; on n'écrase rien.
      if (!(error instanceof ServerConnection.ResponseError && error.response.status === 409)) {
        throw error;
      }
    }
  }

  return added;
}

/**
 * Liste des fichiers fournis par le build JupyterLite pour un dossier
 * (api/contents/<dossier>/all.json).
 */
async function servedListing(path: string): Promise<Contents.IModel[]> {
  const url = URLExt.join(PageConfig.getBaseUrl(), 'api/contents', path, 'all.json');
  const response = await fetch(url, { cache: 'no-cache' });

  if (!response.ok) {
    return [];
  }

  const listing = (await response.json()) as Contents.IModel;
  return Array.isArray(listing.content) ? listing.content : [];
}

async function servedFileBody(item: Contents.IModel): Promise<Record<string, unknown>> {
  const url = URLExt.join(PageConfig.getBaseUrl(), 'files', item.path);
  const response = await fetch(url, { cache: 'no-cache' });

  if (!response.ok) {
    throw new Error(`Fichier fourni introuvable : ${item.path}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (item.path.toLowerCase().endsWith('.ipynb')) {
    return { type: 'notebook', format: 'json', content: JSON.parse(new TextDecoder().decode(bytes)) };
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { type: 'file', format: 'text', content: text };
  } catch {
    return { type: 'file', format: 'base64', content: toBase64(bytes) };
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}
