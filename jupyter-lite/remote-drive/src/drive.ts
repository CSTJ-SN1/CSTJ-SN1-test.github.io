import {
  Contents,
  ContentProviderRegistry,
  ServerConnection
} from '@jupyterlab/services';
import { ISignal, Signal } from '@lumino/signaling';

import { Session } from './session';

type IModel = Contents.IModel;

/**
 * Durée pendant laquelle une lecture identique réutilise la réponse
 * précédente. Le noyau Pyodide lit souvent le même fichier plusieurs fois de
 * suite (lookup, getattr, get) : cela évite autant d'allers-retours réseau.
 */
const READ_CACHE_MS = 2000;

/**
 * Drive JupyterLab qui enregistre les fichiers de l'étudiant sur le serveur
 * (API Laravel) au lieu de l'IndexedDB du navigateur.
 */
export class RemoteDrive implements Contents.IDrive {
  constructor(session: Session) {
    this._session = session;
  }

  readonly name = 'RemoteDrive';

  readonly serverSettings = ServerConnection.makeSettings();

  readonly contentProviderRegistry = new ContentProviderRegistry();

  get fileChanged(): ISignal<Contents.IDrive, Contents.IChangedArgs> {
    return this._fileChanged;
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    this._cache.clear();
    Signal.clearData(this);
  }

  async get(localPath: string, options?: Contents.IFetchOptions): Promise<IModel> {
    const provider = this.contentProviderRegistry.getProvider(options?.contentProviderId);
    if (provider) {
      return provider.get(localPath, options);
    }

    // Le serveur ne connaît que text/base64 pour les fichiers : un fichier
    // demandé au format json (ex. un .json) est lu en texte puis décodé ici.
    const wantsJsonFile = options?.type !== 'notebook' && options?.format === 'json';
    const model = await this._read({
      path: normalize(localPath),
      type: options?.type,
      format: wantsJsonFile ? 'text' : (options?.format ?? undefined),
      content: options?.content === false ? '0' : '1'
    });

    if (wantsJsonFile && typeof model.content === 'string') {
      return { ...model, format: 'json', content: JSON.parse(model.content) };
    }

    return model;
  }

  /**
   * Le fichier doit être téléchargé avec le jeton : on fournit une URL de
   * type blob: plutôt qu'une URL directe vers l'API.
   */
  async getDownloadUrl(localPath: string): Promise<string> {
    const model = await this.get(localPath, { content: true });
    let blob: Blob;

    if (model.type === 'notebook' || model.format === 'json') {
      blob = new Blob([JSON.stringify(model.content, null, 1)], {
        type: 'application/x-ipynb+json'
      });
    } else if (model.format === 'base64') {
      const bytes = Uint8Array.from(atob(model.content as string), c => c.charCodeAt(0));
      blob = new Blob([bytes], { type: model.mimetype || 'application/octet-stream' });
    } else {
      blob = new Blob([model.content as string], { type: model.mimetype || 'text/plain' });
    }

    return URL.createObjectURL(blob);
  }

  async newUntitled(options: Contents.ICreateOptions = {}): Promise<IModel> {
    const body: Record<string, unknown> = {
      path: normalize(options.path ?? ''),
      type: options.type ?? 'file'
    };

    // Le noyau demande ext: '' pour un fichier sans extension : le serveur
    // utilise alors .txt puis le noyau renomme le fichier.
    if (options.ext) {
      body.ext = options.ext;
    }

    const model = await this._write<IModel>('POST', 'files/untitled', { body });
    this._fileChanged.emit({ type: 'new', oldValue: null, newValue: model });

    return model;
  }

  async delete(localPath: string): Promise<void> {
    const path = normalize(localPath);
    await this._write('DELETE', 'files', { query: { path } });
    this._fileChanged.emit({ type: 'delete', oldValue: { path }, newValue: null });
  }

  async rename(oldLocalPath: string, newLocalPath: string): Promise<IModel> {
    const path = normalize(oldLocalPath);
    const model = await this._write<IModel>('POST', 'files/rename', {
      body: { path, new_path: normalize(newLocalPath) }
    });
    this._fileChanged.emit({ type: 'rename', oldValue: { path }, newValue: model });

    return model;
  }

