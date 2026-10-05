import { PageConfig } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';

import { showFatalError, showLoginDialog } from './loginDialog';

/**
 * Message affiché quand le serveur de fichiers ne répond pas.
 */
export const NETWORK_ERROR_MESSAGE =
  'Impossible de joindre le serveur de fichiers. Vérifiez votre connexion ' +
  'Internet : vos dernières modifications ne sont pas enregistrées.';

const TOKEN_KEY = 'cstj-remote-drive:token';
const MAX_RATE_LIMIT_RETRIES = 3;

export interface IUser {
  username: string;
  name: string;
}

export interface IRequestOptions {
  query?: Record<string, string | undefined>;
  body?: unknown;
}

/**
 * Connexion à l'API : jeton, identité de l'étudiant et requêtes authentifiées.
 *
 * Le jeton est gardé dans sessionStorage (effacé à la fermeture du
 * navigateur) sauf si l'étudiant coche « Rester connecté », auquel cas il va
 * dans localStorage.
 */
export class Session {
  constructor(readonly apiUrl: string) {}

  /**
   * Crée la session à partir de l'option « remoteDriveApiUrl » de
   * jupyter-lite.json.
   */
  static fromPageConfig(): Session {
    const apiUrl = PageConfig.getOption('remoteDriveApiUrl').replace(/\/+$/, '');
    return new Session(apiUrl);
  }

  get user(): IUser | null {
    return this._user;
  }

  /**
   * Garantit qu'un étudiant est connecté avant le démarrage de JupyterLite :
   * vérifie le jeton enregistré ou affiche la fenêtre de connexion.
   */
  async ensureLoggedIn(): Promise<void> {
    if (!this.apiUrl) {
      await showFatalError(
        "L'adresse du serveur de fichiers n'est pas configurée " +
          '(option « remoteDriveApiUrl » de jupyter-lite.json).'
      );
      throw new Error('remoteDriveApiUrl manquant');
    }

    this._token = Private.readToken();

    if (this._token) {
      try {
        const response = await this.request('GET', 'me');
        this._setUser(await response.json());
        return;
      } catch (error) {
        // Serveur injoignable : le jeton est conservé (« Rester connecté »)
        // et sera remplacé si la connexion réussit.
        await this._login(
          error instanceof Error ? error.message : NETWORK_ERROR_MESSAGE
        );
        return;
      }
    }

    await this._login();
  }

  /**
   * Requête authentifiée vers l'API. En cas de session expirée (401), la
   * fenêtre de connexion réapparaît puis la requête est relancée.
   *
   * @throws ServerConnection.ResponseError si l'API répond par une erreur,
   *   Error si le serveur est injoignable.
   */
  async request(
    method: string,
    path: string,
    options: IRequestOptions = {}
  ): Promise<Response> {
    let reauthenticated = false;

    for (let attempt = 0; ; attempt++) {
      const response = await this._fetch(method, path, options, true);

      if (response.status === 401 && !reauthenticated) {
        reauthenticated = true;
        await this._reauthenticate();
        continue;
      }

      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const seconds = Number(response.headers.get('Retry-After')) || 2;
        await Private.sleep(Math.min(seconds, 10) * 1000);
        continue;
      }

      if (!response.ok) {
        throw await Private.responseError(response);
      }

      return response;
    }
  }

  /**
   * Requête authentifiée qui renvoie le corps JSON de la réponse.
   */
  async json<T>(
    method: string,
    path: string,
    options: IRequestOptions = {}
  ): Promise<T> {
    const response = await this.request(method, path, options);
    return (await response.json()) as T;
  }

  /**
   * Révoque le jeton sur le serveur et l'efface du navigateur.
   */
  async logout(): Promise<void> {
    try {
      await this._fetch('POST', 'logout', {}, true);
    } catch {
      // Le jeton est effacé localement même si le serveur est injoignable.
    }
    this._clearToken();
    this._user = null;
  }

  private async _login(message?: string): Promise<void> {
    await showLoginDialog({
      message,
      submit: (username, password, remember) =>
        this._authenticate(username, password, remember)
    });
  }

  /**
   * Une seule fenêtre de reconnexion à la fois, même si plusieurs requêtes
   * reçoivent un 401 en même temps.
   */
  private _reauthenticate(): Promise<void> {
    if (!this._reauthentication) {
      const username = this._user?.username;
      this._clearToken();

      this._reauthentication = showLoginDialog({
        message:
          'Votre session a expiré. Reconnectez-vous pour continuer : ' +
          'vos fichiers ouverts ne sont pas perdus.',
        username,
        lockUsername: !!username,
        onSwitchUser: () => {
          // Changer d'utilisateur ici enregistrerait les fichiers ouverts
          // dans l'espace de quelqu'un d'autre : on recharge la page.
          this._clearToken();
          window.location.reload();
        },
        submit: (user, password, remember) =>
          this._authenticate(user, password, remember)
      }).finally(() => {
        this._reauthentication = null;
      });
    }

    return this._reauthentication;
  }

  private async _authenticate(
    username: string,
    password: string,
    remember: boolean
  ): Promise<void> {
    const response = await this._fetch(
      'POST',
      'login',
      { body: { username, password } },
      false
    );

    if (!response.ok) {
      throw new Error(await Private.loginErrorMessage(response));
    }

    const data = (await response.json()) as { token: string; user: IUser };
    this._token = data.token;
    Private.writeToken(data.token, remember);
    this._setUser(data.user);
  }

  private async _fetch(
    method: string,
    path: string,
    options: IRequestOptions,
    authenticated: boolean
  ): Promise<Response> {
    const url = new URL(`${this.apiUrl}/${path}`);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = { Accept: 'application/json' };

    if (authenticated && this._token) {
      headers['Authorization'] = `Bearer ${this._token}`;
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      return await fetch(url.toString(), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
        credentials: 'omit'
      });
    } catch {
      throw new Error(NETWORK_ERROR_MESSAGE);
    }
  }

  private _setUser(user: IUser): void {
    this._user = { username: user.username, name: user.name };
  }

  private _clearToken(): void {
    this._token = null;
    Private.removeToken();
  }

  private _token: string | null = null;
  private _user: IUser | null = null;
  private _reauthentication: Promise<void> | null = null;
}

namespace Private {
  export function readToken(): string | null {
    return (
      read(window.sessionStorage, TOKEN_KEY) ??
      read(window.localStorage, TOKEN_KEY)
    );
  }

  export function writeToken(token: string, remember: boolean): void {
    removeToken();
    write(remember ? window.localStorage : window.sessionStorage, TOKEN_KEY, token);
  }

  export function removeToken(): void {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      try {
        storage.removeItem(TOKEN_KEY);
      } catch {
        // Stockage indisponible (navigation privée stricte, etc.).
      }
    }
  }

  export function read(storage: Storage, key: string): string | null {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  export function write(storage: Storage, key: string, value: string): void {
    try {
      storage.setItem(key, value);
    } catch {
      // Le jeton reste en mémoire pour cette page.
    }
  }

  export async function responseError(
    response: Response
  ): Promise<ServerConnection.ResponseError> {
    let message = `Erreur du serveur de fichiers (${response.status}).`;

    try {
      const body = await response.clone().json();
      if (typeof body?.message === 'string' && body.message) {
        message = body.message;
      }
    } catch {
      // Réponse non JSON (ex. page d'erreur d'un proxy).
    }

    if (response.status === 429) {
      message = 'Trop de requêtes vers le serveur de fichiers. Réessayez dans un instant.';
    }

    return new ServerConnection.ResponseError(response, message);
  }

  export async function loginErrorMessage(response: Response): Promise<string> {
    switch (response.status) {
      case 401:
        return "Nom d'utilisateur ou mot de passe invalide.";
      case 422:
        return "Entrez votre nom d'utilisateur et votre mot de passe.";
      case 429:
        return 'Trop de tentatives de connexion. Attendez une minute avant de réessayer.';
      default:
        return (await responseError(response)).message;
    }
  }

  export function sleep(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }
}