  async save(
    localPath: string,
    options: Partial<IModel> & Contents.IContentProvisionOptions = {}
  ): Promise<IModel> {
    const provider = this.contentProviderRegistry.getProvider(options.contentProviderId);
    if (provider) {
      const saved = await provider.save(localPath, options);
      this._fileChanged.emit({ type: 'save', oldValue: null, newValue: saved });
      return saved;
    }

    const model = await this._write<IModel>('PUT', 'files', {
      body: { path: normalize(localPath), ...toSaveBody(options) }
    });
    this._fileChanged.emit({ type: 'save', oldValue: null, newValue: model });

    return model;
  }

  async copy(localPath: string, toLocalDir: string): Promise<IModel> {
    const model = await this._write<IModel>('POST', 'files/copy', {
      body: { path: normalize(localPath), to_dir: normalize(toLocalDir) }
    });
    this._fileChanged.emit({ type: 'new', oldValue: null, newValue: model });

    return model;
  }

  async createCheckpoint(localPath: string): Promise<Contents.ICheckpointModel> {
    return this._write('POST', 'checkpoints', { body: { path: normalize(localPath) } });
  }

  async listCheckpoints(localPath: string): Promise<Contents.ICheckpointModel[]> {
    return this._session.json('GET', 'checkpoints', { query: { path: normalize(localPath) } });
  }

  async restoreCheckpoint(localPath: string, checkpointID: string): Promise<void> {
    await this._write('POST', 'checkpoints/restore', {
      body: { path: normalize(localPath), id: checkpointID }
    });
  }

  async deleteCheckpoint(localPath: string, checkpointID: string): Promise<void> {
    await this._session.request('DELETE', 'checkpoints', {
      query: { path: normalize(localPath), id: checkpointID }
    });
  }

  /**
   * Signale qu'un dossier a changé hors de ce drive (import, fichiers
   * fournis) pour que l'explorateur de fichiers se rafraîchisse.
   */
  notifyExternalChange(model: IModel): void {
    this._cache.clear();
    this._fileChanged.emit({ type: 'save', oldValue: null, newValue: model });
  }

  /**
   * Lecture avec mise en commun des requêtes identiques rapprochées. Chaque
   * appelant reçoit sa propre copie du modèle.
   */
  private async _read(query: Record<string, string | undefined>): Promise<IModel> {
    const key = JSON.stringify(query);
    const now = Date.now();
    let entry = this._cache.get(key);

    if (!entry || entry.expires < now) {
      const promise = this._session.json<IModel>('GET', 'files', { query });
      entry = { expires: now + READ_CACHE_MS, promise };
      this._cache.set(key, entry);
      promise.catch(() => this._cache.delete(key));
    }

    return structuredClone(await entry.promise);
  }

  /**
   * Toute écriture invalide le cache de lecture.
   */
  private async _write<T>(
    method: string,
    path: string,
    options: { query?: Record<string, string>; body?: unknown }
  ): Promise<T> {
    this._cache.clear();

    try {
      const response = await this._session.request(method, path, options);
      return (response.status === 204 ? undefined : await response.json()) as T;
    } finally {
      this._cache.clear();
    }
  }

  private _session: Session;
  private _isDisposed = false;
  private _fileChanged = new Signal<Contents.IDrive, Contents.IChangedArgs>(this);
  private _cache = new Map<string, { expires: number; promise: Promise<IModel> }>();
}

/**
 * Chemin relatif à la racine de l'étudiant, sans « / » au début ni à la fin.
 */
function normalize(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

/**
 * Corps de PUT /api/files à partir des options de Contents.IDrive.save.
 */
export function toSaveBody(options: Partial<IModel> & { chunk?: number }): Record<string, unknown> {
  const type = options.type ?? 'file';
  const body: Record<string, unknown> = { type };

  if (type === 'notebook') {
    body.format = 'json';
    body.content = options.content;
  } else if (type === 'file') {
    if (options.format === 'json') {
      // Le noyau écrit les .json et .ipynb comme des fichiers au format json.
      body.format = 'text';
      body.content = JSON.stringify(options.content, null, 1);
    } else {
      body.format = options.format ?? 'text';
      body.content = options.content;
    }
  }

  if (options.chunk !== undefined) {
    body.chunk = options.chunk;
  }

  return body;
}
